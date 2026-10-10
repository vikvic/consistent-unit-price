import { calculateUnitPrice } from "../core/convert";
import type {
  CalculationResult,
  DisplayFormat,
  DisplayStyle,
  ExtensionSettings,
  FormatMode,
  RetailerExtraction,
  RetailerUnavailableMessage,
  UnavailableReason
} from "../core/types";
import {
  collectAmazonScopes,
  closestAmazonScope,
  extractAmazon
} from "../retailers/amazon";
import {
  collectWalmartScopes,
  collectWalmartDisplayedUnitFormats,
  closestWalmartScope,
  extractWalmart
} from "../retailers/walmart";
import {
  DEFAULT_SETTINGS,
  getSettings,
  subscribeSettings
} from "../settings";
import { observeRetailerScopes } from "./observe";
import {
  removeUnitPrice,
  removeUnitPriceOverlay,
  removeUnitPricesWithin,
  overlayUnitPriceText,
  type UnitPriceOverlay,
  renderUnitPrice
} from "./render";

interface RetailerAdapter {
  collectScopes(root: ParentNode): HTMLElement[];
  closestScope(node: Node): HTMLElement | null;
  extract(scope: HTMLElement): RetailerExtraction;
  enabled(settings: ExtensionSettings): boolean;
}

const AMAZON_ADAPTER: RetailerAdapter = {
  collectScopes: collectAmazonScopes,
  closestScope: closestAmazonScope,
  extract: extractAmazon,
  enabled: (settings) => settings.amazonEnabled
};

const WALMART_ADAPTER: RetailerAdapter = {
  collectScopes: collectWalmartScopes,
  closestScope: closestWalmartScope,
  extract: extractWalmart,
  enabled: (settings) => settings.walmartEnabled
};

const knownScopes = new Set<HTMLElement>();
const renderedHostByScope = new WeakMap<HTMLElement, HTMLElement>();
const overlayByScope = new Map<HTMLElement, UnitPriceOverlay>();
const walmartConversionDiagnosticsByScope = new WeakMap<HTMLElement, Set<string>>();
let stopObserving: (() => void) | undefined;
let currentPreferredFormat: DisplayFormat = DEFAULT_SETTINGS.preferredFormat;
let currentFormat: DisplayFormat = DEFAULT_SETTINGS.preferredFormat;
let currentFormatMode: FormatMode = DEFAULT_SETTINGS.formatMode;
let currentDisplayStyle: DisplayStyle = DEFAULT_SETTINGS.displayStyle;
let activeAdapter: RetailerAdapter | undefined;

function resolveAutomaticFormat(): boolean {
  if (activeAdapter !== WALMART_ADAPTER || currentFormatMode !== "automatic") {
    return false;
  }

  const formats = collectWalmartDisplayedUnitFormats(document);
  const counts = new Map<DisplayFormat, number>();
  for (const format of formats) {
    counts.set(format, (counts.get(format) ?? 0) + 1);
  }
  const highestCount = Math.max(0, ...counts.values());
  const winners = Array.from(counts.entries())
    .filter(([, count]) => count === highestCount && count > 0)
    .map(([format]) => format);
  const resolvedFormat: DisplayFormat = winners.length === 1
    ? winners[0]
    : "dollars-per-pound";
  const changed = resolvedFormat !== currentFormat;
  currentFormat = resolvedFormat;

  return changed;
}

function logWalmartConversion(
  scope: HTMLElement,
  details: {
    originalUnitPrice: string;
    convertedUnitPrice: string;
    displayStyle: DisplayStyle;
    item?: string;
  }
): void {
  if (activeAdapter !== WALMART_ADAPTER) {
    return;
  }

  const signature = JSON.stringify(details);
  const signatures = walmartConversionDiagnosticsByScope.get(scope) ?? new Set<string>();
  if (signatures.has(signature)) {
    return;
  }
  signatures.add(signature);
  walmartConversionDiagnosticsByScope.set(scope, signatures);

  console.info(
    `[CUP][Walmart][Conversion] original=${JSON.stringify(details.originalUnitPrice)} converted=${JSON.stringify(details.convertedUnitPrice)} display=${details.displayStyle}`,
    details
  );
}

function adapterForPage(): RetailerAdapter | undefined {
  const hostname = window.location.hostname.toLowerCase();
  if (hostname === "walmart.com" || hostname.endsWith(".walmart.com")) {
    return WALMART_ADAPTER;
  }

  if (hostname === "amazon.com" || hostname.endsWith(".amazon.com")) {
    return AMAZON_ADAPTER;
  }

  return undefined;
}

function legacyReason(reason: RetailerUnavailableMessage): UnavailableReason {
  switch (reason) {
    case "Price unavailable":
    case "Ordinary one-time price unavailable":
    case "Price does not match selected offer":
    case "Currency is not supported":
      return "invalid-price";
    case "Selected offer is ambiguous":
      return "ambiguous-quantity";
    case "Conflicting net weights":
      return "conflicting-quantity";
    case "Fluid volume is not supported":
      return "volume-is-not-weight";
    case "Net product weight unavailable":
    case "Mixed bundle has no comparable net weight":
    case "Exact offer unavailable":
      return "invalid-quantity";
  }
}

function unavailableResult(reason: RetailerUnavailableMessage): CalculationResult {
  return {
    available: false,
    format: currentFormat,
    reason: legacyReason(reason),
    label: `Unavailable: ${reason}`
  };
}

function calculate(extraction: RetailerExtraction): CalculationResult {
  if (extraction.unavailableReason) {
    return unavailableResult(extraction.unavailableReason);
  }
  if (extraction.priceDollars === undefined || !extraction.quantity) {
    return unavailableResult("Net product weight unavailable");
  }

  return calculateUnitPrice({
    priceDollars: extraction.priceDollars,
    quantity: extraction.quantity,
    format: currentFormat,
    provenance: extraction.quantity.provenance
      ? {
          price: {
            source: "retailer-page",
            observedAt: new Date().toISOString(),
            sourceLabel: extraction.sourceLabel
          },
          quantity: extraction.quantity.provenance
        }
      : undefined
  });
}

function processScope(scope: HTMLElement): void {
  if (!activeAdapter || !scope.isConnected) {
    return;
  }

  knownScopes.add(scope);
  const previousOverlay = overlayByScope.get(scope);
  if (previousOverlay) {
    removeUnitPriceOverlay(previousOverlay);
    overlayByScope.delete(scope);
  }
  const previousHost = renderedHostByScope.get(scope);
  if (previousHost) {
    removeUnitPrice(previousHost);
    renderedHostByScope.delete(scope);
  }

  const extraction = activeAdapter.extract(scope);
  if (!extraction.host || !extraction.host.isConnected) {
    return;
  }

  const result = calculate(extraction);
  if (result.available && extraction.storeDisplayedUnitFormat === result.format) {
    if (
      activeAdapter === WALMART_ADAPTER &&
      currentDisplayStyle === "overlay" &&
      extraction.storeDisplayedUnitPriceText
    ) {
      const unitPriceOverlay = overlayUnitPriceText(
        extraction.host,
        extraction.storeDisplayedUnitPriceText,
        extraction.storeDisplayedUnitPriceText,
        { converted: false }
      );
      if (unitPriceOverlay) {
        overlayByScope.set(scope, unitPriceOverlay);
      }
    }
    return;
  }

  if (activeAdapter === WALMART_ADAPTER && currentDisplayStyle === "overlay") {
    if (result.available && extraction.storeDisplayedUnitPriceText) {
      const unitPriceOverlay = overlayUnitPriceText(
        extraction.host,
        extraction.storeDisplayedUnitPriceText,
        result.label
      );
      if (unitPriceOverlay) {
        overlayByScope.set(scope, unitPriceOverlay);
        logWalmartConversion(scope, {
          item: extraction.productName ?? "Unknown item",
          originalUnitPrice: extraction.storeDisplayedUnitPriceText,
          convertedUnitPrice: result.label,
          displayStyle: currentDisplayStyle
        });
      }
    }
    return;
  }

  renderUnitPrice(extraction.host, result, {
    priceText: extraction.priceText,
    quantityText: extraction.quantityText,
    sourceLabel: extraction.sourceLabel,
    variant: "inline",
    methodText: extraction.storeProvidedUnitPrice
      ? "Normalized from the retailer's displayed unit price; not independently recalculated"
      : result.available
        ? undefined
        : "No calculation; the visible evidence did not meet the extraction rules"
  });
  renderedHostByScope.set(scope, extraction.host);

  const badgeInserted = Boolean(extraction.host.querySelector("[data-cup-root]"));
  if (result.available) {
    if (badgeInserted) {
      logWalmartConversion(scope, {
        item: extraction.productName ?? "Unknown item",
        originalUnitPrice: extraction.storeDisplayedUnitPriceText ?? "Not found",
        convertedUnitPrice: result.label,
        displayStyle: currentDisplayStyle
      });
    }
  }
}

function processScopes(scopes: HTMLElement[]): void {
  const automaticFormatChanged = resolveAutomaticFormat();
  const scopesToProcess = automaticFormatChanged
    ? Array.from(new Set([...knownScopes, ...scopes]))
    : scopes;
  for (const scope of scopesToProcess) {
    processScope(scope);
  }

  for (const scope of knownScopes) {
    if (!scope.isConnected) {
      const unitPriceOverlay = overlayByScope.get(scope);
      if (unitPriceOverlay) {
        removeUnitPriceOverlay(unitPriceOverlay);
        overlayByScope.delete(scope);
      }
      knownScopes.delete(scope);
    }
  }
}

function stopAndClear(): void {
  stopObserving?.();
  stopObserving = undefined;
  for (const unitPriceOverlay of overlayByScope.values()) {
    removeUnitPriceOverlay(unitPriceOverlay);
  }
  overlayByScope.clear();
  activeAdapter = undefined;
  knownScopes.clear();
  removeUnitPricesWithin(document);
}

function applySettings(settings: ExtensionSettings): void {
  const formatChanged = settings.preferredFormat !== currentPreferredFormat;
  const formatModeChanged = settings.formatMode !== currentFormatMode;
  const displayStyleChanged = settings.displayStyle !== currentDisplayStyle;
  currentPreferredFormat = settings.preferredFormat;
  currentFormat = settings.preferredFormat;
  currentFormatMode = settings.formatMode;
  currentDisplayStyle = settings.displayStyle;
  const adapter = adapterForPage();

  if (!adapter || !adapter.enabled(settings)) {
    stopAndClear();
    return;
  }

  if (!stopObserving || activeAdapter !== adapter) {
    stopAndClear();
    activeAdapter = adapter;
    resolveAutomaticFormat();
    stopObserving = observeRetailerScopes({
      collectScopes: adapter.collectScopes,
      closestScope: adapter.closestScope,
      onScopes: processScopes
    });
    return;
  }

  if (formatChanged || formatModeChanged || displayStyleChanged) {
    resolveAutomaticFormat();
    processScopes(Array.from(knownScopes));
  }
}

subscribeSettings(applySettings);
getSettings().then(applySettings).catch(() => applySettings({ ...DEFAULT_SETTINGS }));

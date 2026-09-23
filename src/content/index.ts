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
const walmartDiagnosticByScope = new WeakMap<HTMLElement, string>();
let stopObserving: (() => void) | undefined;
let currentPreferredFormat: DisplayFormat = DEFAULT_SETTINGS.preferredFormat;
let currentFormat: DisplayFormat = DEFAULT_SETTINGS.preferredFormat;
let currentFormatMode: FormatMode = DEFAULT_SETTINGS.formatMode;
let currentDisplayStyle: DisplayStyle = DEFAULT_SETTINGS.displayStyle;
let activeAdapter: RetailerAdapter | undefined;
let walmartSettingsDiagnostic = "";
let walmartAutomaticFormatDiagnostic = "";

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

  const countDetails = Object.fromEntries(counts.entries());
  const diagnostic = JSON.stringify({ countDetails, resolvedFormat, tied: winners.length > 1 });
  if (diagnostic !== walmartAutomaticFormatDiagnostic) {
    walmartAutomaticFormatDiagnostic = diagnostic;
    console.info("[CUP][Walmart] automatic format selected", {
      formatCounts: countDetails,
      selectedFormat: resolvedFormat,
      fallbackUsed: winners.length !== 1,
      loadedUnitPriceCount: formats.length
    });
  }
  return changed;
}

function walmartElementPath(element: Element | undefined): Array<Record<string, string>> {
  const path: Array<Record<string, string>> = [];
  let current: Element | null = element ?? null;
  while (current && path.length < 8) {
    const marker: Record<string, string> = { tag: current.tagName.toLowerCase() };
    for (const attribute of ["data-item-id", "data-testid", "data-test-id", "data-automation-id", "role"]) {
      const value = current.getAttribute(attribute);
      if (value) marker[attribute] = value;
    }
    if (current.id) marker.id = current.id;
    path.push(marker);
    current = current.parentElement;
  }
  return path;
}

function walmartDomInventory(): Record<string, unknown> {
  const itemScopes = Array.from(document.querySelectorAll<HTMLElement>("[data-item-id]"));
  const titles = Array.from(document.querySelectorAll<HTMLElement>('[data-automation-id="product-title"]'));
  const legacyPrices = Array.from(document.querySelectorAll<HTMLElement>('[data-automation-id="product-price"]'));
  const unifiedPrices = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="unified-global-product-price"]'));
  const prices = Array.from(new Set([...legacyPrices, ...unifiedPrices]));
  const visible = (element: HTMLElement): boolean => element.getClientRects().length > 0;
  const sampleTitle = titles.find(visible) ?? titles[0];
  const samplePrice = prices.find(visible) ?? prices[0];
  return {
    itemIdCount: itemScopes.length,
    productTitleCount: titles.length,
    visibleProductTitleCount: titles.filter(visible).length,
    productPriceCount: prices.length,
    legacyProductPriceCount: legacyPrices.length,
    unifiedProductPriceCount: unifiedPrices.length,
    visibleProductPriceCount: prices.filter(visible).length,
    sampleTitle: sampleTitle?.textContent?.replace(/\s+/g, " ").trim().slice(0, 160) ?? "Not found",
    sampleTitleAncestors: walmartElementPath(sampleTitle),
    samplePriceAncestors: walmartElementPath(samplePrice)
  };
}

function logWalmartDiagnostic(
  scope: HTMLElement,
  event: string,
  details: Record<string, unknown>,
  level: "info" | "warn" = "info"
): void {
  if (activeAdapter !== WALMART_ADAPTER) {
    return;
  }

  const signature = JSON.stringify([event, details]);
  if (walmartDiagnosticByScope.get(scope) === signature) {
    return;
  }
  walmartDiagnosticByScope.set(scope, signature);
  console[level](`[CUP][Walmart] ${event}`, details);
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
    logWalmartDiagnostic(scope, "product found but no price-label host was available", {
      item: extraction.productName ?? "Unknown item",
      originalPrice: extraction.priceText,
      quantity: extraction.quantityText,
      preferredFormat: currentFormat,
      reason: extraction.unavailableReason ?? "Missing render host"
    }, "warn");
    return;
  }

  const result = calculate(extraction);
  if (result.available && extraction.storeDisplayedUnitFormat === result.format) {
    logWalmartDiagnostic(scope, "no conversion needed", {
      item: extraction.productName ?? "Unknown item",
      originalUnitPrice: extraction.storeDisplayedUnitPriceText ?? "Not found",
      convertedUnitPrice: result.label,
      preferredFormat: result.format,
      reason: "Walmart already displays the preferred denomination"
    });
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
        logWalmartDiagnostic(scope, "unit price overlaid", {
          item: extraction.productName ?? "Unknown item",
          originalUnitPrice: extraction.storeDisplayedUnitPriceText,
          convertedUnitPrice: result.label,
          preferredFormat: result.format,
          displayStyle: currentDisplayStyle
        });
      } else {
        logWalmartDiagnostic(scope, "unit price overlay target not found", {
          item: extraction.productName ?? "Unknown item",
          originalUnitPrice: extraction.storeDisplayedUnitPriceText,
          convertedUnitPrice: result.label,
          preferredFormat: result.format,
          displayStyle: currentDisplayStyle
        }, "warn");
      }
    } else if (!result.available) {
      logWalmartDiagnostic(scope, "unit price left unchanged", {
        item: extraction.productName ?? "Unknown item",
        originalUnitPrice: extraction.storeDisplayedUnitPriceText ?? "Not found",
        preferredFormat: result.format,
        displayStyle: currentDisplayStyle,
        reason: result.label
      }, "warn");
    } else {
      logWalmartDiagnostic(scope, "unit price left unchanged", {
        item: extraction.productName ?? "Unknown item",
        originalUnitPrice: "Not found",
        convertedUnitPrice: result.label,
        preferredFormat: result.format,
        displayStyle: currentDisplayStyle,
        reason: "No retailer unit-price text was available to overlay"
      }, "warn");
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
    logWalmartDiagnostic(scope, extraction.storeDisplayedUnitPriceText
      ? "conversion needed"
      : "unit price calculated without a Walmart unit-price label", {
      item: extraction.productName ?? "Unknown item",
      originalUnitPrice: extraction.storeDisplayedUnitPriceText ?? "Not found",
      originalPrice: extraction.priceText,
      quantity: extraction.quantityText,
      convertedUnitPrice: result.label,
      preferredFormat: result.format,
      badgeInserted
    }, badgeInserted ? "info" : "warn");
  } else {
    logWalmartDiagnostic(scope, "unit price unavailable", {
      item: extraction.productName ?? "Unknown item",
      originalUnitPrice: extraction.storeDisplayedUnitPriceText ?? "Not found",
      originalPrice: extraction.priceText,
      quantity: extraction.quantityText,
      preferredFormat: result.format,
      reason: result.label,
      badgeInserted
    }, "warn");
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

  if (adapter === WALMART_ADAPTER) {
    const diagnostic = JSON.stringify({
      preferredFormat: settings.preferredFormat,
      formatMode: settings.formatMode,
      displayStyle: settings.displayStyle,
      walmartEnabled: settings.walmartEnabled,
      page: window.location.pathname
    });
    if (diagnostic !== walmartSettingsDiagnostic) {
      walmartSettingsDiagnostic = diagnostic;
      console.info("[CUP][Walmart] settings applied; scanning page", {
        preferredFormat: settings.preferredFormat,
        formatMode: settings.formatMode,
        displayStyle: settings.displayStyle,
        walmartEnabled: settings.walmartEnabled,
        page: window.location.pathname,
        extensionVersion: chrome.runtime.getManifest().version
      });
    }
  }

  if (!adapter || !adapter.enabled(settings)) {
    stopAndClear();
    return;
  }

  if (!stopObserving || activeAdapter !== adapter) {
    stopAndClear();
    activeAdapter = adapter;
    resolveAutomaticFormat();
    if (adapter === WALMART_ADAPTER) {
      console.info("[CUP][Walmart] initial card scan", {
        scopeCount: adapter.collectScopes(document).length,
        page: window.location.pathname,
        domInventory: walmartDomInventory()
      });
    }
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

if (adapterForPage() === WALMART_ADAPTER) {
  console.info("[CUP][Walmart] bundle loaded", {
    page: window.location.pathname,
    extensionVersion: chrome.runtime.getManifest().version
  });
}

subscribeSettings(applySettings);
getSettings().then(applySettings).catch(() => applySettings({ ...DEFAULT_SETTINGS }));

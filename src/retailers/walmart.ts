import { parseWeightQuantity } from "../core/quantity";
import type {
  DisplayFormat,
  EvidenceProvenance,
  QuantityEvidence,
  RetailerExtraction,
  RetailerUnavailableMessage
} from "../core/types";

const CARD_SELECTOR = "[data-item-id]";
const TITLE_SELECTOR = '[data-automation-id="product-title"]';
const PRICE_SELECTOR = '[data-automation-id="product-price"], [data-testid="unified-global-product-price"]';
const OWNED_SELECTOR = "[data-cup-root]";
const VOLUME_PATTERN = /\b(?:fl\.?\s*oz|fluid\s+ounces?|ml|millilit(?:er|re)s?|lit(?:er|re)s?|l)\b/i;
const UNIT_PATTERN = "(?:oz|ounces?|lbs?|pounds?|g|grams?|kg|kilograms?|kilos?)";
const NUMBER_PATTERN = "\\d+(?:\\.\\d+)?";
const DISPLAYED_UNIT_PRICE_PATTERN = /(\$|¢)?\s*\d+(?:\.\d+)?\s*(¢)?\s*(?:\/|per\s+)(oz|ounce|lb|pound|100\s*g|kg)\b/i;

interface PriceEvidence {
  value: number;
  text: string;
  element: HTMLElement;
  unsupportedCurrency: boolean;
}

function displayedUnitFormat(text: string): DisplayFormat | undefined {
  const match = text.match(DISPLAYED_UNIT_PRICE_PATTERN);
  if (!match) {
    return undefined;
  }

  const unit = match[3].toLowerCase();
  const isCents = match[1] === "¢" || match[2] === "¢";
  if (isCents) {
    return unit === "oz" || unit === "ounce" ? "cents-per-ounce" : undefined;
  }
  if (unit === "lb" || unit === "pound") return "dollars-per-pound";
  if (/^100\s*g$/.test(unit)) return "dollars-per-100-grams";
  if (unit === "kg") return "dollars-per-kilogram";
  return "dollars-per-ounce";
}

export function collectWalmartDisplayedUnitFormats(root: ParentNode): DisplayFormat[] {
  return Array.from(new Set(root.querySelectorAll<HTMLElement>(PRICE_SELECTOR)))
    .filter(isVisible)
    .map((element) => displayedUnitFormat(visibleTextOf(element)))
    .filter((format): format is DisplayFormat => format !== undefined);
}

function displayedUnitPriceText(text: string): string | undefined {
  return text.match(DISPLAYED_UNIT_PRICE_PATTERN)?.[0].replace(/\s+/g, " ").trim();
}

let currentProductScope: HTMLElement | undefined;
const knownCardScopes = new WeakSet<HTMLElement>();

interface QuantitySelection {
  evidence?: QuantityEvidence;
  text: string;
  reason?: RetailerUnavailableMessage;
}

function isVisible(element: HTMLElement): boolean {
  if (!element.isConnected || element.closest('[aria-hidden="true"], [hidden]')) {
    return false;
  }
  let candidate: HTMLElement | null = element;
  while (candidate) {
    const style = window.getComputedStyle(candidate);
    if (
      style.display === "none" ||
      style.opacity === "0" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse"
    ) {
      return false;
    }
    candidate = candidate.parentElement;
  }
  return true;
}

function visibleTextOf(element: HTMLElement | null | undefined): string {
  if (!element) {
    return "";
  }
  const parts: string[] = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const parent = node.parentElement;
    const value = node.textContent?.replace(/\s+/g, " ").trim();
    if (
      parent &&
      value &&
      !parent.closest("script, style, noscript, template") &&
      !parent.closest(OWNED_SELECTOR) &&
      isVisible(parent)
    ) {
      parts.push(value);
    }
    node = walker.nextNode();
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function normalizeFragmentedDollars(text: string): string {
  return text.replace(
    /\$\s*(\d+)\s+(\d{2})(?=\D|$)/g,
    (_match, whole: string, fraction: string) => `$${whole}.${fraction}`
  );
}

function walmartPriceText(priceElement: HTMLElement): string {
  const elements = [priceElement, ...priceElement.querySelectorAll<HTMLElement>("*")]
    .filter((element) => !element.closest('[aria-hidden="true"], [hidden]') && isVisible(element));
  const candidates = elements.flatMap((element) => {
    const values = [
      element.getAttribute("aria-label") ?? "",
      element.getAttribute("title") ?? "",
      visibleTextOf(element)
    ];
    return values.filter(Boolean);
  });
  for (const candidate of candidates.sort((a, b) => a.length - b.length)) {
    const current = candidate.match(/\bcurrent price\b[^$]{0,40}(?:\bnow\b\s*)?\$\s*(\d+(?:\.\d{1,2}))/i);
    if (current) {
      return `current price Now $${current[1]}`;
    }
  }

  return normalizeFragmentedDollars(visibleTextOf(priceElement));
}

function isCardScope(element: HTMLElement): boolean {
  if (
    !element.matches(CARD_SELECTOR) ||
    (currentProductScope?.isConnected && currentProductScope.contains(element))
  ) {
    return false;
  }
  if (knownCardScopes.has(element)) {
    return true;
  }
  const price = Array.from(element.querySelectorAll<HTMLElement>(PRICE_SELECTOR)).find(isVisible);
  return price?.closest(CARD_SELECTOR) === element;
}

function cardRoot(element: Element | null): HTMLElement | null {
  let candidate = element?.closest<HTMLElement>(CARD_SELECTOR) ?? null;
  while (candidate) {
    if (isCardScope(candidate)) {
      return candidate;
    }
    candidate = candidate.parentElement?.closest<HTMLElement>(CARD_SELECTOR) ?? null;
  }
  return null;
}

function knownCardRoot(element: Element | null): HTMLElement | null {
  let candidate = element?.closest<HTMLElement>(CARD_SELECTOR) ?? null;
  while (candidate) {
    if (knownCardScopes.has(candidate)) {
      return candidate;
    }
    candidate = candidate.parentElement?.closest<HTMLElement>(CARD_SELECTOR) ?? null;
  }
  return null;
}

function isInsideDescendantCard(scope: HTMLElement, element: HTMLElement): boolean {
  const card = element.closest<HTMLElement>(CARD_SELECTOR);
  return card !== null && card !== scope;
}

function queryAllPrimary<T extends HTMLElement>(scope: HTMLElement, selector: string): T[] {
  return Array.from(scope.querySelectorAll<T>(selector))
    .filter((element) => scope !== currentProductScope || !isInsideDescendantCard(scope, element));
}

function pageProvenance(sourceLabel: string, selector: string): EvidenceProvenance {
  return {
    source: "retailer-page",
    observedAt: new Date().toISOString(),
    sourceLabel,
    selector
  };
}

function normalizeUnit(unit: string): string {
  return /^kilos?$/i.test(unit) ? "kg" : unit;
}

function canonicalQuantity(text: string): string | undefined {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean || VOLUME_PATTERN.test(clean)) {
    return undefined;
  }

  const countFirst = clean.match(
    new RegExp(`(${NUMBER_PATTERN})\\s*[x×]\\s*(${NUMBER_PATTERN})\\s*(${UNIT_PATTERN})\\b`, "i")
  );
  if (countFirst) {
    return `${countFirst[1]} × ${countFirst[2]} ${normalizeUnit(countFirst[3])}`;
  }

  const countLast = clean.match(
    new RegExp(`(${NUMBER_PATTERN})\\s*(${UNIT_PATTERN})\\s*[x×]\\s*(${NUMBER_PATTERN})\\b`, "i")
  );
  if (countLast) {
    return `${countLast[1]} ${normalizeUnit(countLast[2])} × ${countLast[3]}`;
  }

  const nested = clean.match(
    new RegExp(`\\(\\s*(${NUMBER_PATTERN})\\s*pack\\s*\\).*?(${NUMBER_PATTERN})\\s*(${UNIT_PATTERN})\\s*[,;]?\\s*(${NUMBER_PATTERN})\\s*count`, "i")
  );
  if (nested) {
    return `(${nested[1]} pack) ${nested[2]} ${normalizeUnit(nested[3])}, ${nested[4]} Count`;
  }

  const leadingPack = clean.match(
    new RegExp(`^\\(\\s*(${NUMBER_PATTERN})\\s*pack\\s*\\).*?(${NUMBER_PATTERN})\\s*(${UNIT_PATTERN})\\b`, "i")
  );
  if (leadingPack) {
    return `${leadingPack[1]} × ${leadingPack[2]} ${normalizeUnit(leadingPack[3])}`;
  }

  const packSuffix = clean.match(
    new RegExp(`(${NUMBER_PATTERN})\\s*(${UNIT_PATTERN})\\s*\\(\\s*pack\\s+of\\s+(${NUMBER_PATTERN})\\s*\\)`, "i")
  );
  if (packSuffix) {
    return `${packSuffix[1]} ${normalizeUnit(packSuffix[2])} (Pack of ${packSuffix[3]})`;
  }

  const countSuffix = clean.match(
    new RegExp(`(${NUMBER_PATTERN})\\s*(${UNIT_PATTERN})\\s*[,;]?\\s*(${NUMBER_PATTERN})\\s*count`, "i")
  );
  if (countSuffix) {
    return `${countSuffix[1]} ${normalizeUnit(countSuffix[2])}, ${countSuffix[3]} Count`;
  }

  if (/\b(?:pack|count)\b|\d+\s*(?:pk|ct)\b|(?:\d\s*[x×]|[x×]\s*\d)/i.test(clean)) {
    return undefined;
  }

  const single = clean.match(new RegExp(`(${NUMBER_PATTERN})\\s*(${UNIT_PATTERN})\\b`, "i"));
  return single ? `${single[1]} ${normalizeUnit(single[2])}` : undefined;
}

function hasUnresolvedCountBearingWeight(text: string): boolean {
  const hasWeight = new RegExp(`${NUMBER_PATTERN}\\s*${UNIT_PATTERN}\\b`, "i").test(text);
  const hasCount = /\b(?:pack|count)\b|\d+\s*(?:pk|ct)\b|(?:\d\s*[x×]|[x×]\s*\d)/i.test(text);
  return hasWeight && hasCount && canonicalQuantity(text) === undefined;
}

function mixedBundleNeedsComparableTotal(text: string): boolean {
  const identifiesMixedBundle = /\b(?:bundle|variety|assortment|mixed)\b|(?:\+|\bwith\b)\s*(?:a\s+|free\s+)?(?:bottle|accessor(?:y|ies)|scoop|container)\b/i.test(text);
  const statesComparableTotal = /\b(?:total|combined)\b.{0,40}\d+(?:\.\d+)?\s*(?:oz|ounces?|lbs?|pounds?|g|grams?|kg|kilograms?|kilos?)\b/i.test(text)
    || /\d+(?:\.\d+)?\s*(?:oz|ounces?|lbs?|pounds?|g|grams?|kg|kilograms?|kilos?)\b.{0,24}\b(?:total|combined)\b/i.test(text);
  return identifiesMixedBundle && !statesComparableTotal;
}

function quantityEvidence(rawText: string, sourceLabel: string, selector: string): QuantityEvidence {
  return {
    rawText,
    kind: "product-weight",
    provenance: pageProvenance(sourceLabel, selector)
  };
}

function currentPrice(priceElement: HTMLElement | null): PriceEvidence | undefined {
  if (!priceElement || priceElement.closest(OWNED_SELECTOR) || !isVisible(priceElement)) {
    return undefined;
  }

  const text = walmartPriceText(priceElement);
  const unsupportedCurrency = /(?:^|[\s(])(?:EUR|GBP|CAD|AUD)(?=$|[\s):,$])|(?:CA|AU)\$|[€£]/i.test(text);
  const withoutComparison = text
    .replace(/\b(?:was|list price|typical(?: price)?|formerly)\s*\$\s*[\d,.]+/gi, " ")
    .replace(/\$\s*[\d,.]+\s*(?:walmart cash|cash back|rebate|shipping)\b/gi, " ")
    .replace(/\b(?:save|coupon|rebate)\s*\$\s*[\d,.]+/gi, " ")
    .replace(/\bsubscribe\b[^$]{0,30}\$\s*[\d,.]+/gi, " ")
    .replace(/\b(?:walmart\+\s*)?members?(?:hip)?\b[^$]{0,24}\$\s*[\d,.]+/gi, " ")
    .replace(/\b(?:subscribe(?:\s*&\s*save)?|(?:walmart\+\s*)?members?(?:hip)?(?:\s+(?:only|price))?)\s*\$\s*[\d,.]+/gi, " ")
    .replace(/\$\s*[\d,.]+\s*(?:with\s+(?:subscription|subscribe)|for\s+(?:walmart\+\s*)?members?|members? only)\b/gi, " ")
    .replace(/\$\s*[\d,.]+\s*(?:subscribe|subscription|(?:walmart\+\s*)?member(?:ship)? price)\b/gi, " ")
    .replace(/\b(?:with|after|clip(?:ped)?)\s+(?:a\s+)?coupon\s*[:\-]?\s*\$\s*[\d,.]+/gi, " ")
    .replace(/\bwalmart\+\s+(?:only\s+)?price\b[^$]{0,24}\$\s*[\d,.]+/gi, " ")
    .replace(/\$\s*[\d,.]+\s+(?:with|for)\s+walmart\+\b/gi, " ")
    .replace(/\b\d+\s+for\s+\$\s*[\d,.]+/gi, " ")
    .replace(/\$\s*[\d,.]+\s+(?:when\s+you\s+buy|if\s+you\s+buy)\s+\d+\b/gi, " ");
  const normalized = withoutComparison
    .replace(/,/g, "");
  const now = normalized.match(/\bnow\s*\$\s*(\d+(?:\.\d{1,2})?)/i);
  const first = normalized.match(/\$\s*(\d+(?:\.\d{1,2})?)/);
  const value = Number((now ?? first)?.[1]);
  if (!Number.isFinite(value) || value <= 0) {
    return { value: Number.NaN, text, element: priceElement, unsupportedCurrency };
  }

  return { value, text: `$${value.toFixed(2)}`, element: priceElement, unsupportedCurrency };
}

function selectedControlText(control: HTMLElement | undefined, scope: HTMLElement): string {
  if (!control) {
    return "";
  }

  const id = control.id;
  const label = id ? scope.querySelector<HTMLElement>(`label[for="${CSS.escape(id)}"]`) : null;
  return visibleTextOf(label ?? control.closest<HTMLElement>("label") ?? control.parentElement);
}

function optionControls(scope: HTMLElement): HTMLElement[] {
  return queryAllPrimary<HTMLElement>(
    scope,
    'input[type="radio"], input[type="checkbox"], [role="radio"], [role="option"]'
  ).filter(
    (control) =>
      !control.closest(OWNED_SELECTOR) &&
      !control.closest('[aria-hidden="true"], [hidden]')
  );
}

function isSelected(control: HTMLElement): boolean {
  return control instanceof HTMLInputElement
    ? control.checked
    : control.getAttribute("aria-checked") === "true" || control.getAttribute("aria-selected") === "true";
}

function isQuantityVariant(control: HTMLElement, scope: HTMLElement): boolean {
  const text = selectedControlText(control, scope);
  return !/^\s*(?:one-time purchase|subscribe)\b/i.test(text)
    && /\b(?:single|pack|size|count|oz|ounce|lb|pound|gram|kg|kilo)\b/i.test(text);
}

function variantControl(scope: HTMLElement): HTMLElement | undefined {
  return optionControls(scope)
    .filter((control) => isQuantityVariant(control, scope))
    .find((control) => isSelected(control));
}

function variantControlsExist(scope: HTMLElement): boolean {
  return optionControls(scope).some((control) => isQuantityVariant(control, scope));
}

function packCount(text: string): number | undefined {
  if (/\bsingle\b/i.test(text)) {
    return 1;
  }
  const match = text.match(/\b(\d+)\s*[- ]?pack\b|\bpack\s+of\s+(\d+)\b/i);
  const value = Number(match?.[1] ?? match?.[2]);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function gramsForEvidence(evidence: QuantityEvidence): number | undefined {
  const result = parseWeightQuantity(evidence);
  return result.available ? result.quantity.totalGrams : undefined;
}

function quantitiesConflict(a: QuantityEvidence, b: QuantityEvidence): boolean {
  const aGrams = gramsForEvidence(a);
  const bGrams = gramsForEvidence(b);
  return aGrams !== undefined && bGrams !== undefined
    ? Math.abs(aGrams - bGrams) / Math.max(aGrams, bGrams) > 0.01
    : false;
}

function embeddedWeightConflict(text: string): RetailerUnavailableMessage | undefined {
  const matches = Array.from(
    text.matchAll(new RegExp(`(${NUMBER_PATTERN})\\s*(${UNIT_PATTERN})\\b`, "gi"))
  );
  const evidences = matches.map((match) =>
    quantityEvidence(`${match[1]} ${normalizeUnit(match[2])}`, "Walmart product text", "bounded product text")
  );
  const canonical = canonicalQuantity(text);
  const parsedCanonical = canonical
    ? parseWeightQuantity(quantityEvidence(canonical, "Walmart product text", "bounded product text"))
    : undefined;
  if (parsedCanonical?.available && /\b(?:pack|count)\b/i.test(text)) {
    const component = quantityEvidence(
      `${parsedCanonical.quantity.amountPerItem} ${parsedCanonical.quantity.unit}`,
      "Walmart product text",
      "bounded product text"
    );
    const explained = evidences.every((candidate) => {
      const grams = gramsForEvidence(candidate);
      const componentGrams = gramsForEvidence(component);
      return grams !== undefined && componentGrams !== undefined && (
        Math.abs(grams - parsedCanonical.quantity.totalGrams) / parsedCanonical.quantity.totalGrams <= 0.01 ||
        Math.abs(grams - componentGrams) / componentGrams <= 0.01
      );
    });
    if (explained) {
      return undefined;
    }
  }
  if (evidences.length < 2 || !evidences.some((candidate) => quantitiesConflict(evidences[0], candidate))) {
    return undefined;
  }
  return /(?:\+|\b(?:bundle|variety|assortment)\b)/i.test(text)
    ? "Mixed bundle has no comparable net weight"
    : "Conflicting net weights";
}

function walmartQuantity(
  scope: HTMLElement,
  productName: string,
  priceText: string,
  requireSelection: boolean
): QuantitySelection {
  if (VOLUME_PATTERN.test(`${productName} ${priceText}`)) {
    return { text: productName, reason: "Fluid volume is not supported" };
  }

  const bundleEvidenceText = isCardScope(scope) ? `${productName} ${visibleTextOf(scope)}` : productName;
  if (mixedBundleNeedsComparableTotal(bundleEvidenceText)) {
    return { text: productName, reason: "Mixed bundle has no comparable net weight" };
  }

  const titleConflict = embeddedWeightConflict(productName);
  if (titleConflict) {
    return { text: productName, reason: titleConflict };
  }

  if (hasUnresolvedCountBearingWeight(productName)) {
    return { text: productName, reason: "Selected offer is ambiguous" };
  }

  const control = variantControl(scope);
  const controlsExist = variantControlsExist(scope);
  if (requireSelection && controlsExist && !control) {
    return { text: productName, reason: "Selected offer is ambiguous" };
  }

  const controlText = selectedControlText(control, scope);
  const titleCanonical = canonicalQuantity(productName);
  const cardQuantities = isCardScope(scope)
    ? Array.from(scope.querySelectorAll<HTMLElement>("span, [data-automation-id]"))
        .filter((element) => !element.closest(PRICE_SELECTOR) && !element.closest(OWNED_SELECTOR) && isVisible(element))
        .map(visibleTextOf)
        .filter((text) => text.length > 0 && text.length < 100)
        .map(canonicalQuantity)
        .filter((text): text is string => Boolean(text))
    : [];
  const controlCanonical = canonicalQuantity(controlText);
  const count = packCount(controlText);
  const parsedTitle = titleCanonical
    ? parseWeightQuantity(quantityEvidence(titleCanonical, "Walmart product title", TITLE_SELECTOR))
    : undefined;
  if (
    count !== undefined &&
    parsedTitle?.available &&
    parsedTitle.quantity.itemCount > 1 &&
    parsedTitle.quantity.itemCount !== count
  ) {
    return { text: `${controlText}; ${productName}`, reason: "Selected offer is ambiguous" };
  }
  let selectedCanonical = controlCanonical;
  if (!selectedCanonical && titleCanonical && count && count > 1) {
    if (parsedTitle?.available && parsedTitle.quantity.itemCount === 1) {
      selectedCanonical = `${count} × ${parsedTitle.quantity.amountPerItem} ${parsedTitle.quantity.unit}`;
    }
  }

  const selectedEvidence = selectedCanonical
    ? quantityEvidence(selectedCanonical, "Walmart selected option", "checked/selected option")
    : undefined;
  const titleEvidence = titleCanonical
    ? quantityEvidence(titleCanonical, "Walmart product title", TITLE_SELECTOR)
    : undefined;
  const cardEvidence = Array.from(new Set(cardQuantities))
    .map((rawText) => quantityEvidence(rawText, "Walmart card size line", CARD_SELECTOR));

  if (selectedEvidence && titleEvidence && count === undefined && quantitiesConflict(selectedEvidence, titleEvidence)) {
    return {
      text: `${selectedEvidence.rawText}; ${titleEvidence.rawText}`,
      reason: "Conflicting net weights"
    };
  }

  const primary = selectedEvidence ?? titleEvidence ?? cardEvidence[0];
  if (primary) {
    if (
      !(selectedEvidence && count && count > 1) &&
      cardEvidence.some((candidate) => quantitiesConflict(primary, candidate))
    ) {
      return {
        text: [primary.rawText, ...cardEvidence.map((candidate) => candidate.rawText)].join("; "),
        reason: "Conflicting net weights"
      };
    }
    return { evidence: primary, text: primary.rawText };
  }

  if (/\b(?:variety|bundle|assortment)\b.*\b(?:bottle|accessor)/i.test(productName)) {
    return { text: productName, reason: "Mixed bundle has no comparable net weight" };
  }

  return { text: productName, reason: "Net product weight unavailable" };
}

function ordinaryOneTimePrice(scope: HTMLElement): PriceEvidence | undefined {
  const candidates = queryAllPrimary<HTMLElement>(
    scope,
    "button, label, [role='radio'], [role='button'], [data-testid*='one-time' i], [data-automation-id*='one-time' i]"
  );
  for (const candidate of candidates) {
    const text = visibleTextOf(candidate);
    if (
      !/^one-time purchase\b/i.test(text) ||
      candidate.closest(OWNED_SELECTOR) ||
      !isVisible(candidate)
    ) {
      continue;
    }
    const parsed = currentPrice(candidate);
    if (parsed && (Number.isFinite(parsed.value) || parsed.unsupportedCurrency)) {
      return parsed;
    }
  }
  return undefined;
}

function selectedOptionPrice(scope: HTMLElement): number | undefined {
  const text = normalizeFragmentedDollars(selectedControlText(variantControl(scope), scope));
  const match = text.replace(/,/g, "").match(/\$\s*(\d+(?:\.\d{1,2})?)/);
  const value = Number(match?.[1]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function subscriptionIsSelected(scope: HTMLElement): boolean {
  return optionControls(scope).some(
    (control) => isSelected(control) && /^\s*subscribe\b/i.test(selectedControlText(control, scope))
  );
}

function storeUnitPrice(scope: HTMLElement): { priceDollars: number; quantity: QuantityEvidence; text: string } | undefined {
  const elements = [scope, ...scope.querySelectorAll<HTMLElement>("span, div")]
    .filter((element) => !element.closest(OWNED_SELECTOR) && isVisible(element));
  const candidateTexts = elements.flatMap((element) => [
    element.getAttribute("aria-label") ?? "",
    visibleTextOf(element)
  ]).filter(Boolean);
  const containerText = candidateTexts.join(" ");
  const comparisonUnitPattern = new RegExp(
    `\\b(?:was|formerly|list price|typical price)\\s*[:\\-]?\\s*${DISPLAYED_UNIT_PRICE_PATTERN.source}`,
    "i"
  );
  if (
    VOLUME_PATTERN.test(containerText) ||
    /(?:\b(?:CAD|EUR|GBP|AUD)\b|(?:CA|AU)\$|[€£])/i.test(containerText) ||
    /\b(?:subscribe|subscription|coupon|walmart cash|members?|membership|when you buy|if you buy)\b/i.test(containerText) ||
    comparisonUnitPattern.test(containerText)
  ) {
    return undefined;
  }

  const parsedByValue = new Map<string, {
    priceDollars: number;
    basis: string;
    text: string;
  }>();
  for (const candidate of candidateTexts) {
    const globalPattern = new RegExp(DISPLAYED_UNIT_PRICE_PATTERN.source, "gi");
    for (const match of candidate.matchAll(globalPattern)) {
      const unit = match[3].toLowerCase();
      const priceDollars = match[1] === "¢" || match[2] === "¢"
        ? Number(match[0].match(/\d+(?:\.\d+)?/)?.[0]) / 100
        : Number(match[0].match(/\d+(?:\.\d+)?/)?.[0]);
      const basis = /^100\s*g$/.test(unit)
        ? "100 g"
        : unit === "ounce"
          ? "1 oz"
          : unit === "pound"
            ? "1 lb"
            : `1 ${unit}`;
      if (Number.isFinite(priceDollars) && priceDollars > 0) {
        const key = `${priceDollars.toFixed(8)}:${basis}`;
        parsedByValue.set(key, {
          priceDollars,
          basis,
          text: match[0].replace(/\s+/g, " ").trim()
        });
      }
    }
  }
  if (parsedByValue.size !== 1) {
    return undefined;
  }

  const parsed = Array.from(parsedByValue.values())[0];

  return {
    priceDollars: parsed.priceDollars,
    quantity: quantityEvidence(parsed.basis, "Walmart store-provided unit price", PRICE_SELECTOR),
    text: parsed.text
  };
}

function extractCard(scope: HTMLElement): RetailerExtraction {
  const titleElement = Array.from(scope.querySelectorAll<HTMLElement>(TITLE_SELECTOR)).find(isVisible) ?? null;
  const priceElement = Array.from(scope.querySelectorAll<HTMLElement>(PRICE_SELECTOR)).find(isVisible) ?? null;
  const productName = visibleTextOf(titleElement);
  const price = currentPrice(priceElement);
  const host = priceElement && isVisible(priceElement) ? priceElement : undefined;
  const priceElementText = visibleTextOf(priceElement);
  const storeDisplayedUnitPriceText = displayedUnitPriceText(priceElementText);
  const storeDisplayedUnitFormat = displayedUnitFormat(priceElementText);
  const sourceLabel = `Walmart result card${productName ? ` — ${productName}` : ""}`;
  const cardText = visibleTextOf(scope);
  const normalizedCardText = normalizeFragmentedDollars(cardText);
  const optionMarker = /\b(?:options?\s+from|available in additional(?:\s+\d+)?\s+options?)\b/i.test(normalizedCardText);
  const cardPrices = normalizedCardText.match(/\$\s*\d+(?:\.\d{1,2})?/g) ?? [];
  const hasRange = optionMarker && cardPrices.length >= 2;
  const control = variantControl(scope);
  const unitPrice = storeUnitPrice(priceElement ?? scope);
  const quantity: QuantitySelection = productName
    ? walmartQuantity(scope, productName, visibleTextOf(priceElement), true)
    : { text: "Not found", reason: "Net product weight unavailable" };

  if (price?.unsupportedCurrency) {
    return {
      scope,
      host,
      productName,
      priceText: price.text,
      quantityText: quantity.text,
      sourceLabel,
      unavailableReason: "Currency is not supported"
    };
  }

  if (unitPrice) {
    return {
      scope,
      host,
      productName,
      priceDollars: unitPrice.priceDollars,
      priceText: `${unitPrice.text} (store-provided unit price)`,
      quantity: unitPrice.quantity,
      quantityText: `${unitPrice.quantity.rawText} store unit basis`,
      sourceLabel: `${sourceLabel}; store-provided unit price, normalized directly`,
      storeProvidedUnitPrice: true,
      storeDisplayedUnitPriceText: unitPrice.text,
      storeDisplayedUnitFormat
    };
  }

  if (hasRange && !control) {
    return {
      scope,
      host,
      productName,
      priceText: price?.text ?? "Option range only",
      quantityText: quantity.text,
      sourceLabel,
      unavailableReason: "Selected offer is ambiguous"
    };
  }

  if (!price || !Number.isFinite(price.value)) {
    return {
      scope,
      host,
      productName,
      priceText: "Not found",
      quantityText: quantity.text,
      sourceLabel,
      unavailableReason: /\b(?:subscribe|walmart cash|coupon|members?|membership)\b/i.test(cardText)
        ? "Ordinary one-time price unavailable"
        : "Price unavailable"
    };
  }


  if (control) {
    const optionPrice = selectedOptionPrice(scope);
    if (optionPrice === undefined) {
      return {
        scope,
        host,
        productName,
        priceText: price.text,
        quantityText: quantity.text,
        sourceLabel,
        unavailableReason: "Selected offer is ambiguous"
      };
    }
    if (Math.abs(optionPrice - price.value) > 0.005) {
      return {
        scope,
        host,
        productName,
        priceText: `${price.text}; selected option $${optionPrice.toFixed(2)}`,
        quantityText: quantity.text,
        sourceLabel,
        unavailableReason: "Price does not match selected offer"
      };
    }
  }

  if (quantity.evidence && !quantity.reason) {
    return {
      scope,
      host,
      productName,
      priceDollars: price.value,
      priceText: price.text,
      quantity: quantity.evidence,
      quantityText: quantity.text,
      sourceLabel,
      storeDisplayedUnitPriceText,
      storeDisplayedUnitFormat
    };
  }

  return {
    scope,
    host,
    productName,
    priceDollars: price.value,
    priceText: price.text,
    quantityText: quantity.text,
    sourceLabel,
    unavailableReason: quantity.reason ?? "Net product weight unavailable"
  };
}

function extractProduct(scope: HTMLElement): RetailerExtraction {
  const titleElement = queryAllPrimary<HTMLElement>(scope, TITLE_SELECTOR).find(isVisible) ?? null;
  const priceElement = queryAllPrimary<HTMLElement>(scope, PRICE_SELECTOR).find(isVisible) ?? null;
  const productName = visibleTextOf(titleElement);
  const ordinaryPrice = ordinaryOneTimePrice(scope);
  const visiblePrice = currentPrice(priceElement);
  const host = priceElement && isVisible(priceElement) ? priceElement : undefined;
  const priceElementText = visibleTextOf(priceElement);
  const storeDisplayedUnitPriceText = displayedUnitPriceText(priceElementText);
  const storeDisplayedUnitFormat = displayedUnitFormat(priceElementText);
  const sourceLabel = `Walmart product page${productName ? ` — ${productName}` : ""}`;
  const quantity = walmartQuantity(scope, productName, visibleTextOf(priceElement), true);

  if (!ordinaryPrice) {
    return {
      scope,
      host,
      productName,
      priceText: visiblePrice?.text ?? "Not found",
      quantityText: quantity.text,
      sourceLabel,
      unavailableReason: "Ordinary one-time price unavailable"
    };
  }

  if (ordinaryPrice.unsupportedCurrency) {
    return {
      scope,
      host,
      productName,
      priceText: ordinaryPrice.text,
      quantityText: quantity.text,
      sourceLabel,
      unavailableReason: "Currency is not supported"
    };
  }

  const optionPrice = selectedOptionPrice(scope);
  const selectedPrice = optionPrice ?? (
    !subscriptionIsSelected(scope) && visiblePrice && Number.isFinite(visiblePrice.value)
      ? visiblePrice.value
      : undefined
  );
  if (selectedPrice !== undefined && Math.abs(selectedPrice - ordinaryPrice.value) > 0.005) {
    return {
      scope,
      host,
      productName,
      priceText: `${ordinaryPrice.text}; selected offer $${selectedPrice.toFixed(2)}`,
      quantityText: quantity.text,
      sourceLabel,
      unavailableReason: "Price does not match selected offer"
    };
  }

  if (quantity.reason || !quantity.evidence) {
    return {
      scope,
      host,
      productName,
      priceDollars: ordinaryPrice.value,
      priceText: ordinaryPrice.text,
      quantityText: quantity.text,
      sourceLabel,
      unavailableReason: quantity.reason ?? "Net product weight unavailable"
    };
  }

  return {
    scope,
    host,
    productName,
    priceDollars: ordinaryPrice.value,
    priceText: ordinaryPrice.text,
    quantity: quantity.evidence,
    quantityText: quantity.text,
    sourceLabel,
    storeDisplayedUnitPriceText,
    storeDisplayedUnitFormat
  };
}

function productPageScope(root: ParentNode): HTMLElement | undefined {
  if (!/^\/ip(?:\/|$)/i.test(window.location.pathname)) {
    return undefined;
  }
  if (
    !(root instanceof Document) &&
    !(root instanceof HTMLElement && root.matches('main, [data-testid="product-page"], [data-automation-id="product-page"], [itemtype*="Product"]'))
  ) {
    return undefined;
  }
  const visibleTitles = Array.from(root.querySelectorAll<HTMLElement>(TITLE_SELECTOR))
    .filter(isVisible);
  const title = visibleTitles.find((candidate) => !candidate.closest(CARD_SELECTOR));
  const titleCard = title?.closest<HTMLElement>(CARD_SELECTOR) ?? null;
  const price = Array.from(root.querySelectorAll<HTMLElement>(PRICE_SELECTOR))
    .filter(isVisible)
    .find((candidate) => {
      const priceCard = candidate.closest<HTMLElement>(CARD_SELECTOR);
      return priceCard === null || priceCard === titleCard;
    });
  if (!title || !price) {
    return undefined;
  }

  const semanticBoundary = title.closest<HTMLElement>(
    '[data-testid="product-page"], [data-automation-id="product-page"], [itemtype*="Product"]'
  );
  if (semanticBoundary?.contains(price)) {
    return semanticBoundary;
  }

  let common: HTMLElement | null = title.parentElement;
  while (common && !common.contains(price)) {
    common = common.parentElement;
  }
  return common && !common.matches("main, body") ? common : undefined;
}

export function collectWalmartScopes(root: ParentNode): HTMLElement[] {
  const scopes: HTMLElement[] = [];
  if (!/^\/ip(?:\/|$)/i.test(window.location.pathname)) {
    currentProductScope = undefined;
  }
  const product = productPageScope(root);
  if (product) {
    currentProductScope = product;
    scopes.push(product);
  }
  if (root instanceof HTMLElement && isCardScope(root)) {
    knownCardScopes.add(root);
    scopes.push(root);
  }
  const cards = Array.from(root.querySelectorAll<HTMLElement>(CARD_SELECTOR)).filter(isCardScope);
  cards.forEach((card) => knownCardScopes.add(card));
  scopes.push(...cards);
  return Array.from(new Set(scopes));
}

export function closestWalmartScope(node: Node): HTMLElement | null {
  if (!/^\/ip(?:\/|$)/i.test(window.location.pathname)) {
    currentProductScope = undefined;
  }
  const element = node instanceof Element ? node : node.parentElement;
  const card = cardRoot(element);
  if (card) {
    return card;
  }
  if (currentProductScope?.isConnected && element && currentProductScope.contains(element)) {
    return currentProductScope;
  }
  const knownCard = knownCardRoot(element);
  if (knownCard) {
    return knownCard;
  }
  const main = element?.closest<HTMLElement>("main");
  const product = main ? productPageScope(main) : undefined;
  if (product) {
    currentProductScope = product;
  }
  return product ?? null;
}

export function extractWalmart(scope: HTMLElement): RetailerExtraction {
  const extraction = scope === currentProductScope ? extractProduct(scope) : extractCard(scope);
  if (extraction.storeDisplayedUnitPriceText !== undefined) {
    return extraction;
  }

  const priceElement = queryAllPrimary<HTMLElement>(scope, PRICE_SELECTOR).find(isVisible) ?? null;
  const priceElementText = visibleTextOf(priceElement);
  return {
    ...extraction,
    storeDisplayedUnitPriceText: displayedUnitPriceText(priceElementText),
    storeDisplayedUnitFormat: displayedUnitFormat(priceElementText)
  };
}

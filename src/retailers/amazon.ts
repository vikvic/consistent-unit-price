import { parseWeightQuantity } from "../core/quantity";
import type {
  DisplayFormat,
  EvidenceProvenance,
  QuantityEvidence,
  RetailerExtraction,
  RetailerUnavailableMessage
} from "../core/types";

const CARD_SELECTOR = '[data-asin]:not([data-asin=""])';
const PRODUCT_SELECTOR = "#dp-container";
const OWNED_SELECTOR = "[data-cup-root]";
const VOLUME_PATTERN = /\b(?:fl\.?\s*oz|fluid\s+ounces?|ml|millilit(?:er|re)s?|lit(?:er|re)s?|l)\b/i;
const UNIT_PATTERN = "(?:oz|ounces?|lbs?|pounds?|g|grams?|kg|kilograms?|kilos?)";
const NUMBER_PATTERN = "\\d+(?:\\.\\d+)?";
const knownCardScopes = new WeakSet<HTMLElement>();

function displayedUnitFormat(text: string): DisplayFormat | undefined {
  const match = text.match(/(\$|¢)?\s*\d+(?:\.\d+)?\s*(¢)?\s*(?:\/|per\s+)(oz|ounce|lb|pound|100\s*g|kg)\b/i);
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

interface PriceEvidence {
  value: number;
  text: string;
  element: HTMLElement;
  unsupportedCurrency?: boolean;
}

interface QuantitySelection {
  evidence?: QuantityEvidence;
  text: string;
  reason?: RetailerUnavailableMessage;
}

interface VariationResolution {
  selectedTexts: string[];
  selectedHeaderText?: string;
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

function isConditionalPriceContext(element: HTMLElement): boolean {
  const structuralContext = element.closest<HTMLElement>(
    '[id*="subscribe" i], [id*="coupon" i], [id*="membership" i], [class*="subscribe" i], [class*="coupon" i], [class*="membership" i]'
  );
  const localText = visibleTextOf(element.parentElement);
  const rowText = visibleTextOf(element.closest<HTMLElement>(".a-row") ?? element.parentElement);
  const conditionalPrefix = /^\s*(?:subscribe(?:\s*&\s*save)?|members? only|membership price|prime (?:exclusive|price)|after (?:a )?coupon|with (?:a )?coupon|when you buy|buy \d+\s+(?:or\s+)?more)\b/i;
  const conditionalSuffix = /\$\s*\d+(?:\.\d{1,2})?[^$]{0,24}\b(?:with (?:a )?(?:subscription|coupon)|after (?:a )?coupon|for members?|members? only|when you buy)\b/i;
  return Boolean(structuralContext) ||
    conditionalPrefix.test(localText) ||
    conditionalPrefix.test(rowText) ||
    conditionalSuffix.test(localText);
}

function isEligibleCurrentPriceNode(element: HTMLElement): boolean {
  return isVisible(element) &&
    !element.closest(OWNED_SELECTOR) &&
    !element.classList.contains("a-text-price") &&
    !element.closest(".a-text-price") &&
    !isConditionalPriceContext(element);
}

function cardRoot(element: Element | null): HTMLElement | null {
  let card = element?.closest<HTMLElement>(CARD_SELECTOR) ?? null;
  if (!card || card.closest(PRODUCT_SELECTOR)) {
    return null;
  }
  if (knownCardScopes.has(card)) {
    return card;
  }
  let ancestor = card.parentElement?.closest<HTMLElement>(CARD_SELECTOR) ?? null;
  while (ancestor && !ancestor.closest(PRODUCT_SELECTOR)) {
    if (knownCardScopes.has(ancestor)) {
      return ancestor;
    }
    card = ancestor;
    ancestor = card.parentElement?.closest<HTMLElement>(CARD_SELECTOR) ?? null;
  }
  return knownCardScopes.has(card) || Array.from(card.querySelectorAll<HTMLElement>("h2")).some(isVisible)
    ? card
    : null;
}

function isCardScope(element: HTMLElement): boolean {
  return cardRoot(element) === element;
}

function pageProvenance(sourceLabel: string, selector: string): EvidenceProvenance {
  return {
    source: "retailer-page",
    observedAt: new Date().toISOString(),
    sourceLabel,
    selector
  };
}

function moneyFromText(text: string): { value?: number; unsupportedCurrency: boolean } {
  if (/(?:^|[\s(])(?:EUR|GBP|CAD|AUD)(?=$|[\s):,$])|(?:CA|AU)\$|[€£]/i.test(text)) {
    return { unsupportedCurrency: true };
  }

  const match = text.replace(/,/g, "").match(/\$\s*(\d+(?:\.\d{1,2})?)/);
  if (!match) {
    return { unsupportedCurrency: false };
  }

  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0
    ? { value, unsupportedCurrency: false }
    : { unsupportedCurrency: false };
}

function amazonPricePartText(price: HTMLElement, selector: string, accessible = false): string {
  const matches = Array.from(price.querySelectorAll<HTMLElement>(selector))
    .filter((element) => element.closest(".a-price") === price);
  if (matches.length !== 1) {
    return "";
  }

  const part = matches[0];
  const parts: string[] = [];
  const walker = document.createTreeWalker(part, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    let parent = node.parentElement;
    let usable = Boolean(parent) && !parent?.closest(`script, style, noscript, template, ${OWNED_SELECTOR}`);
    while (usable && parent && parent !== price) {
      const style = window.getComputedStyle(parent);
      // Amazon hides only the accessible copy's opacity. The visual copy uses
      // aria-hidden to prevent duplicate announcements, not to hide its pixels.
      usable = !parent.hidden &&
        (!accessible || parent.getAttribute("aria-hidden") !== "true") &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.visibility !== "collapse" &&
        (style.opacity !== "0" || (accessible && parent === part));
      parent = parent.parentElement;
    }
    if (usable && parent === price) {
      parts.push(node.textContent ?? "");
    }
    node = walker.nextNode();
  }
  return parts.join("").replace(/\s+/g, " ").trim();
}

function amazonPriceText(element: HTMLElement): string {
  if (!isVisible(element)) {
    return "";
  }
  const accessibleText = amazonPricePartText(element, ".a-offscreen", true);
  if (
    moneyFromText(accessibleText).unsupportedCurrency ||
    /^(?:US(?:D)?\s*)?\$\s*(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/.test(accessibleText)
  ) {
    return accessibleText;
  }

  const symbol = amazonPricePartText(element, ".a-price-symbol");
  const whole = amazonPricePartText(element, ".a-price-whole");
  const fraction = amazonPricePartText(element, ".a-price-fraction");
  if (!/^(?:\d{1,3}(?:,\d{3})+|\d+)\.?$/.test(whole) || !/^\d{2}$/.test(fraction)) {
    return "";
  }
  if (!/^(?:US(?:D)?\s*)?\$$/.test(symbol) && !moneyFromText(symbol).unsupportedCurrency) {
    return "";
  }
  return `${symbol}${whole.replace(/\.$/, "")}.${fraction}`;
}

function currentAmazonPrice(scope: HTMLElement): PriceEvidence | undefined {
  const candidates = Array.from(scope.querySelectorAll<HTMLElement>(".a-price"));
  for (const candidate of candidates) {
    if (!isEligibleCurrentPriceNode(candidate)) {
      continue;
    }

    const priceText = amazonPriceText(candidate);
    const parsed = moneyFromText(priceText);
    if (parsed.unsupportedCurrency) {
      return {
        value: Number.NaN,
        text: priceText,
        element: candidate,
        unsupportedCurrency: true
      };
    }
    if (parsed.value !== undefined) {
      return { value: parsed.value, text: priceText, element: candidate };
    }
  }

  return undefined;
}

function oneTimePurchasePrice(scope: HTMLElement): PriceEvidence | undefined {
  const candidates = Array.from(
    scope.querySelectorAll<HTMLElement>(
      "button, [role='button'], .a-accordion-row-container, h3, h4"
    )
  );

  for (const candidate of candidates) {
    const candidateText = visibleTextOf(candidate);
    if (!/^one-time purchase\b\s*:?/i.test(candidateText) || !isVisible(candidate)) {
      continue;
    }

    const nestedCurrentPrice = currentAmazonPrice(candidate);
    if (nestedCurrentPrice) {
      return nestedCurrentPrice;
    }
  }

  return undefined;
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
  if (single) {
    return `${single[1]} ${normalizeUnit(single[2])}`;
  }

  return undefined;
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

function amazonControlIsSelected(control: HTMLElement): boolean {
  if (control instanceof HTMLSelectElement) {
    return control.selectedIndex >= 0 && Boolean(control.value);
  }
  return control instanceof HTMLInputElement && (control.type === "radio" || control.type === "checkbox")
    ? control.checked
    : control.getAttribute("aria-checked") === "true" ||
        control.getAttribute("aria-selected") === "true" ||
        control.getAttribute("aria-pressed") === "true";
}

function amazonControlText(control: HTMLElement, scope: HTMLElement): string {
  if (control instanceof HTMLSelectElement) {
    return visibleTextOf(control.selectedOptions[0]);
  }
  const labelIds = control.getAttribute("aria-labelledby")?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (labelIds.length > 0) {
    const option = control.closest<HTMLElement>("label, li, .a-button");
    const labels: HTMLElement[] = [];
    for (const id of labelIds) {
      const selector = `[id="${CSS.escape(id)}"]`;
      const localMatches = option && scope.contains(option)
        ? Array.from(option.querySelectorAll<HTMLElement>(selector))
        : [];
      const matches = localMatches.length > 0
        ? localMatches
        : Array.from(scope.querySelectorAll<HTMLElement>(selector));
      if (matches.length !== 1) {
        return "";
      }
      labels.push(matches[0]);
    }
    return labels.map((label) => {
      const parts: string[] = [];
      const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        let parent = node.parentElement;
        let usable = Boolean(parent) && !parent?.closest(`script, style, noscript, template, ${OWNED_SELECTOR}`);
        // Explicitly referenced option labels may be aria-hidden visual copies.
        // Keep CSS-hidden content and text outside this label relationship out.
        while (usable && parent && parent !== scope) {
          const style = window.getComputedStyle(parent);
          usable = !parent.hidden && style.display !== "none" && style.opacity !== "0" &&
            style.visibility !== "hidden" && style.visibility !== "collapse";
          parent = parent.parentElement;
        }
        if (usable && parent === scope) {
          parts.push(node.textContent ?? "");
        }
        node = walker.nextNode();
      }
      return parts.join(" ").replace(/\s+/g, " ").trim();
    }).join(" ").trim();
  }
  const accessibleLabel = control.getAttribute("aria-label")?.trim();
  if (accessibleLabel) {
    return accessibleLabel;
  }
  const label = control.id
    ? scope.querySelector<HTMLElement>(`label[for="${CSS.escape(control.id)}"]`)
    : null;
  return visibleTextOf(label ?? control.closest<HTMLElement>("label, li") ?? control);
}

function selectedQuantityVariations(scope: HTMLElement): VariationResolution {
  const groupSelector = [
    "#tp-inline-twister-dim-values-container",
    '[role="radiogroup"][aria-label*="size" i]',
    '[role="radiogroup"][aria-label*="pack" i]',
    '[data-csa-c-content-id*="size" i][role="radiogroup"]',
    '[data-csa-c-content-id*="pack" i][role="radiogroup"]',
    '[id*="variation_size" i]',
    '[id*="variation_pack" i]',
    '[id*="variation_package_quantity" i]'
  ].join(", ");
  const groupCandidates = Array.from(new Set(scope.querySelectorAll<HTMLElement>(groupSelector)))
    .filter(isVisible)
    .map((root) => {
      const controls = Array.from(
        root.querySelectorAll<HTMLElement>(
          'input[type="radio"], input[type="checkbox"], select, [role="radio"], [role="option"]'
        )
      ).filter(
        (control) =>
          !control.closest('[aria-hidden="true"], [hidden]') &&
          control.getAttribute("aria-disabled") !== "true" &&
          (!(control instanceof HTMLInputElement) || !control.disabled) &&
          (!(control instanceof HTMLSelectElement) || !control.disabled)
      );
      const references = controls.map((control) =>
        `${control.id} ${control.getAttribute("aria-labelledby") ?? ""} ${control.getAttribute("name") ?? ""}`
      ).join(" ");
      const name = `${root.id} ${root.getAttribute("aria-label") ?? ""} ${root.getAttribute("aria-labelledby") ?? ""} ${root.getAttribute("data-csa-c-content-id") ?? ""} ${references}`;
      const hasSize = /(?:^|[\s_-])size(?=$|[\s_-])/i.test(name);
      const hasPack = /(?:^|[\s_-])(?:pack|package[_-]?quantity)(?=$|[\s_-])/i.test(name);
      const hasOtherDimension = /(?:^|[\s_-])(?:style|flavou?r|colou?r|pattern)(?=$|[\s_-])/i.test(name);
      let dimension = hasOtherDimension && (hasSize || hasPack)
        ? "unknown"
        : hasPack ? "pack" : hasSize ? "size" : hasOtherDimension ? "other" : "unknown";
      if (!hasOtherDimension && !hasSize && !hasPack) {
        const optionTexts = controls.map((control) => amazonControlText(control, root));
        if (optionTexts.some((text) => canonicalQuantity(text) || VOLUME_PATTERN.test(text))) {
          dimension = "size";
        } else if (optionTexts.some((text) => /\bsingle\b|\b\d+\s*[- ]?pack\b|\bpack\s+of\s+\d+\b/i.test(text))) {
          dimension = "pack";
        }
      }
      return { root, controls, name, dimension };
    })
    .filter(
      (group) =>
        group.controls.length > 0 &&
        (
          group.root.id === "tp-inline-twister-dim-values-container" ||
          (
            (
              group.root.getAttribute("role") === "radiogroup" ||
              /^variation_(?:size(?:_name)?|pack(?:_size)?|package_quantity)$/i.test(group.root.id)
            ) &&
            /(?:size|pack|package[_-]?quantity)/i.test(group.name)
          )
        )
    )
    .sort((a, b) => {
      const depth = (element: HTMLElement): number => {
        let value = 0;
        let parent = element.parentElement;
        while (parent) {
          value += 1;
          parent = parent.parentElement;
        }
        return value;
      };
      return depth(b.root) - depth(a.root);
    });
  const groups: typeof groupCandidates = [];
  for (const candidate of groupCandidates) {
    if (
      groups.some((accepted) =>
        candidate.controls.some((control) => accepted.controls.includes(control))
      )
    ) {
      continue;
    }
    groups.push(candidate);
  }

  const selectedTexts: string[] = [];
  let selectedHeaderText: string | undefined;
  const sizeHeaders = Array.from(scope.querySelectorAll<HTMLElement>(
    '[id="inline-twister-expander-header-size_name"]'
  )).filter(isVisible);
  const sizeGroups = groups.filter((group) => group.dimension === "size");
  if (sizeHeaders.length > 0 && sizeGroups.length === 0) {
    return { selectedTexts, reason: "Selected offer is ambiguous" };
  }

  for (const group of groups) {
    if (group.dimension === "other") {
      continue;
    }
    if (group.dimension === "unknown") {
      return { selectedTexts, reason: "Selected offer is ambiguous" };
    }
    const selectedControls = group.controls.filter(amazonControlIsSelected);
    if (selectedControls.length === 0) {
      return { selectedTexts, reason: "Selected offer is ambiguous" };
    }
    const controlTexts = Array.from(
      new Set(selectedControls.map((control) => amazonControlText(control, group.root)).filter(Boolean))
    );
    let headerCandidate: HTMLElement | undefined;
    if (group.dimension === "size") {
      let context: HTMLElement | null = group.root;
      while (context && scope.contains(context)) {
        const localHeaders = sizeHeaders.filter((header) => context?.contains(header));
        const localGroups = sizeGroups.filter((candidate) => context?.contains(candidate.root));
        if (localHeaders.length === 1 && localGroups.length === 1) {
          headerCandidate = localHeaders[0];
          break;
        }
        context = context.parentElement;
      }
    }
    const visibleHeaderText = headerCandidate
      ? visibleTextOf(headerCandidate).replace(/^size\s*:?\s*/i, "")
      : "";
    if (controlTexts.length === 0 && !visibleHeaderText) {
      return { selectedTexts, reason: "Selected offer is ambiguous" };
    }
    const explicitControlQuantities = Array.from(
      new Set(controlTexts.map(canonicalQuantity).filter((text): text is string => Boolean(text)))
    );
    if (explicitControlQuantities.length > 1) {
      return { selectedTexts, reason: "Selected offer is ambiguous" };
    }

    let selectedText = controlTexts[0] ?? visibleHeaderText;
    if (visibleHeaderText) {
      const headerQuantity = canonicalQuantity(visibleHeaderText);
      if (
        headerQuantity &&
        explicitControlQuantities[0] &&
        quantitiesConflict(
          quantityEvidence(headerQuantity, "Amazon selected size header", "#inline-twister-expander-header-size_name"),
          quantityEvidence(explicitControlQuantities[0], "Amazon checked size option", "#tp-inline-twister-dim-values-container")
        )
      ) {
        return { selectedTexts, reason: "Selected offer is ambiguous" };
      }
      selectedText = visibleHeaderText;
      selectedHeaderText = visibleHeaderText;
    }
    if (
      group.dimension === "pack" &&
      !/\bsingle\b|\b\d+\s*[- ]?pack\b|\bpack\s+of\s+\d+\b/i.test(selectedText)
    ) {
      return { selectedTexts, reason: "Selected offer is ambiguous" };
    }
    selectedTexts.push(selectedText);
  }

  return {
    selectedTexts: Array.from(new Set(selectedTexts)),
    selectedHeaderText
  };
}

function selectedPackCounts(texts: string[]): number[] {
  return texts
    .map((text) => {
      if (/\bsingle\b/i.test(text)) {
        return 1;
      }
      const match = text.match(/\b(\d+)\s*[- ]?pack\b|\bpack\s+of\s+(\d+)\b/i);
      return Number(match?.[1] ?? match?.[2]);
    })
    .filter((value) => Number.isInteger(value) && value > 0);
}

function quantityEvidence(rawText: string, sourceLabel: string, selector: string): QuantityEvidence {
  return {
    rawText,
    kind: "product-weight",
    provenance: pageProvenance(sourceLabel, selector)
  };
}

function gramsForEvidence(evidence: QuantityEvidence): number | undefined {
  const result = parseWeightQuantity(evidence);
  return result.available ? result.quantity.totalGrams : undefined;
}

function quantitiesConflict(a: QuantityEvidence, b: QuantityEvidence): boolean {
  const aGrams = gramsForEvidence(a);
  const bGrams = gramsForEvidence(b);
  if (aGrams === undefined || bGrams === undefined) {
    return false;
  }

  return Math.abs(aGrams - bGrams) / Math.max(aGrams, bGrams) > 0.01;
}

function embeddedWeightConflict(text: string): RetailerUnavailableMessage | undefined {
  const matches = Array.from(
    text.matchAll(new RegExp(`(${NUMBER_PATTERN})\\s*(${UNIT_PATTERN})\\b`, "gi"))
  );
  const evidences = matches.map((match) =>
    quantityEvidence(`${match[1]} ${normalizeUnit(match[2])}`, "Amazon product text", "bounded product text")
  );
  const canonical = canonicalQuantity(text);
  const parsedCanonical = canonical
    ? parseWeightQuantity(quantityEvidence(canonical, "Amazon product text", "bounded product text"))
    : undefined;
  if (parsedCanonical?.available && /\b(?:pack|count)\b/i.test(text)) {
    const component = quantityEvidence(
      `${parsedCanonical.quantity.amountPerItem} ${parsedCanonical.quantity.unit}`,
      "Amazon product text",
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

function selectedAmazonQuantity(scope: HTMLElement, productName: string): QuantitySelection {
  const variations = selectedQuantityVariations(scope);
  if (variations.reason) {
    return { text: variations.selectedTexts.join("; "), reason: variations.reason };
  }

  const selectedText = variations.selectedHeaderText ?? "";
  if (mixedBundleNeedsComparableTotal(productName)) {
    return { text: productName, reason: "Mixed bundle has no comparable net weight" };
  }
  if (hasUnresolvedCountBearingWeight(`${selectedText} ${productName}`)) {
    return { text: selectedText || productName, reason: "Selected offer is ambiguous" };
  }
  let selectedCanonical = canonicalQuantity(selectedText)
    ?? variations.selectedTexts.map(canonicalQuantity).find((text): text is string => Boolean(text));
  const packCounts = Array.from(new Set(selectedPackCounts(variations.selectedTexts)));
  if (packCounts.length > 1) {
    return { text: variations.selectedTexts.join("; "), reason: "Selected offer is ambiguous" };
  }
  const packCount = packCounts[0];
  if (selectedCanonical && packCount && packCount > 1) {
    const parsed = parseWeightQuantity(
      quantityEvidence(selectedCanonical, "Amazon selected size", "selected size/pack controls")
    );
    if (parsed.available && parsed.quantity.itemCount === 1) {
      selectedCanonical = `${packCount} × ${parsed.quantity.amountPerItem} ${parsed.quantity.unit}`;
    }
  }
  const selectedEvidence = selectedCanonical
    ? quantityEvidence(selectedCanonical, "Amazon selected size", "#inline-twister-expander-header-size_name")
    : undefined;

  const detailRoots = [
    "#productFactsDesktop_feature_div",
    "#detailBullets_feature_div",
    "#productDetails_detailBullets_sections1"
  ];
  let unitsEvidence: QuantityEvidence | undefined;
  for (const selector of detailRoots) {
    const detailRoot = scope.querySelector<HTMLElement>(selector);
    if (!detailRoot || !isVisible(detailRoot)) {
      continue;
    }

    const unitsText = visibleTextOf(detailRoot).match(/\bunits?\s*[:\-]?\s*([^|;]+?(?:oz|ounces?|lbs?|pounds?|g|grams?|kg|kilograms?))\b/i)?.[1];
    const unitsCanonical = unitsText ? canonicalQuantity(unitsText) : undefined;
    if (unitsCanonical) {
      unitsEvidence = quantityEvidence(unitsCanonical, "Amazon Units field", selector);
      break;
    }
  }

  const titleCanonical = canonicalQuantity(productName);
  const titleConflict = embeddedWeightConflict(productName);
  if (titleConflict) {
    return { text: productName, reason: titleConflict };
  }
  const titleEvidence = titleCanonical
    ? quantityEvidence(titleCanonical, "Amazon product title", "#title")
    : undefined;
  const primary = selectedEvidence ?? unitsEvidence ?? titleEvidence;
  if (!primary) {
    return {
      text: selectedText || productName,
      reason: VOLUME_PATTERN.test(`${selectedText} ${productName}`)
        ? "Fluid volume is not supported"
        : "Net product weight unavailable"
    };
  }

  for (const corroboration of [unitsEvidence, titleEvidence]) {
    if (corroboration && corroboration !== primary && quantitiesConflict(primary, corroboration)) {
      return { text: `${primary.rawText}; ${corroboration.rawText}`, reason: "Conflicting net weights" };
    }
  }

  return { evidence: primary, text: primary.rawText };
}

function hasNativeFluidUnitEvidence(scope: HTMLElement): boolean {
  return Array.from(scope.querySelectorAll<HTMLElement>("span, div"))
    .filter((element) => !element.closest(OWNED_SELECTOR) && isVisible(element))
    .map(visibleTextOf)
    .filter((text) => text.length > 0 && text.length < 200)
    .some((text) => /(?:\/|\bper\s+)(?:fl\.?\s*oz|fluid\s+ounces?|ml|millilit(?:er|re)s?|lit(?:er|re)s?|l)\b/i.test(text));
}

function cardQuantity(card: HTMLElement, productName: string): QuantitySelection {
  if (VOLUME_PATTERN.test(productName) || hasNativeFluidUnitEvidence(card)) {
    return { text: productName, reason: "Fluid volume is not supported" };
  }
  if (mixedBundleNeedsComparableTotal(`${productName} ${visibleTextOf(card)}`)) {
    return { text: productName, reason: "Mixed bundle has no comparable net weight" };
  }
  if (hasUnresolvedCountBearingWeight(productName)) {
    return { text: productName, reason: "Selected offer is ambiguous" };
  }
  const titleConflict = embeddedWeightConflict(productName);
  if (titleConflict) {
    return { text: productName, reason: titleConflict };
  }
  const titleQuantity = canonicalQuantity(productName);
  const sizeLines = Array.from(card.querySelectorAll<HTMLElement>("span, div"))
    .filter((element) => !element.closest(OWNED_SELECTOR) && isVisible(element))
    .map(visibleTextOf)
    .filter((text) => text.length > 0 && text.length < 100)
    .map(canonicalQuantity)
    .filter((text): text is string => Boolean(text));
  const distinct = Array.from(new Set([titleQuantity, ...sizeLines].filter((text): text is string => Boolean(text))));

  if (distinct.length === 0) {
    if (/\b(?:variety|bundle|assortment)\b.*\b(?:bottle|accessor)/i.test(productName)) {
      return { text: productName, reason: "Mixed bundle has no comparable net weight" };
    }
    return {
      text: productName,
      reason: VOLUME_PATTERN.test(productName)
        ? "Fluid volume is not supported"
        : "Net product weight unavailable"
    };
  }

  const evidences = distinct.map((rawText) =>
    quantityEvidence(rawText, "Amazon result card", `${CARD_SELECTOR} h2`)
  );
  const primary = evidences[0];
  if (evidences.some((candidate) => quantitiesConflict(primary, candidate))) {
    return { text: distinct.join("; "), reason: "Conflicting net weights" };
  }

  return { evidence: primary, text: primary.rawText };
}

function storeUnitPrice(scope: HTMLElement): { priceDollars: number; quantity: QuantityEvidence; text: string } | undefined {
  const text = Array.from(scope.querySelectorAll<HTMLElement>("span, div"))
    .filter((element) => !element.closest(OWNED_SELECTOR) && isVisible(element))
    .map(visibleTextOf)
    .find((value) => /(?:\$\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*¢)\s*(?:\/|per\s+)(?:oz|ounce|lb|pound|100\s*g|kg)\b/i.test(value));
  if (!text || VOLUME_PATTERN.test(text)) {
    return undefined;
  }

  const match = text.match(/(\$|¢)?\s*(\d+(?:\.\d+)?)\s*(¢)?\s*(?:\/|per\s+)(oz|ounce|lb|pound|100\s*g|kg)\b/i);
  if (!match) {
    return undefined;
  }

  const unit = match[4].toLowerCase();
  const dollars = match[1] === "¢" || match[3] === "¢" ? Number(match[2]) / 100 : Number(match[2]);
  const basis = /^100\s*g$/.test(unit) ? "100 g" : unit === "ounce" ? "1 oz" : unit === "pound" ? "1 lb" : `1 ${unit}`;
  if (!Number.isFinite(dollars) || dollars <= 0) {
    return undefined;
  }

  return {
    priceDollars: dollars,
    quantity: quantityEvidence(basis, "Amazon store-provided unit price", CARD_SELECTOR),
    text
  };
}

function extractProduct(scope: HTMLElement): RetailerExtraction {
  const title = scope.querySelector<HTMLElement>("#title");
  const productName = title && isVisible(title) ? visibleTextOf(title) : "";
  const ordinaryPrice = oneTimePurchasePrice(scope);
  const centralPrice = currentAmazonPrice(
    scope.querySelector<HTMLElement>("#corePriceDisplay_desktop_feature_div") ?? scope
  );
  const buyBox = scope.querySelector<HTMLElement>("#buybox");
  const priceHost = buyBox && isVisible(buyBox)
    ? buyBox
    : centralPrice?.element.parentElement ?? undefined;
  const storeDisplayedUnitFormat = displayedUnitFormat(visibleTextOf(priceHost));
  const quantity = selectedAmazonQuantity(scope, productName);
  const sourceLabel = `Amazon product page${productName ? ` — ${productName}` : ""}`;

  if (ordinaryPrice?.unsupportedCurrency) {
    return {
      scope,
      host: priceHost,
      productName,
      priceText: ordinaryPrice.text || "Unsupported currency",
      quantityText: quantity.text,
      sourceLabel,
      unavailableReason: "Currency is not supported"
    };
  }

  if (!ordinaryPrice) {
    return {
      scope,
      host: priceHost,
      productName,
      priceText: centralPrice?.text ?? "Not found",
      quantityText: quantity.text,
      sourceLabel,
      unavailableReason: "Ordinary one-time price unavailable"
    };
  }

  if (quantity.reason || !quantity.evidence) {
    return {
      scope,
      host: priceHost,
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
    host: priceHost,
    productName,
    priceDollars: ordinaryPrice.value,
    priceText: ordinaryPrice.text,
    quantity: quantity.evidence,
    quantityText: quantity.text,
    sourceLabel,
    storeDisplayedUnitFormat
  };
}

function extractCard(scope: HTMLElement): RetailerExtraction {
  const productName = visibleTextOf(Array.from(scope.querySelectorAll<HTMLElement>("h2")).find(isVisible));
  const price = currentAmazonPrice(scope);
  const rawPrice = Array.from(scope.querySelectorAll<HTMLElement>(".a-price"))
    .find((element) => isVisible(element) && !element.classList.contains("a-text-price") && !element.closest(".a-text-price"));
  const conditionalPricePresent = Array.from(scope.querySelectorAll<HTMLElement>(".a-price"))
    .some((element) => isVisible(element) && isConditionalPriceContext(element));
  const host = (price?.element ?? rawPrice)?.closest<HTMLElement>(".a-row, .a-section")
    ?? (price?.element ?? rawPrice)?.parentElement
    ?? undefined;
  const storeDisplayedUnitFormat = displayedUnitFormat(visibleTextOf(host));
  const sourceLabel = `Amazon result card${productName ? ` — ${productName}` : ""}`;
  const cardText = visibleTextOf(scope);
  const selectedControl = Array.from(
    scope.querySelectorAll<HTMLElement>(
      'input[type="radio"]:checked, input[type="checkbox"]:checked, [aria-checked="true"], [aria-selected="true"]'
    )
  ).find((control) => {
    const controlText = amazonControlText(control, scope);
    return /\b(?:single|pack|size|count|oz|ounce|lb|pound|gram|kg|kilo)\b|\$\s*\d/i.test(controlText);
  });
  const optionRange = /\b(?:options?|from)\b[^$]{0,40}\$\s*\d[^–—-]*(?:[–—-]|\bto\b)\s*\$\s*\d/i.test(cardText);
  const distinctPrices = Array.from(
    new Set(
      Array.from(scope.querySelectorAll<HTMLElement>(".a-price"))
        .filter(isEligibleCurrentPriceNode)
        .map((element) => moneyFromText(amazonPriceText(element)).value)
        .filter((value): value is number => value !== undefined)
        .map((value) => value.toFixed(2))
    )
  );
  const quantity: QuantitySelection = productName
    ? cardQuantity(scope, productName)
    : { text: "Not found", reason: "Net product weight unavailable" };

  if (price?.unsupportedCurrency || moneyFromText(rawPrice ? amazonPriceText(rawPrice) : "").unsupportedCurrency) {
    return {
      scope,
      host,
      productName,
      priceText: price?.unsupportedCurrency ? price.text : rawPrice ? amazonPriceText(rawPrice) : "Unsupported currency",
      quantityText: quantity.text,
      sourceLabel,
      unavailableReason: "Currency is not supported"
    };
  }

  if ((optionRange || distinctPrices.length > 1) && !selectedControl) {
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

  if ((optionRange || distinctPrices.length > 1) && selectedControl && price) {
    const selectedPrice = moneyFromText(amazonControlText(selectedControl, scope)).value;
    if (selectedPrice === undefined) {
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
    if (Math.abs(selectedPrice - price.value) > 0.005) {
      return {
        scope,
        host,
        productName,
        priceText: `${price.text}; selected option $${selectedPrice.toFixed(2)}`,
        quantityText: quantity.text,
        sourceLabel,
        unavailableReason: "Price does not match selected offer"
      };
    }
  }

  if (!price) {
    return {
      scope,
      host,
      productName,
      priceText: "Not found",
      quantityText: quantity.text,
      sourceLabel,
      unavailableReason: conditionalPricePresent || /\b(?:subscribe|members? only|membership price|prime exclusive)\b/i.test(cardText)
        ? "Ordinary one-time price unavailable"
        : /\b(?:collection|shop all|see options)\b/i.test(cardText)
          ? "Exact offer unavailable"
          : "Price unavailable"
    };
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
      storeDisplayedUnitFormat
    };
  }

  const storeUnit = storeUnitPrice(scope);
  if (storeUnit && quantity.reason === "Net product weight unavailable") {
    return {
      scope,
      host,
      productName,
      priceDollars: storeUnit.priceDollars,
      priceText: `${storeUnit.text} (store-provided unit price)`,
      quantity: storeUnit.quantity,
      quantityText: `${storeUnit.quantity.rawText} store unit basis`,
      sourceLabel: `${sourceLabel}; store-provided unit price, not independently recalculated`,
      storeProvidedUnitPrice: true,
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

export function collectAmazonScopes(root: ParentNode): HTMLElement[] {
  const scopes: HTMLElement[] = [];
  if (root instanceof HTMLElement && root.matches(PRODUCT_SELECTOR)) {
    scopes.push(root);
  }
  if (root instanceof HTMLElement && isCardScope(root)) {
    knownCardScopes.add(root);
    scopes.push(root);
  }
  scopes.push(...root.querySelectorAll<HTMLElement>(PRODUCT_SELECTOR));
  const cards = Array.from(root.querySelectorAll<HTMLElement>(CARD_SELECTOR)).filter(isCardScope);
  cards.forEach((card) => knownCardScopes.add(card));
  scopes.push(...cards);
  return Array.from(new Set(scopes));
}

export function closestAmazonScope(node: Node): HTMLElement | null {
  const element = node instanceof Element ? node : node.parentElement;
  return cardRoot(element) ?? element?.closest<HTMLElement>(PRODUCT_SELECTOR) ?? null;
}

export function extractAmazon(scope: HTMLElement): RetailerExtraction {
  return isCardScope(scope) ? extractCard(scope) : extractProduct(scope);
}

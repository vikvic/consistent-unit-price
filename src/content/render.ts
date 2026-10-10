import type { CalculationResult } from "../core/types";

const ROOT_ATTRIBUTE = "data-cup-root";
const OVERLAY_ANCHOR_ATTRIBUTE = "data-cup-overlay-anchor";

export interface UnitPriceOverlay {
  element: HTMLElement;
  overlay: HTMLElement;
  originalInlinePosition: string;
}

export interface UnitPriceOverlayOptions {
  converted?: boolean;
}

export interface UnitPriceRenderDetails {
  priceText: string;
  quantityText: string;
  sourceLabel: string;
  methodText?: string;
  variant?: "inline" | "panel";
}

function getOrCreateRoot(host: HTMLElement): HTMLElement {
  const existing = Array.from(host.children).find(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && child.hasAttribute(ROOT_ATTRIBUTE)
  );

  if (existing) {
    return existing;
  }

  const root = document.createElement("div");
  root.className = "cup-unit-price";
  root.setAttribute(ROOT_ATTRIBUTE, "");
  root.setAttribute("aria-label", "Consistent Unit Price extension result");
  root.setAttribute("aria-live", "polite");

  const details = document.createElement("details");
  details.className = "cup-unit-price__details";
  details.innerHTML = `
    <summary class="cup-unit-price__badge">
      <span data-cup-status></span>
      <span class="cup-unit-price__badge-owner">CUP</span>
    </summary>
    <div class="cup-unit-price__panel">
      <p class="cup-unit-price__owner">Consistent Unit Price extension</p>
      <dl>
        <div><dt>Result</dt><dd data-cup-result></dd></div>
        <div><dt>Price</dt><dd data-cup-price></dd></div>
        <div><dt>Quantity</dt><dd data-cup-quantity></dd></div>
        <div><dt>Method</dt><dd data-cup-method></dd></div>
        <div><dt>Source</dt><dd data-cup-source></dd></div>
      </dl>
    </div>
  `;

  root.append(details);
  host.append(root);
  return root;
}

function setText(root: HTMLElement, selector: string, value: string): void {
  const element = root.querySelector<HTMLElement>(selector);
  if (element) {
    element.textContent = value;
  }
}

export function renderUnitPrice(
  host: HTMLElement,
  result: CalculationResult,
  details: UnitPriceRenderDetails
): void {
  const root = getOrCreateRoot(host);
  root.dataset.cupAvailability = result.available ? "available" : "unavailable";
  root.dataset.cupVariant = details.variant ?? "panel";

  setText(root, "[data-cup-status]", result.available ? result.label : "Can't compare");
  setText(root, "[data-cup-result]", result.label);
  setText(root, "[data-cup-price]", details.priceText);
  setText(
    root,
    "[data-cup-quantity]",
    result.available
      ? `${details.quantityText} (${result.quantity.normalizedText}; ${result.quantity.totalGrams.toFixed(3)} g total)`
      : details.quantityText
  );
  setText(root, "[data-cup-source]", details.sourceLabel);
  setText(
    root,
    "[data-cup-method]",
    details.methodText ?? "Independent calculation from the visible price and net weight"
  );
}

export function removeUnitPrice(host: HTMLElement): void {
  const root = Array.from(host.children).find(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && child.hasAttribute(ROOT_ATTRIBUTE)
  );
  root?.remove();
}

export function removeUnitPricesWithin(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>(`[${ROOT_ATTRIBUTE}]`).forEach((element) => element.remove());
}

function normalizedText(value: string | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function renderedArea(element: HTMLElement): number {
  // aria-hidden affects the accessibility tree, not visual rendering. Walmart's
  // visible price row is aria-hidden because it has a separate screen-reader label.
  if (!element.isConnected || element.closest("[hidden]")) {
    return 0;
  }

  let current: HTMLElement | null = element;
  while (current) {
    const style = getComputedStyle(current);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      style.opacity === "0" ||
      (style.clip !== "auto" && style.clip !== "") ||
      (style.clipPath !== "none" && style.clipPath !== "")
    ) {
      return 0;
    }
    current = current.parentElement;
  }

  return Array.from(element.getClientRects()).reduce(
    (largest, rect) => Math.max(largest, rect.width * rect.height),
    0
  );
}

export function overlayUnitPriceText(
  host: HTMLElement,
  originalUnitPrice: string,
  displayedUnitPrice: string,
  options: UnitPriceOverlayOptions = {}
): UnitPriceOverlay | undefined {
  const original = normalizedText(originalUnitPrice);
  const candidates = [host, ...host.querySelectorAll<HTMLElement>("*")]
    .filter((element) => !element.closest(`[${ROOT_ATTRIBUTE}]`))
    .filter((element) => normalizedText(element.textContent) === original)
    .map((element) => ({ element, area: renderedArea(element) }))
    .filter((candidate) => candidate.area > 4)
    .sort((left, right) =>
      right.area - left.area || left.element.childElementCount - right.element.childElementCount
    );
  const element = candidates[0]?.element;
  if (!element) {
    return undefined;
  }

  const originalInlinePosition = element.style.position;
  if (getComputedStyle(element).position === "static") {
    element.style.position = "relative";
  }
  element.setAttribute(OVERLAY_ANCHOR_ATTRIBUTE, "");

  const overlay = document.createElement("span");
  overlay.className = "cup-unit-price-overlay";
  overlay.setAttribute(ROOT_ATTRIBUTE, "");
  const converted = options.converted ?? true;
  overlay.setAttribute(
    "aria-label",
    converted ? `Converted unit price ${displayedUnitPrice}` : `Unit price ${displayedUnitPrice}`
  );
  overlay.title = converted
    ? "Converted by Consistent Unit Price"
    : "Standardized by Consistent Unit Price";
  overlay.textContent = displayedUnitPrice;
  element.append(overlay);

  if (renderedArea(overlay) <= 4) {
    overlay.remove();
    element.style.position = originalInlinePosition;
    element.removeAttribute(OVERLAY_ANCHOR_ATTRIBUTE);
    return undefined;
  }

  return { element, overlay, originalInlinePosition };
}

export function removeUnitPriceOverlay(unitPriceOverlay: UnitPriceOverlay): void {
  unitPriceOverlay.overlay.remove();
  unitPriceOverlay.element.style.position = unitPriceOverlay.originalInlinePosition;
  unitPriceOverlay.element.removeAttribute(OVERLAY_ANCHOR_ATTRIBUTE);
}

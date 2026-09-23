import type { DisplayFormat, UnavailableReason } from "./types";

const REASON_MESSAGES: Readonly<Record<UnavailableReason, string>> = {
  "volume-is-not-weight": "volume is not weight",
  "invalid-quantity": "invalid quantity",
  "ambiguous-quantity": "ambiguous quantity",
  "conflicting-quantity": "conflicting quantities",
  "shipping-weight-not-product-weight": "shipping weight is not product weight",
  "unsupported-unit": "unsupported unit",
  "invalid-price": "invalid price"
};

export function unavailableReasonMessage(reason: UnavailableReason): string {
  return REASON_MESSAGES[reason];
}

export function formatUnavailable(reason: UnavailableReason): string {
  return `Unavailable: ${unavailableReasonMessage(reason)}`;
}

export function formatUnitPrice(value: number, format: DisplayFormat): string {
  if (format === "cents-per-ounce") {
    return value > 0 && value < 0.01
      ? "< 0.01 cents/oz"
      : `${value.toFixed(2)} cents/oz`;
  }

  const suffix: Readonly<Record<Exclude<DisplayFormat, "cents-per-ounce">, string>> = {
    "dollars-per-ounce": "/oz",
    "dollars-per-pound": "/lb",
    "dollars-per-100-grams": "/100 g",
    "dollars-per-kilogram": "/kg"
  };

  if (value > 0 && value < 0.01) {
    return `< $0.01${suffix[format]}`;
  }

  return `$${value.toFixed(2)}${suffix[format]}`;
}

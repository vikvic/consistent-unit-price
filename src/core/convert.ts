import { formatUnavailable, formatUnitPrice } from "./format";
import { parseWeightQuantity } from "./quantity";
import type {
  CalculationInput,
  CalculationResult,
  DisplayFormat
} from "./types";

const GRAMS_PER_OUNCE = 28.349523125;
const GRAMS_PER_POUND = 453.59237;

function calculateValue(
  priceDollars: number,
  totalGrams: number,
  format: DisplayFormat
): number {
  switch (format) {
    case "cents-per-ounce":
      return (priceDollars * 100) / (totalGrams / GRAMS_PER_OUNCE);
    case "dollars-per-ounce":
      return priceDollars / (totalGrams / GRAMS_PER_OUNCE);
    case "dollars-per-pound":
      return priceDollars / (totalGrams / GRAMS_PER_POUND);
    case "dollars-per-100-grams":
      return priceDollars / (totalGrams / 100);
    case "dollars-per-kilogram":
      return priceDollars / (totalGrams / 1000);
  }
}

export function calculateUnitPrice(input: CalculationInput): CalculationResult {
  if (!Number.isFinite(input.priceDollars) || input.priceDollars <= 0) {
    return {
      available: false,
      format: input.format,
      reason: "invalid-price",
      label: formatUnavailable("invalid-price")
    };
  }

  const parsedQuantity = parseWeightQuantity(input.quantity);
  if (!parsedQuantity.available) {
    return {
      available: false,
      format: input.format,
      reason: parsedQuantity.reason,
      label: formatUnavailable(parsedQuantity.reason)
    };
  }

  const value = calculateValue(
    input.priceDollars,
    parsedQuantity.quantity.totalGrams,
    input.format
  );
  if (!Number.isFinite(value) || value <= 0) {
    return {
      available: false,
      format: input.format,
      reason: "invalid-quantity",
      label: formatUnavailable("invalid-quantity")
    };
  }

  return {
    available: true,
    format: input.format,
    value,
    label: formatUnitPrice(value, input.format),
    quantity: parsedQuantity.quantity,
    provenance: input.provenance
  };
}

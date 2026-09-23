import type {
  NormalizedQuantity,
  QuantityEvidence,
  QuantityParseResult,
  UnavailableReason,
  WeightUnit
} from "./types";

const OUNCES_TO_GRAMS = 28.349523125;
const POUNDS_TO_GRAMS = 453.59237;

const UNIT_ALIASES: Readonly<Record<string, WeightUnit>> = {
  oz: "oz",
  ounce: "oz",
  ounces: "oz",
  lb: "lb",
  lbs: "lb",
  pound: "lb",
  pounds: "lb",
  g: "g",
  gram: "g",
  grams: "g",
  kg: "kg",
  kilo: "kg",
  kilos: "kg",
  kilogram: "kg",
  kilograms: "kg"
};

const UNIT_PATTERN = "(oz|ounces?|lbs?|pounds?|g|grams?|kg|kilos?|kilograms?)";
const NUMBER_PATTERN = "(\\d+(?:\\.\\d+)?)";
const SINGLE_PATTERN = new RegExp(`^${NUMBER_PATTERN}\\s*${UNIT_PATTERN}\\.?$`, "i");
const COUNT_FIRST_PATTERN = new RegExp(
  `^${NUMBER_PATTERN}\\s*[x×]\\s*${NUMBER_PATTERN}\\s*${UNIT_PATTERN}\\.?$`,
  "i"
);
const COUNT_LAST_PATTERN = new RegExp(
  `^${NUMBER_PATTERN}\\s*${UNIT_PATTERN}\\s*[x×]\\s*${NUMBER_PATTERN}\\.?$`,
  "i"
);
const PACK_OF_PATTERN = new RegExp(
  `^pack\\s+of\\s+${NUMBER_PATTERN}\\s*[,;:]?\\s*${NUMBER_PATTERN}\\s*${UNIT_PATTERN}(?:\\s+each)?\\.?$`,
  "i"
);
const NUMBER_PACK_PATTERN = new RegExp(
  `^${NUMBER_PATTERN}\\s*[- ]?pack(?:\\s+of)?\\s*[,;:]?\\s*${NUMBER_PATTERN}\\s*${UNIT_PATTERN}(?:\\s+each)?\\.?$`,
  "i"
);
const PACK_SUFFIX_PATTERN = new RegExp(
  `^${NUMBER_PATTERN}\\s*${UNIT_PATTERN}\\s*\\(\\s*pack\\s+of\\s+${NUMBER_PATTERN}\\s*\\)\\.?$`,
  "i"
);
const COUNT_SUFFIX_PATTERN = new RegExp(
  `^${NUMBER_PATTERN}\\s*${UNIT_PATTERN}\\s*[,;]?\\s*${NUMBER_PATTERN}\\s*count\\.?$`,
  "i"
);
const NESTED_PACK_PATTERN = new RegExp(
  `^\\(\\s*${NUMBER_PATTERN}\\s*pack\\s*\\)\\s*${NUMBER_PATTERN}\\s*${UNIT_PATTERN}\\s*[,;]?\\s*${NUMBER_PATTERN}\\s*count\\.?$`,
  "i"
);

const VOLUME_PATTERN = /\b(?:fl\.?\s*oz|fluid\s+ounces?|ml|millilit(?:er|re)s?|lit(?:er|re)s?|l)\b/i;
const WEIGHT_UNIT_PATTERN = /\b(?:oz|ounces?|lbs?|pounds?|g|grams?|kg|kilos?|kilograms?)\b/gi;

export function gramsFor(amount: number, unit: WeightUnit): number {
  switch (unit) {
    case "oz":
      return amount * OUNCES_TO_GRAMS;
    case "lb":
      return amount * POUNDS_TO_GRAMS;
    case "g":
      return amount;
    case "kg":
      return amount * 1000;
  }
}

function failure(reason: UnavailableReason): QuantityParseResult {
  return { available: false, reason };
}

function buildQuantity(
  rawCount: string,
  rawAmount: string,
  rawUnit: string
): QuantityParseResult {
  const itemCount = Number(rawCount);
  const amountPerItem = Number(rawAmount);
  const unit = UNIT_ALIASES[rawUnit.toLowerCase()];

  if (
    !unit ||
    !Number.isInteger(itemCount) ||
    !Number.isFinite(amountPerItem) ||
    itemCount <= 0 ||
    amountPerItem <= 0
  ) {
    return failure("invalid-quantity");
  }

  const totalGrams = gramsFor(itemCount * amountPerItem, unit);
  if (!Number.isFinite(totalGrams) || totalGrams <= 0) {
    return failure("invalid-quantity");
  }

  const normalized: NormalizedQuantity = {
    itemCount,
    amountPerItem,
    unit,
    totalGrams,
    normalizedText:
      itemCount === 1
        ? `${amountPerItem} ${unit}`
        : `${itemCount} × ${amountPerItem} ${unit}`
  };

  return { available: true, quantity: normalized };
}

function buildNestedQuantity(
  rawOuterCount: string,
  rawAmount: string,
  rawUnit: string,
  rawInnerCount: string
): QuantityParseResult {
  const outerCount = Number(rawOuterCount);
  const innerCount = Number(rawInnerCount);
  if (!Number.isInteger(outerCount) || !Number.isInteger(innerCount)) {
    return failure("invalid-quantity");
  }

  return buildQuantity(String(outerCount * innerCount), rawAmount, rawUnit);
}

export function parseWeightQuantity(evidence: QuantityEvidence): QuantityParseResult {
  const input = evidence.rawText.trim().replace(/\s+/g, " ");

  if (evidence.kind === "shipping-weight" || /\bshipping\b/i.test(input)) {
    return failure("shipping-weight-not-product-weight");
  }

  if (VOLUME_PATTERN.test(input)) {
    return failure("volume-is-not-weight");
  }

  if (
    !input ||
    /(^|\s)-\s*\d/.test(input) ||
    /(?:^|[x×\s])0(?:\.0+)?(?:\s|$)/i.test(input)
  ) {
    return failure("invalid-quantity");
  }

  const weightUnits = input.match(WEIGHT_UNIT_PATTERN) ?? [];
  if (weightUnits.length > 1) {
    return failure("conflicting-quantity");
  }

  let match = input.match(COUNT_FIRST_PATTERN);
  if (match) {
    return buildQuantity(match[1], match[2], match[3]);
  }

  match = input.match(COUNT_LAST_PATTERN);
  if (match) {
    return buildQuantity(match[3], match[1], match[2]);
  }

  match = input.match(PACK_OF_PATTERN);
  if (match) {
    return buildQuantity(match[1], match[2], match[3]);
  }

  match = input.match(NUMBER_PACK_PATTERN);
  if (match) {
    return buildQuantity(match[1], match[2], match[3]);
  }

  match = input.match(PACK_SUFFIX_PATTERN);
  if (match) {
    return buildQuantity(match[3], match[1], match[2]);
  }

  match = input.match(COUNT_SUFFIX_PATTERN);
  if (match) {
    return buildQuantity(match[3], match[1], match[2]);
  }

  match = input.match(NESTED_PACK_PATTERN);
  if (match) {
    return buildNestedQuantity(match[1], match[2], match[3], match[4]);
  }

  match = input.match(SINGLE_PATTERN);
  if (match) {
    return buildQuantity("1", match[1], match[2]);
  }

  if (weightUnits.length === 0) {
    return failure(/\d/.test(input) ? "unsupported-unit" : "invalid-quantity");
  }

  return failure("ambiguous-quantity");
}

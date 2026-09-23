export const DISPLAY_FORMATS = [
  "cents-per-ounce",
  "dollars-per-ounce",
  "dollars-per-pound",
  "dollars-per-100-grams",
  "dollars-per-kilogram"
] as const;

export type DisplayFormat = (typeof DISPLAY_FORMATS)[number];
export type FormatMode = "manual" | "automatic";
export type DisplayStyle = "label" | "overlay";
export type WeightUnit = "oz" | "lb" | "g" | "kg";
export type Retailer = "amazon" | "walmart";

export const DISPLAY_FORMAT_LABELS: Readonly<Record<DisplayFormat, string>> = {
  "cents-per-ounce": "Cents per ounce",
  "dollars-per-ounce": "Dollars per ounce",
  "dollars-per-pound": "Dollars per pound",
  "dollars-per-100-grams": "Dollars per 100 grams",
  "dollars-per-kilogram": "Dollars per kilogram"
};

export type UnavailableReason =
  | "volume-is-not-weight"
  | "invalid-quantity"
  | "ambiguous-quantity"
  | "conflicting-quantity"
  | "shipping-weight-not-product-weight"
  | "unsupported-unit"
  | "invalid-price";

export type QuantityEvidenceKind =
  | "product-weight"
  | "shipping-weight"
  | "unknown";

export interface EvidenceProvenance {
  source: "retailer-page" | "manual" | "static-demo";
  observedAt: string;
  sourceLabel: string;
  selector?: string;
}

export interface QuantityEvidence {
  rawText: string;
  kind: QuantityEvidenceKind;
  provenance?: EvidenceProvenance;
}

export interface ProductEvidence {
  retailer: Retailer;
  productName?: string;
  productUrl: string;
  provenance: EvidenceProvenance;
}

export interface OfferEvidence {
  currency: "USD";
  priceDollars: number;
  quantity?: QuantityEvidence;
  inStock: boolean;
  provenance: EvidenceProvenance;
}

export interface NormalizedQuantity {
  itemCount: number;
  amountPerItem: number;
  unit: WeightUnit;
  totalGrams: number;
  normalizedText: string;
}

export interface QuantityParseSuccess {
  available: true;
  quantity: NormalizedQuantity;
}

export interface QuantityParseFailure {
  available: false;
  reason: UnavailableReason;
}

export type QuantityParseResult = QuantityParseSuccess | QuantityParseFailure;

export interface CalculationInput {
  priceDollars: number;
  quantity: QuantityEvidence;
  format: DisplayFormat;
  provenance?: CalculationProvenance;
}

export interface CalculationProvenance {
  price: EvidenceProvenance;
  quantity: EvidenceProvenance;
}

export interface AvailableCalculationResult {
  available: true;
  format: DisplayFormat;
  value: number;
  label: string;
  quantity: NormalizedQuantity;
  provenance?: CalculationProvenance;
}

export interface UnavailableCalculationResult {
  available: false;
  format: DisplayFormat;
  reason: UnavailableReason;
  label: string;
}

export type CalculationResult =
  | AvailableCalculationResult
  | UnavailableCalculationResult;

export interface ExtensionSettings {
  preferredFormat: DisplayFormat;
  formatMode: FormatMode;
  displayStyle: DisplayStyle;
  amazonEnabled: boolean;
  walmartEnabled: boolean;
}

export interface SettingsUpdatedMessage {
  type: "cup/settings-updated";
  settings: ExtensionSettings;
}

export type RetailerUnavailableMessage =
  | "Price unavailable"
  | "Ordinary one-time price unavailable"
  | "Net product weight unavailable"
  | "Selected offer is ambiguous"
  | "Price does not match selected offer"
  | "Conflicting net weights"
  | "Fluid volume is not supported"
  | "Mixed bundle has no comparable net weight"
  | "Exact offer unavailable"
  | "Currency is not supported";

export interface RetailerExtraction {
  scope: HTMLElement;
  host?: HTMLElement;
  productName?: string;
  priceDollars?: number;
  priceText: string;
  quantity?: QuantityEvidence;
  quantityText: string;
  sourceLabel: string;
  unavailableReason?: RetailerUnavailableMessage;
  storeProvidedUnitPrice?: boolean;
  storeDisplayedUnitPriceText?: string;
  storeDisplayedUnitFormat?: DisplayFormat;
}

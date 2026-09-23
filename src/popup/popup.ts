import { calculateUnitPrice } from "../core/convert";
import {
  DISPLAY_FORMATS,
  DISPLAY_FORMAT_LABELS,
  type DisplayFormat,
  type ExtensionSettings
} from "../core/types";
import { renderUnitPrice } from "../content/render";
import {
  DEFAULT_SETTINGS,
  getSettings,
  subscribeSettings,
  updateSettings
} from "../settings";

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing popup element: ${id}`);
  }
  return element as T;
}

const formatOptions = requiredElement<HTMLElement>("preferred-format-options");
const displayStyleOptions = requiredElement<HTMLElement>("display-style-options");
const amazonToggle = requiredElement<HTMLInputElement>("amazon-enabled");
const walmartToggle = requiredElement<HTMLInputElement>("walmart-enabled");
const settingsStatus = requiredElement<HTMLParagraphElement>("settings-status");
const calculatorForm = requiredElement<HTMLFormElement>("manual-calculator");
const priceInput = requiredElement<HTMLInputElement>("manual-price");
const quantityInput = requiredElement<HTMLInputElement>("manual-quantity");
const manualOutput = requiredElement<HTMLElement>("manual-output");
const manualResult = requiredElement<HTMLParagraphElement>("manual-result");
const detailPrice = requiredElement<HTMLElement>("manual-detail-price");
const detailQuantity = requiredElement<HTMLElement>("manual-detail-quantity");
const detailFormat = requiredElement<HTMLElement>("manual-detail-format");
const automaticPreview = requiredElement<HTMLElement>("automatic-preview");

let currentSettings: ExtensionSettings = { ...DEFAULT_SETTINGS };
let hasManualResult = false;

function addRadioOption(
  container: HTMLElement,
  name: string,
  value: string,
  labelText: string,
  fullWidth = false
): void {
  const label = document.createElement("label");
  label.className = fullWidth ? "cup-choice cup-choice--wide" : "cup-choice";
  const input = document.createElement("input");
  input.type = "radio";
  input.name = name;
  input.value = value;
  const text = document.createElement("span");
  text.textContent = labelText;
  label.append(input, text);
  container.append(label);
}

addRadioOption(
  formatOptions,
  "preferredFormat",
  "automatic",
  "Automatic — most common on this page",
  true
);

for (const format of DISPLAY_FORMATS) {
  addRadioOption(formatOptions, "preferredFormat", format, DISPLAY_FORMAT_LABELS[format]);
}

function selectRadio(container: HTMLElement, value: string): void {
  const input = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
    .find((candidate) => candidate.value === value);
  if (input) {
    input.checked = true;
  }
}

function renderAutomaticPreview(format: DisplayFormat): void {
  const result = calculateUnitPrice({
    priceDollars: 6,
    quantity: { rawText: "12 oz", kind: "product-weight" },
    format
  });

  renderUnitPrice(automaticPreview, result, {
    priceText: "$6.00",
    quantityText: "12 oz",
    sourceLabel: "Static demonstration only — no retailer data was read"
  });
}

function calculateManualResult(): void {
  const priceDollars = Number(priceInput.value);
  const quantityText = quantityInput.value;
  const result = calculateUnitPrice({
    priceDollars,
    quantity: { rawText: quantityText, kind: "product-weight" },
    format: currentSettings.preferredFormat
  });

  manualResult.textContent = result.label;
  detailPrice.textContent = Number.isFinite(priceDollars)
    ? `$${priceDollars.toFixed(2)}`
    : priceInput.value;
  detailQuantity.textContent = result.available
    ? `${quantityText} (${result.quantity.normalizedText}; ${result.quantity.totalGrams.toFixed(3)} g total)`
    : quantityText || "Not provided";
  detailFormat.textContent = DISPLAY_FORMAT_LABELS[currentSettings.preferredFormat];
  manualOutput.hidden = false;
  hasManualResult = true;
}

function applySettings(settings: ExtensionSettings): void {
  currentSettings = settings;
  selectRadio(formatOptions, settings.formatMode === "automatic"
    ? "automatic"
    : settings.preferredFormat);
  selectRadio(displayStyleOptions, settings.displayStyle);
  amazonToggle.checked = settings.amazonEnabled;
  walmartToggle.checked = settings.walmartEnabled;
  renderAutomaticPreview(settings.preferredFormat);

  if (hasManualResult) {
    calculateManualResult();
  }
}

async function persistSettings(patch: Partial<ExtensionSettings>): Promise<void> {
  settingsStatus.textContent = "Saving…";
  try {
    const settings = await updateSettings(patch);
    applySettings(settings);
    settingsStatus.textContent = "Saved.";
  } catch {
    settingsStatus.textContent = "Settings could not be saved.";
  }
}

formatOptions.addEventListener("change", (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || input.name !== "preferredFormat") {
    return;
  }
  if (input.value === "automatic") {
    void persistSettings({ formatMode: "automatic" });
    return;
  }
  void persistSettings({
    formatMode: "manual",
    preferredFormat: input.value as DisplayFormat
  });
});

displayStyleOptions.addEventListener("change", (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || input.name !== "displayStyle") {
    return;
  }
  void persistSettings({
    displayStyle: input.value === "overlay" ? "overlay" : "label"
  });
});

amazonToggle.addEventListener("change", () => {
  void persistSettings({ amazonEnabled: amazonToggle.checked });
});

walmartToggle.addEventListener("change", () => {
  void persistSettings({ walmartEnabled: walmartToggle.checked });
});

calculatorForm.addEventListener("submit", (event) => {
  event.preventDefault();
  calculateManualResult();
});

const unsubscribe = subscribeSettings(applySettings);
window.addEventListener("unload", unsubscribe, { once: true });

getSettings()
  .then(applySettings)
  .catch(() => {
    applySettings({ ...DEFAULT_SETTINGS });
    settingsStatus.textContent = "Stored settings could not be loaded; defaults are shown.";
  });

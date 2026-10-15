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
import {
  SUPPORTED_SITE_ACCESS,
  activateSiteOnCurrentTab,
  hasSiteAccess,
  removeSiteAccess,
  requestSiteAccess,
  type SupportedSiteAccess
} from "../site-permissions";

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

async function refreshPermissionControls(): Promise<void> {
  const [amazonGranted, walmartGranted] = await Promise.all([
    hasSiteAccess(SUPPORTED_SITE_ACCESS.amazon),
    hasSiteAccess(SUPPORTED_SITE_ACCESS.walmart)
  ]);
  amazonToggle.checked = amazonGranted;
  walmartToggle.checked = walmartGranted;
}

function synchronizeSiteAccess(): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "cup/synchronize-site-access" }, (response?: {
      ok?: boolean;
      message?: string;
    }) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      if (!response?.ok) {
        reject(new Error(response?.message ?? "Site access could not be synchronized."));
        return;
      }
      resolve();
    });
  });
}

async function changeSiteAccess(
  site: SupportedSiteAccess,
  toggle: HTMLInputElement
): Promise<void> {
  toggle.disabled = true;
  settingsStatus.textContent = toggle.checked
    ? `Requesting access to ${site.label}…`
    : `Removing access to ${site.label}…`;

  try {
    if (toggle.checked) {
      const granted = await requestSiteAccess(site);
      if (!granted) {
        toggle.checked = false;
        await synchronizeSiteAccess();
        settingsStatus.textContent = `${site.label} access was not granted.`;
        return;
      }

      await synchronizeSiteAccess();
      let activated = false;
      try {
        activated = await activateSiteOnCurrentTab(site);
      } catch {
        // Access remains enabled even if the current tab cannot be injected.
      }
      settingsStatus.textContent = activated
        ? `${site.label} enabled on this page.`
        : `${site.label} enabled. Open or reload a ${site.label} page.`;
      return;
    }

    const removed = await removeSiteAccess(site);
    if (!removed && await hasSiteAccess(site)) {
      toggle.checked = true;
      settingsStatus.textContent = `${site.label} access could not be removed.`;
      return;
    }
    await synchronizeSiteAccess();
    settingsStatus.textContent = `${site.label} disabled.`;
  } catch {
    toggle.checked = await hasSiteAccess(site).catch(() => !toggle.checked);
    settingsStatus.textContent = `${site.label} access could not be changed.`;
  } finally {
    toggle.disabled = false;
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
  void changeSiteAccess(SUPPORTED_SITE_ACCESS.amazon, amazonToggle);
});

walmartToggle.addEventListener("change", () => {
  void changeSiteAccess(SUPPORTED_SITE_ACCESS.walmart, walmartToggle);
});

calculatorForm.addEventListener("submit", (event) => {
  event.preventDefault();
  calculateManualResult();
});

const unsubscribe = subscribeSettings(applySettings);
window.addEventListener("unload", unsubscribe, { once: true });

getSettings()
  .then(async (settings) => {
    applySettings(settings);
    await refreshPermissionControls();
  })
  .catch(() => {
    applySettings({ ...DEFAULT_SETTINGS });
    settingsStatus.textContent = "Stored settings could not be loaded; defaults are shown.";
  });

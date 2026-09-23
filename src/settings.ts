import {
  DISPLAY_FORMATS,
  type DisplayFormat,
  type DisplayStyle,
  type ExtensionSettings
} from "./core/types";

const STORAGE_KEY = "settings";
let updateSequence: Promise<void> = Promise.resolve();

export const DEFAULT_SETTINGS: Readonly<ExtensionSettings> = {
  preferredFormat: "dollars-per-pound",
  formatMode: "manual",
  displayStyle: "overlay",
  amazonEnabled: true,
  walmartEnabled: true
};

function isDisplayFormat(value: unknown): value is DisplayFormat {
  return DISPLAY_FORMATS.includes(value as DisplayFormat);
}

function isDisplayStyle(value: unknown): value is DisplayStyle {
  return value === "label" || value === "overlay";
}

function normalizeSettings(value: unknown): ExtensionSettings {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_SETTINGS };
  }

  const stored = value as Partial<ExtensionSettings>;
  const storedDisplayStyle = (value as Record<string, unknown>).displayStyle;
  return {
    preferredFormat: isDisplayFormat(stored.preferredFormat)
      ? stored.preferredFormat
      : DEFAULT_SETTINGS.preferredFormat,
    formatMode: stored.formatMode === "automatic" ? "automatic" : "manual",
    displayStyle: storedDisplayStyle === "replace"
      ? "overlay"
      : isDisplayStyle(storedDisplayStyle)
        ? storedDisplayStyle
        : DEFAULT_SETTINGS.displayStyle,
    amazonEnabled:
      typeof stored.amazonEnabled === "boolean"
        ? stored.amazonEnabled
        : DEFAULT_SETTINGS.amazonEnabled,
    walmartEnabled:
      typeof stored.walmartEnabled === "boolean"
        ? stored.walmartEnabled
        : DEFAULT_SETTINGS.walmartEnabled
  };
}

export async function getSettings(): Promise<ExtensionSettings> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(STORAGE_KEY, (stored) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve(normalizeSettings(stored[STORAGE_KEY]));
    });
  });
}

export function updateSettings(
  patch: Partial<ExtensionSettings>
): Promise<ExtensionSettings> {
  const update = updateSequence.then(async () => {
    const current = await getSettings();
    const settings = normalizeSettings({ ...current, ...patch });
    await new Promise<void>((resolve, reject) => {
      chrome.storage.local.set({ [STORAGE_KEY]: settings }, () => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }

        resolve();
      });
    });
    return settings;
  });

  updateSequence = update.then(
    () => undefined,
    () => undefined
  );
  return update;
}

export function subscribeSettings(
  listener: (settings: ExtensionSettings) => void
): () => void {
  const handleChange = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string
  ): void => {
    if (areaName !== "local" || !changes[STORAGE_KEY]) {
      return;
    }

    listener(normalizeSettings(changes[STORAGE_KEY].newValue));
  };

  chrome.storage.onChanged.addListener(handleChange);
  return () => chrome.storage.onChanged.removeListener(handleChange);
}

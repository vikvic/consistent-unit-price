import { updateSettings } from "./settings";

export type SupportedSiteId = "amazon" | "walmart";

export interface SupportedSiteAccess {
  id: SupportedSiteId;
  label: string;
  matches: string[];
  registrationId: string;
  setting: "amazonEnabled" | "walmartEnabled";
}

export const SUPPORTED_SITE_ACCESS: Readonly<Record<SupportedSiteId, SupportedSiteAccess>> = {
  amazon: {
    id: "amazon",
    label: "Amazon",
    matches: ["https://*.amazon.com/*"],
    registrationId: "cup-amazon",
    setting: "amazonEnabled"
  },
  walmart: {
    id: "walmart",
    label: "Walmart",
    matches: ["https://*.walmart.com/*"],
    registrationId: "cup-walmart",
    setting: "walmartEnabled"
  }
};

const SITES = Object.values(SUPPORTED_SITE_ACCESS);

function runtimeError(): Error | undefined {
  const error = chrome.runtime.lastError;
  return error ? new Error(error.message) : undefined;
}

export function hasSiteAccess(site: SupportedSiteAccess): Promise<boolean> {
  return new Promise((resolve, reject) => {
    chrome.permissions.contains({ origins: site.matches }, (granted) => {
      const error = runtimeError();
      if (error) {
        reject(error);
        return;
      }
      resolve(granted);
    });
  });
}

export function requestSiteAccess(site: SupportedSiteAccess): Promise<boolean> {
  return new Promise((resolve, reject) => {
    chrome.permissions.request({ origins: site.matches }, (granted) => {
      const error = runtimeError();
      if (error) {
        reject(error);
        return;
      }
      resolve(granted);
    });
  });
}

export function removeSiteAccess(site: SupportedSiteAccess): Promise<boolean> {
  return new Promise((resolve, reject) => {
    chrome.permissions.remove({ origins: site.matches }, (removed) => {
      const error = runtimeError();
      if (error) {
        reject(error);
        return;
      }
      resolve(removed);
    });
  });
}

function getRegisteredContentScripts(): Promise<chrome.scripting.RegisteredContentScript[]> {
  return new Promise((resolve, reject) => {
    chrome.scripting.getRegisteredContentScripts({}, (scripts) => {
      const error = runtimeError();
      if (error) {
        reject(error);
        return;
      }
      resolve(scripts);
    });
  });
}

function registerSiteScript(site: SupportedSiteAccess): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.scripting.registerContentScripts([{
      id: site.registrationId,
      matches: site.matches,
      js: ["content/index.js"],
      css: ["content/styles.css"],
      runAt: "document_idle",
      persistAcrossSessions: true
    }], () => {
      const error = runtimeError();
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function unregisterSiteScript(site: SupportedSiteAccess): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.scripting.unregisterContentScripts({ ids: [site.registrationId] }, () => {
      const error = runtimeError();
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export async function synchronizeSiteAccess(site: SupportedSiteAccess): Promise<boolean> {
  const [granted, registeredScripts] = await Promise.all([
    hasSiteAccess(site),
    getRegisteredContentScripts()
  ]);
  const registered = registeredScripts.some((script) => script.id === site.registrationId);

  if (granted && !registered) {
    await registerSiteScript(site);
  } else if (!granted && registered) {
    await unregisterSiteScript(site);
  }

  await updateSettings({ [site.setting]: granted });
  return granted;
}

export async function synchronizeAllSiteAccess(): Promise<void> {
  for (const site of SITES) {
    await synchronizeSiteAccess(site);
  }
}

function queryActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const error = runtimeError();
      if (error) {
        reject(error);
        return;
      }
      resolve(tabs[0]);
    });
  });
}

function urlMatchesSite(urlText: string, site: SupportedSiteAccess): boolean {
  try {
    const url = new URL(urlText);
    if (url.protocol !== "https:") {
      return false;
    }
    const expectedDomain = site.id === "amazon" ? "amazon.com" : "walmart.com";
    return url.hostname === expectedDomain || url.hostname.endsWith(`.${expectedDomain}`);
  } catch {
    return false;
  }
}

function contentScriptIsLoaded(tabId: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript({
      target: { tabId },
      func: () => document.documentElement.hasAttribute("data-consistent-unit-price-loaded")
    }, (results) => {
      const error = runtimeError();
      if (error) {
        reject(error);
        return;
      }
      resolve(Boolean(results?.[0]?.result));
    });
  });
}

function insertContentStyles(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.scripting.insertCSS({
      target: { tabId },
      files: ["content/styles.css"]
    }, () => {
      const error = runtimeError();
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function executeContentScript(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript({
      target: { tabId },
      files: ["content/index.js"]
    }, () => {
      const error = runtimeError();
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export async function activateSiteOnCurrentTab(site: SupportedSiteAccess): Promise<boolean> {
  const tab = await queryActiveTab();
  if (tab?.id === undefined || !tab.url || !urlMatchesSite(tab.url, site)) {
    return false;
  }
  if (await contentScriptIsLoaded(tab.id)) {
    return true;
  }
  await insertContentStyles(tab.id);
  await executeContentScript(tab.id);
  return true;
}

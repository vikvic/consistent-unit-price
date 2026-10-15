import { synchronizeAllSiteAccess } from "./site-permissions";

let synchronizationSequence: Promise<void> = Promise.resolve();

function enqueueSynchronization(): Promise<void> {
  const synchronization = synchronizationSequence.then(synchronizeAllSiteAccess);
  synchronizationSequence = synchronization.catch(() => undefined);
  return synchronization;
}

function synchronize(): void {
  void enqueueSynchronization().catch((error: unknown) => {
    console.error("[CUP] Could not synchronize optional site permissions.", error);
  });
}

chrome.runtime.onInstalled.addListener(synchronize);
chrome.runtime.onStartup.addListener(synchronize);
chrome.permissions.onAdded.addListener(synchronize);
chrome.permissions.onRemoved.addListener(synchronize);
chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!message || typeof message !== "object" || (message as { type?: unknown }).type !== "cup/synchronize-site-access") {
    return false;
  }

  void enqueueSynchronization().then(
    () => sendResponse({ ok: true }),
    (error: unknown) => sendResponse({
      ok: false,
      message: error instanceof Error ? error.message : "Unknown synchronization error"
    })
  );
  return true;
});

synchronize();

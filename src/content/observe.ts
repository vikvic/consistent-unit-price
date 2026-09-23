const OWNED_SELECTOR = "[data-cup-root]";
const OVERLAY_ANCHOR_SELECTOR = "[data-cup-overlay-anchor]";

export interface RetailerObserverConfig {
  collectScopes(root: ParentNode): HTMLElement[];
  closestScope(node: Node): HTMLElement | null;
  onScopes(scopes: HTMLElement[]): void;
}

function isOwnedNode(node: Node): boolean {
  const element = node instanceof Element ? node : node.parentElement;
  if (element?.closest(OWNED_SELECTOR)) {
    return true;
  }
  return node instanceof Element && node.matches(OVERLAY_ANCHOR_SELECTOR);
}

function onlyOwnedChanges(mutation: MutationRecord): boolean {
  if (mutation.type !== "childList") {
    return isOwnedNode(mutation.target);
  }

  const changed = [...mutation.addedNodes, ...mutation.removedNodes];
  return changed.length > 0 && changed.every(isOwnedNode);
}

export function observeRetailerScopes(config: RetailerObserverConfig): () => void {
  const pending = new Set<HTMLElement>();
  let frame: number | undefined;

  const flush = (): void => {
    frame = undefined;
    const scopes = Array.from(pending).filter((scope) => scope.isConnected);
    pending.clear();
    if (scopes.length > 0) {
      config.onScopes(scopes);
    }
  };

  const schedule = (scope: HTMLElement | null): void => {
    if (!scope || scope.closest(OWNED_SELECTOR)) {
      return;
    }
    pending.add(scope);
    frame ??= window.requestAnimationFrame(flush);
  };

  config.collectScopes(document).forEach(schedule);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (onlyOwnedChanges(mutation)) {
        continue;
      }

      schedule(config.closestScope(mutation.target));
      if (mutation.type !== "childList") {
        continue;
      }

      for (const node of mutation.addedNodes) {
        if (isOwnedNode(node)) {
          continue;
        }
        if (node instanceof Element) {
          config.collectScopes(node).forEach(schedule);
        }
        schedule(config.closestScope(node));
      }
    }
  });

  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [
      "aria-checked",
      "aria-disabled",
      "aria-expanded",
      "aria-hidden",
      "aria-label",
      "aria-pressed",
      "aria-selected",
      "checked",
      "class",
      "data-asin",
      "data-automation-id",
      "data-csa-c-content-id",
      "data-item-id",
      "data-state",
      "data-testid",
      "disabled",
      "for",
      "hidden",
      "id",
      "itemtype",
      "role",
      "selected",
      "style",
      "title",
      "type",
      "value"
    ],
    characterData: true,
    childList: true,
    subtree: true
  });

  const handleSelectionChange = (event: Event): void => {
    if (event.target instanceof Node && !isOwnedNode(event.target)) {
      schedule(config.closestScope(event.target));
    }
  };
  document.addEventListener("change", handleSelectionChange, true);
  document.addEventListener("input", handleSelectionChange, true);

  return () => {
    observer.disconnect();
    document.removeEventListener("change", handleSelectionChange, true);
    document.removeEventListener("input", handleSelectionChange, true);
    pending.clear();
    if (frame !== undefined) {
      window.cancelAnimationFrame(frame);
    }
  };
}

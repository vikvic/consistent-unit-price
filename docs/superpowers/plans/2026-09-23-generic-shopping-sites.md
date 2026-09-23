# Generic Shopping-Site Unit Prices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert explicit currency-per-weight labels on user-approved ecommerce sites while preserving the page's local currency and retaining the existing Amazon and Walmart integrations.

**Architecture:** Keep Amazon and Walmart as first-priority adapters and add a generic fallback pipeline made of localized unit-price parsing, visible-DOM candidate discovery, shared conversion/formatting, and exact-element rendering. A background coordinator owns optional host permissions and one dynamically registered generic content script; the popup exposes per-site access, optional all-sites access, currency-neutral formats, and debug logging.

**Tech Stack:** TypeScript, WebExtensions Manifest V3, Chrome extension APIs shared with Firefox, esbuild, HTML, and CSS.

**Spec:** `docs/superpowers/specs/2026-09-23-generic-shopping-sites-design.md`

## Global Constraints

- Preserve each page's currency; perform no foreign-exchange conversion and no network lookup.
- Convert only explicit, visible `currency + amount + per + mass unit` expressions.
- Supported mass denominators are ounce, pound, gram, 100 grams, and kilogram; fluid volume remains excluded.
- Reject ambiguous numbers, unknown major/minor denomination relationships, mixed currencies, ranges, malformed separators, and unsupported units.
- Amazon and Walmart adapters take precedence over generic scanning.
- Generic access is per-origin by default; all-sites access is an explicit advanced option.
- Overlay only the exact source element and restore it when disabled, invalidated, or revoked.
- Settings and enabled origins remain local; no page data is transmitted.
- Debug logs are disabled by default and emit no `[CUP]` messages while disabled.
- Do not add an automated test suite unless the user requests one; use typecheck, browser builds, and the exact manual cases below.

## Review Focus

- Ambiguous `1.234` and `1,234` values must be skipped unless document locale and surrounding syntax resolve them; Task 2 includes this manual parser probe.
- A text node changed by a virtualized product grid must restore the old overlay before rendering the new value; Task 4 includes this mutation check.
- Enabling all-sites access must not cause duplicate execution on Amazon or Walmart; Task 5 includes an idempotency and precedence check.
- Unknown minor units such as bare `ct` without a resolvable major currency must remain untouched when a major-denomination format is selected; Task 2 includes this rejection check.
- Revoking an origin must remove its dynamic registration and prevent reinjection after reload; Task 5 includes this Firefox and Chrome permission check.

---

### Task 1: Currency-neutral core types, conversion, and settings migration

**Files:**
- Modify: `src/core/types.ts:1-155`
- Modify: `src/core/convert.ts:1-73`
- Modify: `src/core/format.ts:1-40`
- Modify: `src/settings.ts:1-112`
- Modify: `src/retailers/amazon.ts`
- Modify: `src/retailers/walmart.ts`
- Modify: `src/popup/popup.ts`

**Interfaces:**
- Produces: `MonetaryUnit`, `CurrencyPresentation`, `UnitPriceValue`, `convertUnitPrice(input)`, and the migrated `ExtensionSettings` fields consumed by every later task.
- Preserves: the five existing `DisplayFormat` storage values so existing installations migrate without losing their preferred format.

- [ ] **Step 1: Generalize the shared model without changing stored format identifiers**

In `src/core/types.ts`, keep `DISPLAY_FORMATS` but change their user-facing labels from US-only wording to local-currency wording. Add the following contracts:

```ts
export type MonetaryUnit = "major" | "minor";
export type CurrencyTokenPosition = "before" | "after";

export interface CurrencyPresentation {
  majorToken?: string;
  minorToken?: string;
  sourceToken: string;
  sourceMonetaryUnit: MonetaryUnit;
  tokenPosition: CurrencyTokenPosition;
  spaceBetween: boolean;
  decimalSeparator: "." | ",";
  minorPerMajor?: number;
  isoCode?: string;
}

export interface UnitPriceValue {
  amount: number;
  monetaryUnit: MonetaryUnit;
  denominatorGrams: number;
}

export interface UnitPriceConversionInput {
  source: UnitPriceValue;
  format: DisplayFormat;
  currency: CurrencyPresentation;
}

export interface UnitPriceConversionSuccess {
  available: true;
  format: DisplayFormat;
  value: number;
  label: string;
}

export interface UnitPriceConversionFailure {
  available: false;
  format: DisplayFormat;
  reason: "unknown-denomination-relationship" | "invalid-price";
  label: string;
}

export type UnitPriceConversionResult =
  | UnitPriceConversionSuccess
  | UnitPriceConversionFailure;
```

Use these labels:

```ts
export const DISPLAY_FORMAT_LABELS: Readonly<Record<DisplayFormat, string>> = {
  "cents-per-ounce": "Local minor currency per ounce",
  "dollars-per-ounce": "Local major currency per ounce",
  "dollars-per-pound": "Local major currency per pound",
  "dollars-per-100-grams": "Local major currency per 100 grams",
  "dollars-per-kilogram": "Local major currency per kilogram"
};
```

Rename `priceDollars` to `priceMajorUnits` in `CalculationInput`, `OfferEvidence`, `RetailerExtraction`, both retailer adapters, `src/content/index.ts`, and `src/popup/popup.ts`. Keep retailer arithmetic numerically identical.

- [ ] **Step 2: Add denomination-and-weight conversion**

Export this signature from `src/core/convert.ts`:

```ts
export function convertUnitPrice(
  input: UnitPriceConversionInput
): UnitPriceConversionResult;
```

Map target formats with a single table:

```ts
const FORMAT_TARGETS: Readonly<Record<DisplayFormat, {
  monetaryUnit: MonetaryUnit;
  denominatorGrams: number;
  suffix: string;
}>> = {
  "cents-per-ounce": { monetaryUnit: "minor", denominatorGrams: 28.349523125, suffix: "/oz" },
  "dollars-per-ounce": { monetaryUnit: "major", denominatorGrams: 28.349523125, suffix: "/oz" },
  "dollars-per-pound": { monetaryUnit: "major", denominatorGrams: 453.59237, suffix: "/lb" },
  "dollars-per-100-grams": { monetaryUnit: "major", denominatorGrams: 100, suffix: "/100 g" },
  "dollars-per-kilogram": { monetaryUnit: "major", denominatorGrams: 1000, suffix: "/kg" }
};
```

Convert source amount to major currency only when necessary, using `minorPerMajor`; convert the denominator through price-per-gram; then convert to the target monetary unit. Return `unknown-denomination-relationship` instead of assuming 100 when `minorPerMajor` is absent.

Refactor `calculateUnitPrice()` to call `convertUnitPrice()` with the USD presentation `{ majorToken: "$", minorToken: "cents", sourceToken: "$", sourceMonetaryUnit: "major", tokenPosition: "before", spaceBetween: false, decimalSeparator: ".", minorPerMajor: 100, isoCode: "USD" }`.

- [ ] **Step 3: Make formatting consume the detected currency presentation**

Add this exported formatter to `src/core/format.ts`:

```ts
export function formatLocalizedUnitPrice(
  value: number,
  format: DisplayFormat,
  currency: CurrencyPresentation
): string;
```

Choose `majorToken` or `minorToken` for the target monetary unit, preserve token position and spacing, use two fractional digits, replace only the decimal point with `currency.decimalSeparator`, and retain the existing positive-value `< 0.01` threshold. Continue using `$` and `cents` for the manual USD calculator.

- [ ] **Step 4: Add settings fields and deterministic migration**

Extend `ExtensionSettings` with:

```ts
debugLoggingEnabled: boolean;
genericOrigins: string[];
allSitesEnabled: boolean;
```

Set defaults to `false`, `[]`, and `false`. In `normalizeSettings()`, accept only normalized HTTP/HTTPS origins, deduplicate them, and preserve the old display-format values. Export:

```ts
export function normalizeOrigin(value: string): string | undefined;
```

It must return only `new URL(value).origin` for `http:` and `https:` URLs.

- [ ] **Step 5: Verify core migration and build**

Run:

```powershell
npm run typecheck
npm run build:chrome
npm run build:firefox
```

Expected: all commands exit 0; existing Amazon/Walmart/manual calculations retain their numeric results; loading existing storage without the three new fields yields the new defaults.

- [ ] **Step 6: Commit Task 1**

```powershell
git add src/core/types.ts src/core/convert.ts src/core/format.ts src/settings.ts src/retailers/amazon.ts src/retailers/walmart.ts src/content/index.ts src/popup/popup.ts
git commit -m "refactor: support local currency unit prices"
```

### Task 2: Localized generic unit-price parser

**Files:**
- Create: `src/generic/currency.ts`
- Create: `src/generic/parse.ts`
- Create: `scripts/generic-parser-probe.ts`

**Interfaces:**
- Consumes: `CurrencyPresentation`, `UnitPriceValue`, and `WeightUnit` from Task 1.
- Produces: `parseGenericUnitPrice(text, context)` and `collectCurrencyContext(texts, language)` for Task 3.

- [ ] **Step 1: Implement conservative currency context resolution**

Create these interfaces in `src/generic/currency.ts`:

```ts
export interface CurrencyContext {
  documentLanguage: string;
  majorTokens: ReadonlySet<string>;
  inferredMajorForMinor: ReadonlyMap<string, string>;
}

export function collectCurrencyContext(
  texts: readonly string[],
  documentLanguage: string
): CurrencyContext;
```

Recognize ISO codes with `\b[A-Z]{3}\b`, major symbols `$ € £ ¥ ₹ ₩ ₽ ₺ ₴`, and explicit multi-character tokens `R$ C$ A$ NZ$ CHF zł kr`. Infer only the fixed pairs `$ ↔ ¢`, `€ ↔ ct`, and `£ ↔ p` when the corresponding major token appears in the collected page text or an ISO code establishes that currency. Set `minorPerMajor` from ISO 4217 fraction digits via `Intl.NumberFormat(...).resolvedOptions().maximumFractionDigits`, using `10 ** digits`; do not infer an ISO currency from a bare ambiguous symbol.

- [ ] **Step 2: Parse localized numbers without guessing**

In `src/generic/parse.ts`, export:

```ts
export interface GenericUnitPriceMatch {
  rawText: string;
  currency: CurrencyPresentation;
  source: UnitPriceValue;
  sourceFormat?: DisplayFormat;
}

export type GenericParseResult =
  | { matched: true; value: GenericUnitPriceMatch }
  | { matched: false; reason:
      | "not-unit-price"
      | "volume-is-not-weight"
      | "ambiguous-number"
      | "unknown-currency"
      | "unsupported-unit"
      | "range" };

export function parseGenericUnitPrice(
  text: string,
  context: CurrencyContext
): GenericParseResult;
```

Normalize ordinary and non-breaking spaces, but retain the exact raw source. Reject en-dash/hyphen numeric ranges before parsing. Accept `/`, `per`, `por`, `par`, `pro`, and `за` as first-release separators. Recognize `oz`, `ounce(s)`, `lb`, `lbs`, `pound(s)`, `g`, `gram(s)`, `100 g`, `kg`, and `kilogram(s)`. Reject `fl oz`, `fluid ounce(s)`, `ml`, `millilitre(s)`, `milliliter(s)`, `l`, `litre(s)`, and `liter(s)`.

Use `documentLanguage` to choose the expected decimal separator. If both `.` and `,` appear, treat the rightmost as decimal only when the other separators form groups of three. If a single separator has exactly three following digits and locale does not resolve its role, return `ambiguous-number`.

- [ ] **Step 3: Derive the source format only for exact supported combinations**

Return `sourceFormat` for minor/ounce, major/ounce, major/pound, major/100-grams, and major/kilogram. Leave it undefined for valid combinations such as minor/pound; they can still be converted but do not participate as an exact existing `DisplayFormat` value.

- [ ] **Step 4: Run manual parser probes in the browser console**

Create `scripts/generic-parser-probe.ts` as a manual console probe. It imports `collectCurrencyContext` and `parseGenericUnitPrice`, evaluates the following named cases, and prints each parse result as JSON. Run it with `npx esbuild scripts/generic-parser-probe.ts --bundle --platform=node --format=esm --outfile="$env:TEMP\cup-generic-parser-probe.mjs"` followed by `node "$env:TEMP\cup-generic-parser-probe.mjs"`. Confirm:

```text
$3.98/lb                 -> match, 3.98 major per 453.59237 g
90.7 ¢/lb                -> match, 90.7 minor per 453.59237 g
EUR 1,29/100 g           -> match, 1.29 major per 100 g
£0.85 per kg             -> match, 0.85 major per 1000 g
$2.32/oz                 -> match, 2.32 major per 28.349523125 g
12 oz bag                -> not-unit-price
$3.99/fl oz              -> volume-is-not-weight
$2.00-$4.00/lb           -> range
1.234 €/kg with no lang  -> ambiguous-number
1.234 €/kg with lang=en  -> match, 1.234 major per kg
1.234 €/kg with lang=de  -> match, 1234 major per kg
90 ct/lb without EUR     -> match as minor, but major conversion unavailable
```

- [ ] **Step 5: Verify and commit Task 2**

```powershell
npm run typecheck
npm run build
git add src/generic/currency.ts src/generic/parse.ts scripts/generic-parser-probe.ts
git commit -m "feat: parse localized unit price labels"
```

### Task 3: Debug logging gate

**Files:**
- Create: `src/diagnostics.ts`
- Modify: `src/content/index.ts:72-161,389-458`
- Modify: `src/settings.ts`

**Interfaces:**
- Consumes: `ExtensionSettings.debugLoggingEnabled` from Task 1.
- Produces: `setDebugLoggingEnabled()`, `cupInfo()`, and `cupWarn()` for retailer and generic pipelines.

- [ ] **Step 1: Create one logging boundary**

Implement `src/diagnostics.ts`:

```ts
let enabled = false;

export function setDebugLoggingEnabled(value: boolean): void {
  enabled = value;
}

export function cupInfo(scope: string, event: string, details?: unknown): void {
  if (enabled) console.info(`[CUP][${scope}] ${event}`, details);
}

export function cupWarn(scope: string, event: string, details?: unknown): void {
  if (enabled) console.warn(`[CUP][${scope}] ${event}`, details);
}
```

- [ ] **Step 2: Route every existing Walmart log through the boundary**

Replace direct `console.info` and `console.warn` calls in `src/content/index.ts`, including bundle-loaded, settings, inventory, automatic-format, conversions, and failures. Call `setDebugLoggingEnabled(settings.debugLoggingEnabled)` before any settings diagnostic.

- [ ] **Step 3: Verify the gate**

Build and load Firefox. With debugging off, filter the console for `CUP` and reload a Walmart search page: expect no matching messages. Enable debugging in storage temporarily, reload, and expect bundle/settings/scan messages. Restore debugging to off.

- [ ] **Step 4: Commit Task 3**

```powershell
git add src/diagnostics.ts src/content/index.ts src/settings.ts
git commit -m "feat: gate extension diagnostics"
```

### Task 4: Generic DOM discovery, rendering, and mutation lifecycle

**Files:**
- Create: `src/generic/dom.ts`
- Create: `src/generic/adapter.ts`
- Modify: `src/content/index.ts:38-458`
- Modify: `src/content/observe.ts:1-125`
- Modify: `src/content/render.ts:6-146`
- Modify: `src/content/styles.css`

**Interfaces:**
- Consumes: Task 2 parsing, Task 1 conversion, Task 3 diagnostics, and existing renderer/observer primitives.
- Produces: `GENERIC_ADAPTER`, exact-element candidates, automatic-format counts, and reversible generic overlays.

- [ ] **Step 1: Discover only eligible visible text elements**

Create `src/generic/dom.ts` with:

```ts
export interface GenericCandidate {
  element: HTMLElement;
  sourceText: string;
  parsed: GenericUnitPriceMatch;
}

export function collectGenericCandidates(root: ParentNode): GenericCandidate[];
export function closestGenericScope(node: Node): HTMLElement | null;
```

Use a `TreeWalker` with `NodeFilter.SHOW_TEXT`. Reject nodes whose parent is inside `script, style, template, input, textarea, select, option, [contenteditable], [hidden], [aria-hidden="true"], [data-cup-root]`. Require `getClientRects().length > 0` and computed `display !== "none"` and `visibility !== "hidden"`. Select the smallest parent whose normalized `textContent` equals the candidate text so an overlay cannot cover a whole product card.

Build currency context once per scan batch from candidate-like visible strings, then call `parseGenericUnitPrice`. Deduplicate by source element identity.

- [ ] **Step 2: Add a generic adapter contract**

Create `src/generic/adapter.ts`:

```ts
export interface GenericExtraction {
  scope: HTMLElement;
  host: HTMLElement;
  sourceText: string;
  parsed: GenericUnitPriceMatch;
}

export const GENERIC_ADAPTER = {
  collectScopes(root: ParentNode): HTMLElement[],
  closestScope(node: Node): HTMLElement | null,
  extract(scope: HTMLElement): GenericExtraction | undefined,
  collectDisplayedFormats(root: ParentNode): DisplayFormat[]
};
```

Cache only within a scan batch; never retain parsed data after the source element's normalized text changes.

- [ ] **Step 3: Make overlay restoration source-safe**

Extend `UnitPriceOverlay` with `sourceText`. Change `overlayUnitPriceText()` to accept the exact source element as an optional fourth argument. Before overlaying, remove any previous extension overlay from that element. On removal, restore only extension-owned positioning and nodes; do not overwrite the retailer's text content.

Add `data-cup-generic-source` to generic overlay anchors. The generic overlay keeps the existing bold blue style and does not append `| CUP`.

- [ ] **Step 4: Integrate generic processing without weakening retailer precedence**

In `src/content/index.ts`, keep `adapterForPage()` returning Amazon or Walmart first. Return `GENERIC_ADAPTER` only when neither retailer matches. Add a separate `processGenericScope()` that:

```ts
const result = convertUnitPrice({
  source: extraction.parsed.source,
  format: currentFormat,
  currency: extraction.parsed.currency
});
```

If conversion is unavailable, leave the page unchanged and emit a gated rejection log. If the source already matches the selected format, leave it unchanged. Otherwise overlay the exact source element or render a separate label when the user selected label mode.

Automatic mode counts `sourceFormat` values from currently loaded generic candidates. Resolve ties to the last explicit format, then `dollars-per-pound`.

- [ ] **Step 5: Generalize the observer name and preserve scoped batching**

Rename `RetailerObserverConfig` to `ScopeObserverConfig` and `observeRetailerScopes()` to `observeScopes()`. Retain requestAnimationFrame batching and extension-owned mutation filtering. For generic mode, scan only the changed or added subtree; do not rescan `document` after every mutation.

- [ ] **Step 6: Verify generic lifecycle manually**

Use a local static HTML page containing the Task 2 examples. Confirm initial conversion, dynamically append a new unit price, change an existing text node, remove its containing node, toggle overlay/label modes, and disable the extension. Expected: one result per source, stale overlays disappear, removed nodes leave no retained UI, and no mutation loop occurs.

- [ ] **Step 7: Verify and commit Task 4**

```powershell
npm run typecheck
npm run build
git add src/generic/dom.ts src/generic/adapter.ts src/content/index.ts src/content/observe.ts src/content/render.ts src/content/styles.css
git commit -m "feat: convert generic page unit prices"
```

### Task 5: Optional origin permissions and dynamic content scripts

**Files:**
- Create: `src/background.ts`
- Create: `src/permissions.ts`
- Modify: `scripts/build.mjs:13-37`
- Modify: `manifests/chrome.json`
- Modify: `manifests/firefox.json`
- Modify: `src/content/index.ts`

**Interfaces:**
- Consumes: `genericOrigins` and `allSitesEnabled` settings.
- Produces: popup-callable permission functions and a background registration coordinator.

- [ ] **Step 1: Define origin permission helpers**

Implement `src/permissions.ts`:

```ts
export function originPattern(origin: string): string {
  return `${origin}/*`;
}

export async function currentTab(): Promise<chrome.tabs.Tab | undefined>;
export async function hasOriginAccess(origin: string): Promise<boolean>;
export async function requestOriginAccess(origin: string): Promise<boolean>;
export async function removeOriginAccess(origin: string): Promise<boolean>;
export async function requestAllSitesAccess(): Promise<boolean>;
export async function removeAllSitesAccess(): Promise<boolean>;
```

Use `chrome.permissions.contains`, `request`, and `remove`. Requests occur only from popup click handlers. Accept only normalized HTTP/HTTPS origins.

- [ ] **Step 2: Build one dynamic registration from current settings**

Implement `src/background.ts` with registration ID `cup-generic-sites`. Export and invoke:

```ts
export async function syncGenericRegistration(): Promise<void>;
```

Unregister the old ID, calculate matches from `allSitesEnabled ? ["http://*/*", "https://*/*"] : genericOrigins.map(originPattern)`, and register `content/index.js` plus `content/styles.css` at `document_idle`. Exclude `https://*.amazon.com/*` and `https://*.walmart.com/*`; their static registration remains authoritative.

Run synchronization on `runtime.onInstalled`, `runtime.onStartup`, and changes to the settings storage key. Add a message handler for `{ type: "cup/sync-site-permissions", tabId?: number }`; after syncing, inject CSS and the content bundle into the active granted tab so users do not have to reload. Add an idempotency guard at the top of `src/content/index.ts` using a document-element data attribute before subscribing or observing.

- [ ] **Step 3: Update both manifests and the build**

Add `background/background` to esbuild entry points and create the output directory. In both manifests add:

```json
"permissions": ["storage", "scripting", "activeTab"],
"optional_host_permissions": ["http://*/*", "https://*/*"]
```

Chrome uses:

```json
"background": { "service_worker": "background/background.js" }
```

Firefox uses:

```json
"background": { "scripts": ["background/background.js"] }
```

Retain the existing Amazon/Walmart static content-script matches and Firefox minimum version.

- [ ] **Step 4: Verify permission behavior in Chrome and Firefox**

Confirm per-site grant, immediate activation, persistence after browser restart, disable/revoke, and no reinjection after reload. Confirm the all-sites grant works on a second origin and does not double-run on Amazon or Walmart. Confirm browser-internal pages show an unsupported-page state without prompting.

- [ ] **Step 5: Verify and commit Task 5**

```powershell
npm run typecheck
npm run build
git add src/background.ts src/permissions.ts scripts/build.mjs manifests/chrome.json manifests/firefox.json src/content/index.ts
git commit -m "feat: add optional site permissions"
```

### Task 6: Popup controls for generic sites, formats, and debugging

**Files:**
- Modify: `src/popup/index.html`
- Modify: `src/popup/popup.ts`
- Modify: `src/popup/popup.css`
- Modify: `src/settings.ts`

**Interfaces:**
- Consumes: Task 5 permission helpers and Task 1 settings.
- Produces: the complete user-facing enable/disable and debug workflow.

- [ ] **Step 1: Add current-site and privacy controls**

Add a `Current site` fieldset after the Amazon/Walmart toggles containing the active origin, a status line, an **Enable on this site** button, and a **Disable on this site** button. Add an `Advanced access` disclosure containing **Enable on all websites**. Add the checkbox:

```html
<label class="cup-toggle" for="debug-logging-enabled">
  <input id="debug-logging-enabled" type="checkbox">
  <span>Show debug console logs</span>
</label>
```

Its explanatory text states that logs stay in the browser console and are disabled by default.

- [ ] **Step 2: Wire permission actions to a direct user gesture**

On popup load, query the active tab, normalize its origin, check permission state, and render one of: enabled, disabled, unsupported page, or unavailable tab. Button click handlers request/remove permissions, update `genericOrigins` or `allSitesEnabled`, send `cup/sync-site-permissions`, and update status only after every operation succeeds.

If the user denies a request, keep the site disabled and show `Access was not granted.` Do not automatically prompt again.

- [ ] **Step 3: Apply currency-neutral format copy**

Render the Task 1 labels in the existing radio-card grid. Keep automatic first and full-width. Change the display-style legend from `Walmart display style` to `Converted-price display`. Change the manual calculator label to `Price in local major currency` while retaining its numeric behavior.

- [ ] **Step 4: Persist and broadcast debug state**

Bind the checkbox to `debugLoggingEnabled`. After saving, existing settings subscription updates the active content script; verify logs stop immediately without a page reload.

- [ ] **Step 5: Verify popup usability in both browsers**

Confirm no controls disappear when selected, keyboard focus reaches every radio/button/checkbox, permission statuses fit within the 360-pixel popup, long origins wrap, and denied/unsupported states remain readable. Confirm existing Amazon and Walmart toggles still work.

- [ ] **Step 6: Verify and commit Task 6**

```powershell
npm run typecheck
npm run build
git add src/popup/index.html src/popup/popup.ts src/popup/popup.css src/settings.ts
git commit -m "feat: add generic site popup controls"
```

### Task 7: Manual cross-browser validation and documentation

**Files:**
- Modify: `docs/SUPPORT.md`
- Modify: `docs/MANUAL-QA.md`
- Create: `docs/PRIVACY.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: the complete built extension.
- Produces: documented support boundaries, permission behavior, privacy behavior, and reproducible browser evidence.

- [ ] **Step 1: Document supported generic syntax and safe skips**

In `docs/SUPPORT.md`, list every first-release currency token, localized `per` word, weight unit, numeric-separator rule, fluid-unit rejection, range rejection, top-level-frame limit, and adapter precedence rule. State explicitly that unknown text is left unchanged.

- [ ] **Step 2: Document permissions and local-only data behavior**

In `docs/PRIVACY.md`, explain Amazon/Walmart access, per-origin optional access, optional all-sites access, local settings/origin storage, browser-console diagnostics, and that there is no server, analytics, browsing-history upload, or foreign-exchange lookup.

- [ ] **Step 3: Record exact manual QA cases**

Add a table to `docs/MANUAL-QA.md` with browser, URL/or local fixture, source text, selected format, expected text, observed text, display style, permission state, and pass/fail. Include every Review Focus line plus the Task 2 parser examples, dynamic insertion/change/removal, access revocation, debug off/on, automatic-format ties, Amazon search, Walmart search, and one product page from each retailer.

- [ ] **Step 4: Run final verification**

```powershell
npm run typecheck
npm run build
git diff --check
```

Load `dist/firefox` through `about:debugging#/runtime/this-firefox` and `dist/chrome` through `chrome://extensions` developer mode. Complete the manual QA table and capture screenshots for a generic euro example, a generic dollar example, Walmart, Amazon, and the popup's permission controls.

- [ ] **Step 5: Commit Task 7**

```powershell
git add README.md docs/SUPPORT.md docs/MANUAL-QA.md docs/PRIVACY.md
git commit -m "docs: document generic site support"
```

- [ ] **Step 6: Review the complete branch**

Inspect `git diff 6e65291...HEAD`, confirm only planned files changed, rerun `npm run build`, and compare every completed manual-QA row with the specification. Do not claim universal ecommerce support; report the recognized syntax and safe-skip boundaries.

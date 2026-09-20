# Consistent Unit Price Implementation Plan

Date: 2026-09-20
Status: approved product direction; implementation not started.

## Goal

Build a Chrome and Firefox extension that automatically adds a consistent unit-price label beside supported Amazon and Walmart product prices. Users choose a unit once and see that same unit everywhere supported.

## Architecture

Use a shared TypeScript conversion engine, settings interface, and page-label renderer, with independent Amazon and Walmart readers. Readers associate the selected offer price with its package quantity and return evidence, not just a number. Browser-specific manifests package the shared implementation for Chrome and Firefox.

Technology: TypeScript, WebExtensions, HTML/CSS, and a small build pipeline selected during scaffolding. Content scripts perform page reading and rendering; local extension storage holds preferences. No server or AI service is required.

This document contains both the product specification and the implementation sequence. Execute milestones in order. Do not implement automated tests unless requested; use the documented manual verification process.

## Product rules

- Initial platforms: desktop Chrome and Firefox.
- Initial stores: Amazon.com and Walmart.com, US-dollar listings only.
- Initial measurements: weight only. Exclude volume and item-count pricing.
- Available formats: cents per ounce, dollars per ounce, dollars per pound, dollars per 100 grams, dollars per kilogram.
- Default format: dollars per pound. Let users change it at any time.
- Persist one global format across both stores. Never silently change denominations or units based on price.
- Add a visibly extension-owned label beside the original price; preserve the original price and store unit-price text.
- Default price basis: selected variant's displayed one-time purchase price, excluding tax and shipping.
- Exclude subscriptions, clipped coupons, membership offers, and conditional quantity discounts. If the ordinary purchase price cannot be identified, show an unavailable reason.
- Include an unconditional sale price when it is the active one-time purchase price.
- Use the selected package's net product weight, never shipping weight.
- Multiply count by individual package weight only when both are explicit. Never multiply a stated total weight again.
- Reject mixed-product bundles with no unambiguous comparable net weight.
- Never treat fluid ounces as weight ounces or infer density.
- Weight conversion constants: 16 oz = 1 lb; 1 oz = 28.349523125 g; 1 lb = 453.59237 g.
- Preserve precision internally. Display two decimal places in the chosen denomination, with a less-than threshold instead of zero for positive results below 0.01 of that denomination.
- A zero price is valid only when explicitly associated with the selected ordinary offer; missing or malformed prices are unavailable.
- Reject zero, negative, missing, or conflicting quantities.
- If a reliable store unit price is the only available basis, normalize it and label it as store-provided, not independently recalculated.
- If price/package evidence conflicts, do not silently select one value. Explain why calculation is unavailable.
- Invalidate old labels immediately when the selected offer or package changes. Render a new result only after matching evidence is available.
- Store preferences locally. No browsing-history collection, analytics, accounts, affiliate rewriting, or external page-data transmission in the initial release.
- Request access only to supported retailer domains and explain its purpose.

## User experience

1. Install the extension and grant access to the supported store sites.
2. Choose a preferred format in the popup; the default is $/lb.
3. Browse supported product pages, search results, and category pages.
4. Read the consistent price label beside each eligible price.
5. Activate the label by mouse or keyboard to inspect the calculation and its source.
6. For an ambiguous listing, see "Cannot reliably calculate" with a concrete reason where a product price area is confidently identified.
7. Optionally enter price and weight manually in the popup. Clearly mark this as user-entered, separate from automatic page results, and do not persist a product override.

Example detail: "$12.00 divided by 2 lb total; 4 packages x 8 oz = $6.00/lb. Excludes tax and shipping."

Popup controls: preferred format, enable/disable each supported site, and manual calculator. Detail panels must be keyboard accessible and must not depend on color alone.

## Proposed source layout

- package.json: build commands and development dependencies.
- tsconfig.json: TypeScript configuration.
- manifests/chrome.json: Chrome extension configuration.
- manifests/firefox.json: Firefox extension configuration.
- src/core/types.ts: shared product evidence and result contracts.
- src/core/quantity.ts: explicit weight parsing and multipack normalization.
- src/core/convert.ts: conversion arithmetic and selected-unit output.
- src/core/format.ts: display precision and labels.
- src/retailers/amazon.ts: Amazon product/card extraction.
- src/retailers/walmart.ts: Walmart product/card extraction.
- src/content/index.ts: page lifecycle and retailer-reader coordination.
- src/content/observe.ts: scoped, batched handling of page changes.
- src/content/render.ts: idempotent labels and calculation details.
- src/content/styles.css: namespaced, accessible page styles.
- src/settings.ts: stored preference defaults and updates.
- src/popup/: settings and manual-calculator interface.
- docs/SUPPORT.md: supported page patterns and known limitations.
- docs/MANUAL-QA.md: manual cases and recorded results.
- docs/PRIVACY.md: actual permissions and data behavior.

Keep retailer selectors out of shared arithmetic. Keep arithmetic out of the renderer. Add background code only if a concrete browser capability requires it.

## Shared data contract

Each reader returns either an eligible offer or a specific unavailable reason.

An eligible offer records: product/card identity, selected variant identity where available, currency, price basis, price amount, total weight and original unit when available, package count evidence, source text, source element references, and whether the value is independently calculated or normalized from the store's unit price.

Unavailable reasons include unsupported currency, volume instead of weight, missing quantity, ambiguous multipack, conflicting quantity, ambiguous price basis, and changing variant.

The conversion engine consumes validated offer data plus the requested display format. It returns the numeric result, formatted label, calculation details, and provenance. It does not read the page.

## Milestone 1: Inspect real listings and define support

Estimated effort: 2-3 developer days.

- [ ] Inspect both stores in both browsers, including product pages, search cards, and category cards.
- [ ] Record representative single packs, multipacks, metric quantities, variants, sale prices, subscriptions, coupons, missing weights, and fluid-ounce products.
- [ ] Identify where visible prices and quantities refer to the same selected offer; use structured page data only when its association is verified.
- [ ] Document the extraction precedence and failure rules separately for each store in docs/SUPPORT.md.
- [ ] Record examples and expected results in docs/MANUAL-QA.md without saving account details or other private page content.

Completion condition: concrete extraction rules and explicit unsupported cases exist for each initial page type. Reassess the schedule if search-card quantities are frequently unavailable.

## Milestone 2: Build the shared extension and calculator

Estimated effort: 3-5 developer days.

- [ ] Scaffold the shared TypeScript project and separate browser manifests.
- [ ] Implement the data contract, quantity normalization, arithmetic, and display formatting.
- [ ] Implement local settings and a popup containing unit selection, site toggles, and manual entry.
- [ ] Implement accessible labels and calculation panels using static example inputs before retailer integration.
- [ ] Build and load the extension locally in Chrome and Firefox.
- [ ] Manually verify the arithmetic examples and persistence of settings across browser restarts.

Required examples:

| Input | Selected format | Expected label |
| --- | --- | --- |
| $6.00 for 12 oz | $/lb | $8.00/lb |
| $9.00 for 1.5 lb | $/lb | $6.00/lb |
| $12.00 for 4 x 8 oz | $/lb | $6.00/lb |
| $6.00 for 12 oz | cents/oz | 50.00 cents/oz |
| $10.00 for 500 g | $/kg | $20.00/kg |
| $10.00 for 500 g | $/100 g | $2.00/100 g |
| $1.00 for 200 oz | $/oz | < $0.01/oz |
| $5.00 for 12 fl oz | $/lb | Unavailable: volume is not weight |
| Missing or zero quantity | any | Unavailable: invalid quantity |

Completion condition: both browser builds load, settings persist, and all listed manual examples produce the expected values or reasons.

## Milestone 3: Integrate both retailers

Estimated effort: 6-10 developer days.

- [ ] Implement Amazon extraction using the rules established in milestone 1.
- [ ] Integrate Amazon product pages, search cards, and category cards.
- [ ] Implement Walmart extraction and the same supported page types independently.
- [ ] Recalculate on size, pack-count, price, and selected-offer changes.
- [ ] Handle dynamically inserted results with scoped observation and batched updates; avoid repeatedly scanning the full page.
- [ ] Remove stale labels and prevent duplicate labels and self-triggered observation loops.
- [ ] Keep each card's evidence isolated so values cannot leak between adjacent products.
- [ ] Show source details and useful unavailable reasons. Keep manually entered calculations separate.
- [ ] Verify that store interactions, layout, and keyboard navigation remain usable.

Completion condition: supported pages show accurate matching results and variant changes cannot leave an old price attached to a new selection.

## Milestone 4: Validate and prepare distribution

Estimated effort: 4-7 developer days, excluding store review.

- [ ] Review at least 100 distinct listing/page cases, balanced across stores and page types, in both browsers.
- [ ] Include every scenario recorded in milestone 1 and every arithmetic example in milestone 2.
- [ ] Record browser, store, page type, expected value, observed value, evidence source, and outcome.
- [ ] Report accuracy separately from coverage. A safely skipped listing is not a successful calculation.
- [ ] Report coverage by store and page type, plus unavailable reasons. Do not claim universal coverage.
- [ ] Require no known incorrect automatic calculations or stale-variant results in the reviewed sample; unresolved cases must be made explicitly unavailable before release.
- [ ] Inspect performance during scrolling and dynamic updates, keyboard accessibility, site toggles, and clean disable/uninstall behavior.
- [ ] Document supported patterns, limitations, privacy behavior, and permission purpose.
- [ ] Check current Chrome Web Store and Firefox Add-ons packaging and submission requirements before producing release bundles.
- [ ] Prepare store descriptions, screenshots, icons, and separately packaged browser builds.
- [ ] Submit only when publication is authorized; creating this plan does not authorize publishing.

Completion condition: both release bundles work in manual review, documented sample results meet the release criteria, and distribution materials accurately describe support.

## Maintenance

Retailer layout changes are the main ongoing risk. Keep extraction logic isolated so each store can be repaired independently. When extraction becomes ambiguous, suppress the affected calculation instead of retaining stale data. Recheck the manual cases after each retailer-reader change.

## Deferred scope

Volume and count units; international storefronts and currency conversion; coupons and subscription comparisons; historical prices; price alerts; cheapest-product rankings; cross-store product matching; user accounts; cloud sync; mobile browsers; AI extraction; affiliate monetization.

## Estimate and confidence

Total initial planning estimate: 15-25 developer days, excluding store review and ongoing retailer maintenance. Confidence is high for conversion and extension feasibility, moderate for retailer coverage, and moderate-to-low for the schedule until milestone 1 is complete. The schedule is an estimate, not a commitment.

## References

Official references checked during the initial planning discussion. Recheck browser and store requirements at implementation/release time.

- Chrome content scripts: https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
- Chrome manifest format: https://developer.chrome.com/docs/extensions/reference/manifest
- Mozilla cross-browser extensions: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Build_a_cross_browser_extension
- Mozilla Chrome incompatibilities: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Chrome_incompatibilities
- NIST weight conversions: https://nvlpubs.nist.gov/nistpubs/hb/2026/NIST.HB.44-2026.pdf

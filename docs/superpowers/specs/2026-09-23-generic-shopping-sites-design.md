# Generic Shopping-Site Unit Prices

Date: 2026-09-23
Status: draft awaiting user review

## Objective

Extend Consistent Unit Price from its Amazon and Walmart integrations to unfamiliar ecommerce and grocery sites worldwide. The extension will preserve each page's local currency and convert only an explicit price-per-weight value. It will not perform foreign-exchange conversion or attempt to decide whether an entire page is a shopping page.

Success means that, after a user grants access to a site, an unambiguous visible label such as `$3.98/lb`, `90.7 cents per lb`, `EUR 1,29/100 g`, or `£0.85 per kg` can be normalized without a retailer-specific adapter. Existing Amazon and Walmart behavior must remain available and take precedence on those sites.

## Chosen Approach

Use a hybrid pipeline:

1. Keep the Amazon and Walmart adapters for their supported pages because they provide better product and variant association.
2. Add a generic visible-text detector as the fallback on user-approved origins.
3. Trigger conversion from an unambiguous `currency + price + per + weight` expression, not from a broad shopping-site classification.
4. Preserve the source currency identity while normalizing the monetary denomination and weight denominator requested by the user.

This is preferred over either a retailer registry, which cannot provide worldwide coverage, or a broad ecommerce classifier, which would create false confidence without improving the arithmetic evidence.

## Permission Model

Amazon and Walmart remain enabled by their existing site controls. For another site, the popup shows **Enable on this site**. The browser requests access only to that origin. Once granted, the extension registers its generic content script for future pages, injects it into the active page, and remembers the enabled origin locally.

The popup also provides **Disable on this site**. Removing access unregisters the generic script, removes the stored origin, and cleans up extension-owned labels on the active page when possible.

An advanced **Enable on all sites** option will request broad HTTP and HTTPS access, but it is not the default. Restricted browser pages, extension pages, local files, and unsupported schemes remain unavailable.

The Chrome and Firefox manifests will use optional host permissions for generic origins plus the scripting capability needed for dynamic content scripts. Granting an origin registers the generic content script for future matching pages and injects it into the active page immediately. Revoking an origin unregisters its script. Browser-specific manifest differences remain isolated in the existing build pipeline.

## Detection Pipeline

The generic detector scans visible text nodes in the top-level document. It ignores script, style, template, form-control, editable, hidden, and extension-owned content. It does not scan cross-origin frames.

A candidate must contain all of the following in one compact text region:

- a recognizable currency symbol, ISO currency code, or localized minor-unit word;
- a finite, positive localized number;
- an explicit separator such as `/`, `per`, or a supported localized equivalent; and
- a supported mass denominator: ounce, pound, gram, 100 grams, or kilogram, including conservative abbreviations.

Fluid-volume units such as `fl oz`, `fluid ounce`, millilitre, and litre are rejected. Package weights such as `12 oz bag` are not candidates because they do not express currency per weight. Ambiguous numbers, ranges, mixed currencies, malformed separators, and unsupported units are left unchanged.

Parsing is split into independent stages:

1. Candidate discovery finds compact visible text containing likely currency and weight tokens.
2. Locale-aware number parsing interprets decimal and grouping separators using the source text and document locale. If separators remain ambiguous, the candidate is rejected.
3. Currency-token parsing preserves the exact visible symbol, code, or minor-unit label. Ambiguous symbols such as `$` are not assigned an exchange-rate identity because no exchange conversion is performed.
4. Unit parsing returns a canonical mass unit and scale.
5. The shared conversion engine changes the monetary denomination when requested and safely defined, changes the weight denominator, and returns a formatted value plus provenance.

## Currency and Formatting Rules

There is no currency conversion and no network lookup.

Generic conversion preserves:

- the page's currency identity and an appropriate local symbol or ISO code;
- whether that token appears before or after the number;
- the source decimal convention when it can be determined safely.

For example, converting `€2,40/kg` to the 100-gram format produces `€0,24/100 g`, and a page mixing `90,7 ct/lb` with `€1,20/lb` can be normalized into one euro-per-pound format. The extension converts between major and minor denominations only when the relationship is known from an unambiguous ISO currency, a recognized local pair such as `$` and `¢`, or an explicit page-local format. It will not assume that every currency has 100 minor units. A candidate requiring an unknown denomination relationship is skipped.

The popup format choices use currency-neutral wording: local major currency per ounce, local minor currency per ounce, local major currency per pound, local major currency per 100 grams, local major currency per kilogram, or automatic. On a US-dollar page these correspond to the existing cents and dollars choices; on a euro page they correspond to cents and euros. If a currency has no minor denomination, or its minor denomination cannot be established safely, the minor-currency option leaves that candidate unchanged and reports the reason only when debugging is enabled.

Automatic mode selects the most common supported combination of monetary denomination and weight denominator among the page's native unit-price candidates. Ties use the user's last explicit format, then local major currency per pound if no prior choice exists.

## Adapter Precedence and Data Flow

For Amazon and Walmart, the retailer adapter runs first. A generic detector does not process a DOM region already claimed by that adapter. If the retailer adapter confidently finds a unit-price label, its established rendering and variant handling continue unchanged.

For any approved generic site:

1. The content script observes the initial document and batches later DOM mutations.
2. Candidate discovery returns source elements and parsed source text.
3. The conversion engine normalizes the value into the selected weight denominator.
4. The renderer uses the existing display-style setting to overlay the retailer value or add a separate label.
5. Each rendered value records its source text so a changed source invalidates the old result before recalculation.

The observer scans only added or changed subtrees and must ignore extension-owned mutations to prevent loops. Duplicate source elements are de-duplicated by element identity and source signature.

## Rendering and Safety

Overlay mode remains the default behavior. The generic renderer overlays only the exact text-bearing element that supplied the unit-price evidence. If safe overlay placement cannot be established, it falls back to the extension-owned label style instead of hiding unrelated text.

The original source text is retained in DOM metadata for restoration. Disabling the extension, changing display style, revoking site access, or invalidating a candidate restores the source element and removes extension-owned nodes.

The extension never rewrites product prices, checkout totals, package quantities, or currency identity. It changes only supported unit-price display text.

## Settings and Popup

The popup will contain:

- local major/minor currency and target-weight format choices;
- automatic most-common page format;
- overlay or separate-label display style;
- Amazon and Walmart toggles;
- the current site's permission status and enable/disable action;
- an advanced all-sites access option; and
- **Show debug console logs**, unchecked by default.

Debug logging is completely gated by the checkbox. When enabled, generic logs identify the page, original matched text, parsed currency token, original unit, converted text, target unit, and any rejection reason useful for troubleshooting. Product identification is included only when cheaply available and is not required for conversion.

Settings remain local to the browser. No scanned text, URLs, currency data, or browsing history is transmitted externally.

## Failure Behavior

Unsupported or uncertain candidates remain untouched. Generic pages do not receive visible `Cannot compare` labels because broad page scanning could otherwise add noise to non-product content. Rejection reasons appear only in debug logs when logging is enabled.

A single malformed candidate cannot stop processing other candidates. Permission failures and unsupported browser pages are reported in the popup without repeated prompts. If a dynamic-script registration fails, the site remains marked disabled until registration succeeds.

## Implementation Boundaries

Add focused modules rather than expanding the retailer adapters:

- generic candidate discovery and DOM filtering;
- locale-aware numeric parsing;
- currency-token preservation and formatting;
- generic unit-price parsing;
- optional-origin permission and content-script registration;
- settings migration and popup site controls; and
- generic scan coordination integrated with the existing observer and renderer.

The shared arithmetic module remains responsible only for mass-unit conversion. Retailer selectors remain out of shared code. Generic parsing does not import Amazon or Walmart selectors.

## Verification

No automated test suite is added unless requested. Verification will use the existing typecheck/build process and manual browser checks in both Firefox and Chrome.

Manual cases will cover:

- major currency symbols before and after the number;
- ISO codes;
- comma and period decimal formats;
- non-breaking spaces;
- ounce, pound, gram, 100-gram, and kilogram denominators;
- minor-unit labels without assuming a 100:1 ratio;
- fluid ounces and package weights being ignored;
- dynamically inserted and changed prices;
- duplicate-prevention and restoration;
- per-site grant, persistence, disable, and revocation;
- Amazon and Walmart adapter precedence; and
- debug logs off by default and informative when enabled.

Screenshots and observed results will be recorded in the existing manual-QA documentation. Claims will distinguish correct conversions, safe skips, and incorrect conversions.

## Explicit Non-Goals

- Foreign-exchange conversion.
- Guessing a currency from geography when no currency token is visible.
- Classifying every ecommerce page or identifying every product.
- Converting volume, count, area, or length pricing.
- Reading cross-origin frames.
- Sending page data to a server or AI service.
- Guaranteeing support for every localized word meaning `per` in the first release.

## Risks

The largest risk is false-positive text matching on non-product content. Per-site permission, strict expression requirements, visibility filtering, exact-element overlays, and safe rejection reduce this risk. Locale parsing is the next largest risk; ambiguous numeric formats must be skipped rather than guessed.

Dynamic content-script registration differs slightly between Chrome and Firefox. The implementation plan must include browser-specific registration and permission verification before generic extraction work is considered complete.

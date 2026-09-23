# Retailer support and extraction rules

## Release scope

The extension supports public Amazon.com and Walmart.com listings priced in US dollars when the merchandise is sold by net weight. Supported output formats are:

- `¢/oz`
- `$/oz`
- `$/lb`
- `$/100 g`
- `$/kg`

The calculation basis is the ordinary selected one-time-purchase price. Tax and shipping are never included. An unconditional active sale price is eligible. Subscription prices, clipped coupons, membership prices, rebates or store cash, and conditional quantity discounts are not eligible.

The extension must fail closed. It must not infer a missing unit, count, pack size, selected variant, or price-to-quantity association.

## Observation status

**Milestone 1 acceptance status: incomplete.** Live public pages were inspected on September 20, 2026 in the Codex in-app desktop browser, in a signed-out session. The surface did not identify its browser engine or version, so these preliminary observations do **not** count as Chrome or Firefox verification.

During the review follow-up, the connected-browser inventory contained no browser surfaces. Direct attempts to open the in-app browser, Chrome, and Firefox were unavailable. Consequently, no Chrome or Firefox version could be observed and none of the twelve required store/surface/browser checks could be completed. This is an environmental limitation, not a passed check.

| Store | Surface | Desktop Chrome | Desktop Firefox | Preliminary in-app observation |
| --- | --- | --- | --- | --- |
| Amazon.com | Product page | **Not observed** — browser and version unavailable | **Not observed** — browser and version unavailable | Observed; unidentified engine/version |
| Amazon.com | Search cards | **Not observed** — browser and version unavailable | **Not observed** — browser and version unavailable | Observed; unidentified engine/version |
| Amazon.com | Category cards | **Not observed** — browser and version unavailable | **Not observed** — browser and version unavailable | Observed on Oatmeal; unidentified engine/version |
| Walmart.com | Product page | **Not observed** — browser and version unavailable | **Not observed** — browser and version unavailable | Observed; unidentified engine/version |
| Walmart.com | Search cards | **Not observed** — browser and version unavailable | **Not observed** — browser and version unavailable | Observed; unidentified engine/version |
| Walmart.com | Category cards | **Not observed** — browser and version unavailable | **Not observed** — browser and version unavailable | Observed on Oatmeal & Grits; unidentified engine/version |

The milestone remains blocked on access to both intended browsers. When access exists, record the full browser name and version for every run and complete all twelve checks, including variant changes and live clipped-coupon cases. No claim of Chrome or Firefox support should be made before then.

Location-sensitive availability, delivery dates, store identity, account state, and other personalized page content are deliberately not part of these notes or extraction inputs.

## Common quantity and price rules

### Eligible quantity evidence

1. Accept `oz`, `lb`, `g`, and `kg`, including unabbreviated singular and plural forms.
2. Use net product weight. Never use shipping weight, package weight, dimensional weight, or a value attached only to `Product Dimensions`.
3. A stated total net weight is authoritative and must not be multiplied again.
4. Multiply a count by a per-package weight only when the language explicitly connects them, for example `32 oz (Pack of 4)` or a selected `3 Pack` variant of a `42 oz` product.
5. Nested counts are eligible only when every level is explicit, such as `1 oz, 10 Count` within a `(5 pack)`. Otherwise return an unavailable reason.
6. If a page states both a total and component weights, they must agree after unit conversion. A material conflict is not resolved by choosing the more convenient value.
7. Treat `fl oz`, `fluid ounce`, `mL`, `L`, and other volume measures as unsupported. A bare `oz` is also unsupported when nearby evidence identifies it as fluid volume.
8. Mixed bundles are unsupported unless one comparable total net weight explicitly covers every included item. Free accessories such as a bottle do not supply missing food weight.

### Eligible price evidence

1. Use the explicitly visible ordinary one-time-purchase current price for the selected package. The ordinary purchase control need not itself be selected if that price remains visible and its association with the selected package is unambiguous.
2. For an unconditional sale, use the current `Now`, deal, or sale price. Ignore crossed-out, list, typical, and `Was` prices.
3. Ignore subscription prices even when they are lower or are the most visually prominent.
4. Ignore clipped coupons and prices that require a coupon checkbox or code.
5. Ignore membership-only prices, store-cash or rebate values, buy-more-save-more offers, and prices conditional on purchasing a different quantity.
6. Ignore tax and shipping. A listing remains eligible when shipping is shown separately, but shipping is never added to the numerator.
7. Require USD. A dollar sign alone is sufficient only on the US storefront with no conflicting currency marker.

### Association requirement

Price and quantity must belong to the same product card or the same currently selected product offer. Proximity elsewhere on the page is not enough. Do not combine a page-level price with an unselected variant, a recommended product, an adjacent card, or a generic product-details value.

Structured page data may be used only when all of the following are verified against the visible page:

- it identifies the same retailer item or ASIN;
- its offer or variant identifier matches the visibly selected offer;
- its price matches the visible eligible price; and
- its quantity describes that selected offer rather than a parent product, shipping package, or alternate variant.

Otherwise, structured data is ignored rather than used to fill a gap.

### Conversion and display

Keep full precision through conversion, then round only the displayed result to two decimal places.

- `1 lb = 16 oz`
- `1 oz = 28.349523125 g`
- `1 kg = 1000 g`
- `¢/oz = price_USD × 100 / total_oz`
- `$/oz = price_USD / total_oz`
- `$/lb = price_USD / total_lb`
- `$/100 g = price_USD / (total_g / 100)`
- `$/kg = price_USD / total_kg`

## Amazon.com

### Product pages

Extraction precedence:

1. Establish the selected variation from the selected size, pack, style, flavor, or other variation control. Every quantity-bearing variation that can change the offer must be resolved.
2. Within the buy box for that selection, prefer the expanded `One-time purchase` offer and its current price.
3. Read quantity from the selected variation label when it is explicit. Use the product title or a visible `Units` field only as corroboration or when it unambiguously describes the same selected ASIN and variation.
4. A visible current price in the central price block may corroborate the one-time buy-box price, but it does not override a conflicting buy box.
5. Eligible active sale text associated with that one-time offer overrides its struck-through or `Typical` price.

Observed example: ASIN `B0D14XHFG3` showed selected size `42 Ounce (Pack of 2)`, selected style `Rolled`, an expanded one-time price of `$15.58`, and a separate collapsed Subscribe & Save price of `$14.80`. The eligible inputs are `$15.58` and `84 oz`. The visible `Units: 84 Ounce` corroborated the total. `Product Dimensions ... 5.26 pounds` was not used because it is not labeled net product weight and conflicts slightly with the explicit 84 oz total.

Failure rules:

- If no ordinary one-time offer is visible, return `Ordinary one-time price unavailable`.
- If a quantity-bearing variation is unselected or the price belongs to another variation, return `Selected offer is ambiguous`.
- If title, selected variation, and `Units` evidence conflict materially, return `Conflicting net weights`.
- If the only eligible-looking weight is under `Product Dimensions`, return `Net product weight unavailable`.
- If only Subscribe & Save, coupon, membership, or quantity-discount pricing is visible, return `Ordinary one-time price unavailable`.

### Search cards

Extraction precedence:

1. Bound all evidence to one search-result card and its product link.
2. Read the exact product title plus any explicit size or pack line in that card.
3. Read the card's current product-page price. For a visible unconditional sale, use the current price and ignore `Typical` or crossed-out text.
4. Multiply an explicit pack count by its explicit per-package weight. Do not reuse a page heading or neighboring card's quantity.
5. Treat subscription and coupon badges as annotations only; they never reduce the eligible price.

Observed example: the card for `365 by Whole Foods Market ... 42 Ounce (Pack of 2)` showed `$15.58` and `$0.19/ounce` within the same result card. The extension may independently calculate from `$15.58 / 84 oz`; the retailer's displayed unit price is corroboration, not an input substitute.

Failure rules:

- If a card contains multiple sizes or an option range without an explicit current selection, return `Selected offer is ambiguous`.
- If title and size-line quantities conflict, return `Conflicting net weights`.
- If the card has no weight and count combination that yields a total, return `Net product weight unavailable`.
- If only a per-count price is shown and weight is missing, return `Net product weight unavailable`.

### Category cards

Extraction precedence:

1. Bound title, size/pack label, price, and sale text to one category carousel or category-result card.
2. Prefer an explicit card size/pack label over a looser marketing phrase in the title when they agree on the product identity.
3. Use the current card price. An unconditional `formerly`, `Typical`, or struck-through value is comparison text only.
4. Require the card to expose one exact offer. A card that only opens a chooser, has no price, or presents a price range is not enough.

Observed examples on the Oatmeal category included an 18 oz single pack at `$4.49`, 32 oz four-packs, subscription badges, and a card with `formerly $32.99` beside a current `$30.31` price. Some cards exposed a pack count without any weight; those are unsupported.

Failure rules are the same as search cards, with one additional rule: if the category card is only a family/collection tile, return `Exact offer unavailable`.

## Walmart.com

### Product pages

Extraction precedence:

1. Establish the selected pack/size variation from the checked radio button or equivalent selected control.
2. Read the current price and unit annotation associated with that selected variant.
3. Locate an explicitly labeled ordinary `One-time purchase` price for the same selected package. That ordinary price remains eligible whether the one-time or subscription control is selected, provided it stays visible and its association with the selected package is unambiguous. Never substitute the prominent subscription price.
4. Read net weight from the selected variant label and product title. Multiply the selected pack count only when the per-pack weight is explicit.
5. For a sale, use `Now` or the current price and ignore `Was`.

Observed example: item `10314925` showed a checked `Single, $4.38, 10.4 ¢/oz` variant for a 42 oz product, an unchecked `3 Pack, $13.14, 10.4 ¢/oz` variant, and a checked `One-time purchase $4.38` control. A separate Subscribe option was present. The eligible observed inputs are `$4.38` and `42 oz`; the 3-pack quantity must not be used until that variant is selected.

Failure rules:

- If the checked variant cannot be identified, return `Selected offer is ambiguous`.
- If the eligible ordinary one-time price conflicts with the checked variant's ordinary price, return `Price does not match selected offer`. Exclude subscription prices from this comparison; for example, a selected package with an ordinary `$10` price and a prominent subscription `$9` price uses `$10` and is not a conflict.
- If no explicitly visible ordinary one-time price can be tied to the selected package, return `Ordinary one-time price unavailable`, regardless of which purchase-option control is selected.
- If the only weight is in shipping/specification data and not identified as net product weight, return `Net product weight unavailable`.

### Search cards

Extraction precedence:

1. Bound all evidence to one product card.
2. If the card has variant controls, require one visibly selected checkbox/radio and associate its label with the card's current price.
3. Otherwise require one exact title/weight and one current price with no option range or competing quantity.
4. The card's unit-price text may corroborate the result, but the extension still derives its value from the eligible price and net weight.
5. Ignore Subscribe buttons, Walmart+ messaging, shipping, Walmart Cash, and other conditional benefits.

Observed example: the Great Value 42 oz oats card showed `Single` checked, `3 Pack` unchecked, `$4.38`, `10.4 ¢/oz`, and an option range of `$4.38–$13.14`. Only the checked Single and `$4.38` are associated. The range endpoints are not extraction inputs.

Failure rules:

- If an option range is shown without a selected option, return `Selected offer is ambiguous`.
- If the card exposes a price but no usable weight, return `Net product weight unavailable`.
- If the only displayed price is conditional, return `Ordinary one-time price unavailable`.
- If the card is missing a current price, return `Price unavailable`.

### Category cards

Extraction precedence:

1. Bound title, current price, unit annotation, sale text, and option state to one category-result card.
2. Use `Now` or the active current price for an unconditional sale; ignore `Was` and separately displayed shipping.
3. Use an explicit exact weight or an explicit weight-times-count expression from the same card.
4. If a card only says `Available in additional options` and shows an options range, require a visible selected option before calculating.
5. A retailer-displayed `/fl oz` annotation overrides a bare `oz` marketing title and makes the item unsupported as volume.

Observed examples on the Oatmeal & Grits category included a current `$2.98` price with `Was $8.90` for an 18 oz item, a 52 oz beverage explicitly priced per fluid ounce, multipacks, cards with Subscribe buttons, and cards with no visible weight.

Failure rules:

- Volume item: return `Fluid volume is not supported`.
- Product with no comparable net weight: return `Net product weight unavailable`.
- Mixed bundle without one explicit comparable total: return `Mixed bundle has no comparable net weight`.
- Option family without a selected offer: return `Selected offer is ambiguous`.

## User-visible unavailable reasons

Use the most specific applicable reason. Do not replace these with a guessed result.

- `Price unavailable`
- `Ordinary one-time price unavailable`
- `Net product weight unavailable`
- `Selected offer is ambiguous`
- `Price does not match selected offer`
- `Conflicting net weights`
- `Fluid volume is not supported`
- `Mixed bundle has no comparable net weight`
- `Exact offer unavailable`
- `Currency is not supported`

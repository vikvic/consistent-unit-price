# Manual QA: retailer extraction

## Observed environment and limits

**Milestone 1 acceptance status: incomplete.** Evidence was collected September 20, 2026 from public, signed-out Amazon.com and Walmart.com pages in the Codex in-app desktop browser. The surface did not identify its browser engine or version. Product pages, search cards, and category cards were observed for both stores only in that preliminary environment.

During the review follow-up, the connected-browser inventory contained no browser surfaces. Direct attempts to open the in-app browser, Chrome, and Firefox were unavailable. Desktop Chrome and desktop Firefox therefore remain **not observed**, and their versions are **unavailable** rather than inferred. None of the twelve required combinations of Amazon/Walmart × product/search/category × Chrome/Firefox is complete. Changing variants, both live clipped-coupon cases, and Amazon fluid-ounce coverage are also outstanding.

| Store | Surface | Chrome name/version and result | Firefox name/version and result |
| --- | --- | --- | --- |
| Amazon.com | Product page | Not available; version unavailable; not observed | Not available; version unavailable; not observed |
| Amazon.com | Search cards | Not available; version unavailable; not observed | Not available; version unavailable; not observed |
| Amazon.com | Category cards | Not available; version unavailable; not observed | Not available; version unavailable; not observed |
| Walmart.com | Product page | Not available; version unavailable; not observed | Not available; version unavailable; not observed |
| Walmart.com | Search cards | Not available; version unavailable; not observed | Not available; version unavailable; not observed |
| Walmart.com | Category cards | Not available; version unavailable; not observed | Not available; version unavailable; not observed |

Prices and availability are volatile. Match the evidence pattern and association, not the historical price. Do not record account names, addresses, ZIP codes, store identifiers, delivery dates, order history, or other personalized content in results or bug reports.

Display expectations below assume full-precision conversion followed by two-decimal display rounding.

## Amazon.com cases

| ID | Surface and scenario | Evidence to associate | Expected result |
| --- | --- | --- | --- |
| AMZ-P-01 | Product page: selected multipack and variants | ASIN `B0D14XHFG3`; selected `42 Ounce (Pack of 2)` and `Rolled`; expanded one-time price `$15.58`; separate Subscribe & Save `$14.80`; visible `Units: 84 Ounce` | Use `$15.58 / 84 oz`. Show `18.55¢/oz`, `$0.19/oz`, `$2.97/lb`, `$0.65/100 g`, or `$6.54/kg`. Ignore the subscription price. |
| AMZ-P-02 | Product page: shipping-like weight conflicts with net total | Same page: `Product Dimensions ... 5.26 pounds` versus selected 42 oz × 2 and `Units: 84 Ounce` | Use the explicit 84 oz net total. Never use the dimensions weight. If the selected size and Units field did not agree, show `Conflicting net weights`. |
| AMZ-P-03 | Product page: single-pack variant | Same page exposes `18 Ounce (Pack of 1), $4.49` and `42 Ounce (Pack of 1), $7.79` as unselected variants | Do not use either unselected quantity or price. After manually selecting one in Chrome/Firefox, require the selected state and updated one-time price before calculating. This interaction remains unverified. |
| AMZ-S-01 | Search card: multipack | One result card contained `365 ... 42 Ounce (Pack of 2)`, `$15.58`, and `$0.19/ounce` | Associate only values inside that card. Expected result is the same as AMZ-P-01; retailer unit text is corroboration. |
| AMZ-S-02 | Search card: metric quantity | A signed-out search card for `100% Dak Lak Vietnamese Coffee ... 1 Kilo Bag` showed `$32.88` in the same card and a retailer `/count` annotation | Ignore `/count`; the explicit 1 kg net weight is sufficient. Expected `$32.88/kg`, `$3.29/100 g`, `$14.91/lb`, `$0.93/oz`, or `93.21¢/oz`. |
| AMZ-C-01 | Category card: single pack | Oatmeal category card: `365 ... 18 Ounce`, `$4.49` | Use `$4.49 / 18 oz`: `24.94¢/oz`, `$0.25/oz`, `$3.99/lb`, `$0.88/100 g`, or `$8.80/kg`. |
| AMZ-C-02 | Category card: unconditional sale | Oatmeal category card: Nature's Path oats, `18 oz (Pack of 6)`, current `$30.31`, `formerly $32.99` | Use `$30.31 / 108 oz`; ignore `$32.99`. Expected `28.06¢/oz`, `$0.28/oz`, `$4.49/lb`, `$0.99/100 g`, or `$9.90/kg`. |
| AMZ-C-03 | Category card: missing weight | Oatmeal category card: `Kodiak Peak ... 6pk`, `$35.88`, with no per-item or total net weight in the card | Show `Net product weight unavailable`. Do not infer packet size. |
| AMZ-C-04 | Related/category-style card: mixed bundle | Card for `Oats Overnight Party Variety Pack – ... 8 Pack + Bottle`, `$43.99`, without a comparable total net food weight | Show `Mixed bundle has no comparable net weight`. Do not treat the bottle as product weight or infer packet weight. |
| AMZ-X-01 | **Outstanding — not observed:** clipped coupon | No public listing identifier, ordinary price/quantity association, or live coupon evidence was captured. The preliminary in-app pass did not encounter a coupon, and no browser surface was available during follow-up. | Incomplete. When a public case is accessible, record its ASIN, selected package, visible ordinary one-time price, net weight, and exact coupon/clip text. Expected rule: ignore the coupon reduction; if the ordinary price is not separately visible, show `Ordinary one-time price unavailable`. |
| AMZ-X-02 | **Outstanding — not observed:** fluid ounces | No public listing identifier, visible ordinary price/quantity association, or `fl oz` evidence was captured before browser access became unavailable. | Incomplete. When a public case is accessible, record its ASIN, ordinary price, quantity, and exact fluid-volume label. Expected rule: show `Fluid volume is not supported`, even if Amazon displays a unit price. |

## Walmart.com cases

| ID | Surface and scenario | Evidence to associate | Expected result |
| --- | --- | --- | --- |
| WMT-P-01 | Product page: selected single pack | Item `10314925`; checked `Single, $4.38, 10.4 ¢/oz`; title `42 oz`; checked `One-time purchase $4.38`; Subscribe is separate | Use `$4.38 / 42 oz`. Show `10.43¢/oz`, `$0.10/oz`, `$1.67/lb`, `$0.37/100 g`, or `$3.68/kg`. |
| WMT-P-02 | Product page: unselected multipack variant | Same page exposed unchecked `3 Pack, $13.14, 10.4 ¢/oz` | While Single remains checked, continue using 42 oz and `$4.38`. After selecting 3 Pack in Chrome/Firefox, require the selection and page price to update, then use 126 oz and `$13.14`. Variant switching remains unverified. |
| WMT-P-03 | Product page: subscription | Same selected 42 oz package exposed separately labeled Subscribe and `One-time purchase $4.38` controls; one-time was checked | Ignore the subscription price. If Subscribe becomes selected but the explicitly labeled ordinary one-time price for the same selected package remains visible, continue using only that ordinary price. If it is no longer visible or cannot be tied to the selected package, show `Ordinary one-time price unavailable`. |
| WMT-S-01 | Search card: explicit selected variant | Great Value 42 oz oats card showed `Single` checked, `3 Pack` unchecked, `$4.38`, `10.4 ¢/oz`, and `Options from $4.38–$13.14` | Use the checked Single plus `$4.38`. Ignore the range. Expected displays match WMT-P-01. |
| WMT-S-02 | Search card: metric quantity | `Vilar Classic Espresso Blend - 1 kg (2.204 lbs)` card showed `$18.00` with no conditional discount | Use `$18.00 / 1 kg`. Show `51.03¢/oz`, `$0.51/oz`, `$8.16/lb`, `$1.80/100 g`, or `$18.00/kg`. |
| WMT-C-01 | Category card: unconditional sale | Oatmeal & Grits card: Quaker Quick 1-Minute Oats, `18oz`, `Now $2.98`, `Was $8.90`, `16.6 ¢/oz` | Use `$2.98 / 18 oz`; ignore `$8.90`. Show `16.56¢/oz`, `$0.17/oz`, `$2.65/lb`, `$0.58/100 g`, or `$5.84/kg`. |
| WMT-C-02 | Category card: fluid ounces | Planet Oat Humble Edition card: `52oz`, `$3.38`, and retailer annotation `6.5 ¢/fl oz` | Show `Fluid volume is not supported`. The `/fl oz` evidence prevents treating bare title `oz` as mass. |
| WMT-C-03 | Category card: missing weight | FishSki Provisions jalapeno yellow corn grits card showed `$12.05` but no net weight | Show `Net product weight unavailable`. Do not infer from category or similar cards. |
| WMT-C-04 | Category card: exact explicit multipack | `(5 pack) Great Value Butter Instant Grits, 1 oz, 10 Count`, `$10.85`, `21.7 ¢/oz` | The explicit nested quantity is 5 × 10 × 1 oz = 50 oz. Use `$10.85 / 50 oz`; expected `21.70¢/oz`, `$0.22/oz`, `$3.47/lb`, `$0.77/100 g`, or `$7.65/kg`. |
| WMT-C-05 | Category card: option family without selection | A card says `Available in additional options` and shows an options price range, but no checked option | Show `Selected offer is ambiguous`. Do not use the lowest range price with the title weight. |
| WMT-X-01 | **Outstanding — not observed:** clipped coupon or Walmart Cash offer | No public Walmart item identifier with a captured ordinary price/quantity association and live coupon/Walmart Cash evidence was available in the preliminary pass; no browser surface was available during follow-up. | Incomplete. When a public case is accessible, record the item ID, selected package, ordinary price, net weight, and exact conditional-offer text. Expected rule: do not subtract Walmart Cash, coupon, or membership savings; if no ordinary price is separately visible, show `Ordinary one-time price unavailable`. |
| WMT-X-02 | Any surface: shipping shown separately | Eligible card shows a product price plus separate shipping | Calculate from product price only. Shipping must not change the numerator. |

## Cross-store failure checks

Run each on both stores and all three surfaces when a representative listing is available.

| Scenario | Expected unavailable reason |
| --- | --- |
| USD price missing | `Price unavailable` |
| Only subscription/coupon/conditional price is knowable | `Ordinary one-time price unavailable` |
| Weight missing or only shipping/package weight exists | `Net product weight unavailable` |
| No selected variant or price range cannot be tied to one option | `Selected offer is ambiguous` |
| Visible price conflicts with selected variation | `Price does not match selected offer` |
| Two plausible net quantities conflict | `Conflicting net weights` |
| Fluid ounces or another volume measure | `Fluid volume is not supported` |
| Mixed products without one comparable net total | `Mixed bundle has no comparable net weight` |
| Category family tile rather than an exact offer | `Exact offer unavailable` |
| Non-USD storefront or currency | `Currency is not supported` |

## Release-browser checklist

This checklist is required to complete Milestone 1, not a deferred release-only check. For each of desktop Chrome and desktop Firefox, record the full browser name and version, then:

1. Open a fresh signed-out Amazon product page, search page, and category page; run AMZ-P-01, AMZ-S-01, and AMZ-C-01.
2. Change the Amazon selected size and confirm price and quantity move together before calculating.
3. Open a fresh signed-out Walmart product page, search page, and category page; run WMT-P-01, WMT-S-01, and WMT-C-01.
4. Change the Walmart pack variant and confirm the checked state, title, current price, and quantity remain associated.
5. Find a live clipped-coupon offer on each store and confirm the extension ignores the coupon while retaining the ordinary one-time price.
6. Confirm the extension rejects a fluid-ounce product, a missing-weight product, and an ambiguous option-family card with the exact reason strings above.
7. Confirm no extracted or logged data includes account, address, store, ZIP code, order, delivery, or other personalized page content.

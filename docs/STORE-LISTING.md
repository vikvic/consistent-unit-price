# Store listing copy

Use this copy for the first public Chrome Web Store and Firefox Add-ons release of version 0.1.0.

## Identity

- Name: Consistent Unit Price
- Category: Shopping
- Language: English
- Homepage: https://github.com/vikvic/consistent-unit-price
- Support: https://github.com/vikvic/consistent-unit-price/issues
- Privacy policy: https://github.com/vikvic/consistent-unit-price/blob/main/PRIVACY.md

## Short description

Compare Amazon and Walmart products using one consistent weight-based unit-price format.

## Detailed description

Consistent Unit Price makes weight-based prices easier to compare on Amazon.com and Walmart.com.

Shopping pages often mix formats such as cents per ounce and dollars per pound. The extension recognizes explicit weight-based unit prices and displays them in one format selected by you. Supported formats include cents per ounce, dollars per ounce, dollars per pound, price per 100 grams, and price per kilogram.

Choose a format manually or let automatic mode use the most common supported format on the page. On Walmart, you can place the standardized value over the retailer's unit price or show it as a separate label. Prices that already use the selected format receive the same prominent styling, so comparable values remain easy to scan.

The extension preserves the page's currency and never performs foreign-exchange conversion. Ambiguous prices, volume measurements, package-count prices, ranges that cannot be compared safely, and unsupported units are left unchanged.

All processing happens locally in your browser. There is no account, server, analytics service, advertising, or transmission of product and browsing data.

Current dedicated retailer support:

- Amazon.com
- Walmart.com

## Chrome single-purpose statement

The extension's single purpose is to recognize explicit weight-based unit prices on supported shopping pages and present comparable prices in the user's selected weight-based format.

## Permission justifications

### storage

Stores the user's preferred unit-price format, format mode, display style, and enabled retailer settings locally in the browser. No stored setting is transmitted.

### scripting

Registers or removes the local conversion content script after the user grants or revokes access to Amazon or Walmart. It is also used to activate the converter immediately on an already-open approved retailer page. No remote code is downloaded or executed.

### Amazon.com and Walmart.com site access

Amazon and Walmart access is optional and requested separately when the user enables a retailer in the popup. Once approved, it allows the content script to read visible product and unit-price text and to add or restyle standardized unit-price labels on that retailer's pages. Disabling a retailer removes its site permission. The extension does not read credentials, checkout information, or payment details, and it does not transmit page contents.

## Data-use answers

- Collects user data: No.
- Sells user data: No.
- Uses data for advertising or profiling: No.
- Transfers page content off the device: No.
- Uses remote code: No.
- Uses analytics or telemetry: No.

## Firefox reviewer notes

The submitted extension is built from the accompanying source archive with `npm install` followed by `npm run build:firefox`. The resulting package is `dist/firefox`.

No account or test credentials are required.

Suggested functional review:

1. Install the extension and open `https://www.walmart.com/search?q=shrimp`.
2. Open the extension popup.
3. Enable Walmart and approve the browser's Walmart access prompt.
4. Select `Dollars per pound` and select `Overlay retailer unit price`.
5. Unit-price values such as cents per ounce should be displayed as blue dollars-per-pound values. Already matching dollars-per-pound values receive the same styling.
6. Switch Walmart off in the popup and confirm its site permission is removed.
7. The manual calculator in the popup can be reviewed without visiting a retailer page.

The build uses TypeScript and esbuild. Generated JavaScript is bundled but not intentionally obfuscated. Source maps are included in the extension package, and the original TypeScript source is included in the separate source archive.

## Chrome reviewer notes

No account or test credentials are required. Use the same Walmart review procedure above. Amazon and Walmart permissions are optional and are used only for visible unit-price recognition and presentation after the reviewer enables the corresponding retailer.

## Release notes for 0.1.0

Initial public release with Amazon.com and Walmart.com support, manual and automatic unit-price formats, Walmart overlay and separate-label display styles, local preferences, consistent styling, and a manual unit-price calculator.

## Store graphics

- Extension icon: `store-assets/icon-128.png`
- Before screenshot: `store-assets/01-before-1280x800.png`
- After screenshot: `store-assets/02-after-1280x800.png`
- Chrome small promotional image: `store-assets/promo-440x280.png`

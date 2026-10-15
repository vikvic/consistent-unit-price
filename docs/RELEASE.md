# Release and store submission

## Create release files

From the repository root on Windows:

```powershell
npm install
npm run release
```

The release command regenerates store graphics, builds both browser targets, creates three archives under `release`, and verifies their required root entries:

- `consistent-unit-price-chrome-<version>.zip`
- `consistent-unit-price-firefox-<version>.zip`
- `consistent-unit-price-source-<version>.zip`

The Chrome and Firefox archives contain `manifest.json` at the archive root. The source archive contains the TypeScript source, manifests, deterministic asset generator, package metadata, and build instructions for Mozilla review.

## Firefox Add-ons

1. Sign in to https://addons.mozilla.org/developers/.
2. Select **Submit a New Add-on**.
3. Choose **On this site** for a public listing with automatic updates.
4. Upload the Firefox ZIP from `release`.
5. If source is requested, upload the source ZIP from `release`.
6. Copy the listing and reviewer text from `docs/STORE-LISTING.md`.
7. Upload the prepared screenshots from `store-assets`.
8. Complete Mozilla's policy agreement and final submission.

After approval, install the extension from its Firefox Add-ons listing. That signed installation persists when Firefox restarts.

After installation or upgrade, open the extension popup and explicitly enable Amazon and Walmart as needed. Each control triggers the browser's permission prompt for that retailer only.

## Chrome Web Store

1. Sign in to https://chrome.google.com/webstore/devconsole.
2. Complete developer registration and its one-time fee if required.
3. Select **New item** and upload the Chrome ZIP from `release`.
4. Copy the listing, privacy, permission, and reviewer text from `docs/STORE-LISTING.md`.
5. Upload the prepared icon, screenshots, and promotional image from `store-assets`.
6. Choose the intended visibility and regions.
7. Complete Google's developer agreement, privacy declarations, and final submission.

After installation or upgrade, open the extension popup and explicitly enable Amazon and Walmart as needed. Each control triggers the browser's permission prompt for that retailer only.

## Publish an update

1. Increase `version` in `package.json`, `manifests/chrome.json`, and `manifests/firefox.json`.
2. Run `npm run release`.
3. Upload the new browser archives to the existing store listings.
4. Never create a new listing for a routine version update.

The Firefox extension ID `consistent-unit-price@vikvic.github.io` is permanent and must not change between releases.

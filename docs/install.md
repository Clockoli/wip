# Install Clockoli

Install Clockoli from the Chrome Web Store, from a release file for Firefox and Safari, or from a development checkout.

Clockoli is a browser extension for Chrome and other Chromium browsers, Firefox, and Safari on macOS. When it is installed, follow [Getting started](getting-started.md).

## Supported browsers

- Chrome or another Chromium browser, version 102 or newer;
- Firefox 140 or newer;
- Safari 18 or newer on macOS.

## Chrome and other Chromium browsers

Add Clockoli from the [Chrome Web Store](https://chromewebstore.google.com/detail/clockoli/omkikhlcnbjpfbiicogjekhjgmbajmnl), then pin it to the toolbar so it is available on non-GitHub pages. Store installations update automatically. Store review can make the listed version trail the latest GitHub release.

## Firefox

Download `Clockoli-X.Y.Z-firefox-signed.xpi` from a [GitHub release](https://github.com/clockoli/clockoli/releases). Open `about:addons`, choose the gear menu → **Install Add-on From File**, and select it.

The unsigned `Clockoli-X.Y.Z-firefox.xpi` is for store submission and temporary testing. To load it, open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select the XPI. Temporary installations last until Firefox restarts.

## Safari

1. Download `Clockoli-X.Y.Z-safari-extension.zip` from a [GitHub release](https://github.com/clockoli/clockoli/releases) and extract it.
2. In Safari Settings → Advanced, turn on **Show features for web developers**.
3. In Safari Settings → Developer, choose **Add Temporary Extension…** and select the extracted folder. It must contain `manifest.json` at its top level.

Safari removes temporary extensions after 24 hours or when you quit Safari ([Apple documentation](https://developer.apple.com/documentation/safariservices/running-your-safari-web-extension)). Add the folder again to keep using Clockoli. Let pending changes sync before you quit Safari.

The `Clockoli-X.Y.Z-safari-unsigned.zip` app is ad-hoc signed and not notarized, so macOS can refuse to open it on another Mac. When a release includes `Clockoli-X.Y.Z-safari.zip`, it contains the signed, notarized app: move `Clockoli.app` to Applications, open it once, and enable Clockoli in Safari Settings → Extensions. That installation stays across restarts.

## Development checkout (Chromium)

1. Clone or update the repository:

   ```bash
   git clone git@github.com:clockoli/clockoli.git
   cd clockoli
   git switch main
   git pull --ff-only
   ```

2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Choose the directory containing Clockoli's `manifest.json`.

To use a release `Clockoli-X.Y.Z.zip` unpacked, extract it into a permanent folder first and select that folder. Do not select the ZIP itself.

## Update a file installation

Unpacked and file installations do not update automatically:

1. Pull the latest trusted source, or install the newer release file.
2. For an unpacked installation, open `chrome://extensions` and select **Reload** on the Clockoli card.
3. Refresh any already-open GitHub tabs so they receive the current content script.

## Move to another browser or installation

Before you replace an installation or switch browser, let pending changes sync, stop the timer, and [export your settings](settings.md#backup--restore). Credentials and local state do not move between browsers, browser profiles, or a store and an unpacked installation.

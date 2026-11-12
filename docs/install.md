# Install Clockoli

Clockoli is a browser extension. The simplest installation is through the Chrome Web Store; Firefox and Safari builds are currently available as release files.

## Supported browsers

- **Chrome and Chromium-based browsers:** 102 or newer, with some features requiring newer Chrome versions.
- **Firefox:** 140 or newer (preview build).
- **Safari on macOS:** 18 or newer (preview build).

After installation, follow [Getting started](getting-started.md).

## Chrome and Chromium

[Install Clockoli from the Chrome Web Store](https://chromewebstore.google.com/detail/clockoli/omkikhlcnbjpfbiicogjekhjgmbajmnl). Pin the extension to your toolbar to track non-GitHub pages. Store installations update automatically, although store review can delay a release.

## Firefox

Download `Clockoli-X.Y.Z-firefox-signed.xpi` from [GitHub Releases](https://github.com/clockoli/clockoli/releases). Open `about:addons`, use the gear menu's **Install Add-on From File** action, and select the XPI.

If a signed file is unavailable, an unsigned XPI can only be installed temporarily through `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on**. It disappears when Firefox restarts.

## Safari

1. Download and extract `Clockoli-X.Y.Z-safari-extension.zip` from [GitHub Releases](https://github.com/clockoli/clockoli/releases).
2. In **Safari Settings → Advanced**, enable **Show features for web developers**.
3. In **Safari Settings → Developer**, select **Add Temporary Extension…** and choose the extracted folder containing `manifest.json`.

Safari removes temporary extensions after 24 hours or when you quit the browser. Let pending changes sync before quitting; reinstall the folder when needed.

If the release includes a signed and notarized `Clockoli-X.Y.Z-safari.zip`, move `Clockoli.app` to Applications, open it, and enable Clockoli in **Safari Settings → Extensions** for an installation that persists. The `-safari-unsigned.zip` app is not notarized and may be blocked on other Macs.

## Install from source (Chromium)

To try a development checkout:

```bash
git clone https://github.com/clockoli/clockoli.git
cd clockoli
```

1. Open `chrome://extensions` and enable **Developer mode**.
2. Select **Load unpacked** and choose the directory containing `manifest.json`.

To load a release ZIP unpacked, extract it first and select the extracted directory, not the ZIP.

## Update or move an installation

Unpacked and manually installed extensions do not update automatically. Update their files, select **Reload** in `chrome://extensions` for unpacked Chromium builds, and refresh open GitHub tabs.

Before switching browsers, browser profiles, or installations, stop the timer, let pending changes sync, and [export your settings](settings.md#backup--restore). Credentials and local state are not transferred automatically.

For contributor setup, tests, and release packaging, see [CONTRIBUTING.md](../CONTRIBUTING.md).

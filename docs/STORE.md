# Chrome Web Store submission

Text for the developer dashboard. Keep it in sync with `manifest.json`.

## Single purpose

StemDial removes or isolates the vocal in audio playing in one Chrome tab, on the user's device, and can transpose the result.

## Permission justification

- `activeTab`: gives the popup temporary access to the tab the user is looking at, so capture starts on that tab and no other. It is not used to read page content.
- `tabCapture`: records the audio of the tab the user explicitly starts. Capture runs only while **Start on this tab** is active and stops with **Stop and restore audio**.
- `offscreen`: the audio graph and the local separation model run in an offscreen document, which is required because service workers cannot hold Web Audio and WebGPU work. It exists only during a session.
- `storage`: stores the chosen mix and the measured audio delay locally. No data leaves the browser.
- Host permissions: none.

## Remote code

None. All JavaScript, the ONNX model, and the ONNX Runtime WASM binaries ship in the package. `wasm-unsafe-eval` in the extension CSP is required to instantiate the bundled ONNX Runtime WASM build; no remote script is evaluated. The extension makes no network requests while playing.

## Data usage

- Does the extension collect user data? No.
- Audio is processed in memory and discarded after playback. Nothing is recorded or uploaded.
- Settings and the measured delay stay in `chrome.storage.local` and `chrome.storage.session`.
- No analytics, telemetry, ads, or third-party services.
- Data is not sold or transferred to anyone.

## Privacy policy URL

https://github.com/bintangf/stemdial/blob/develop/PRIVACY.md

## Description attribution

The vocal separator is the KUIELab MDX-Net model, used under CC BY 4.0. Provenance, hashes, and licence: `docs/ASSETS.md`.

## Reviewer test path

1. Load the extension unpacked, open a tab with music, open StemDial, press **Start on this tab**.
2. Switch Instrumental, Vocal focus, and Full mix; change transpose; close and reopen the popup.
3. Press **Stop and restore audio** and confirm the original audio returns.

Requires Chrome 116 or newer. With WebGPU the separator runs; without it the extension falls back to a stereo filter, so it still works. The first start loads the bundled model and takes a few seconds.

## Before submitting

- [ ] Upload `docs/store/social-preview.png` (1280x640) in repository Settings, General, Social preview. GitHub shows the owner avatar on the repo page itself; a repo cannot carry its own avatar unless it belongs to an organization.
- [x] Icons: 16/32/48/128 PNG in `src/icons/`, declared in `manifest.json`; source SVGs in `tools/icons/`.
- [x] Screenshot: `docs/store/screenshot-1.png`, 1280x800, popup on a playing tab.
- [ ] Confirm the privacy policy URL is public.
- [ ] Confirm `docs/ASSETS.md` and `src/separator/ort/LICENSE` are in the zip.
- [ ] Test on a clean Chrome profile with no other extensions.

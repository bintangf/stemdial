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

https://bintangf.github.io/stemdial/privacy.html

The repository copy is also public: https://github.com/bintangf/stemdial/blob/develop/PRIVACY.md

## Store listing

Short description (132 characters max):

```
Remove or isolate the vocal in any Chrome tab. On-device AI, no upload, no account.
```

Detailed description:

```
StemDial removes or isolates the vocal in audio playing in a Chrome tab, on your device.

Play a song, open StemDial, press Start on this tab, and the singer drops away while the video keeps playing. Switch to Vocal focus to keep the voice and reduce the backing, or Full mix to leave the audio untouched and transpose only.

- Instrumental, Vocal focus, and Full mix, with separate reduction levels in 5% steps.
- Transpose from -12 to +12 semitones without changing tempo.
- The audio delay follows the measured GPU speed and is shown in the popup.
- A slice the GPU cannot finish plays the original mix, and the separator rejoins at the current position.
- Falls back to a stereo filter when WebGPU is missing or too slow, without stopping playback.

The separation model is bundled and runs on your GPU. No account, no upload, no subscription. Audio stays in the browser.

Requires Chrome 116 or newer on desktop with WebGPU. Without WebGPU the stereo filter is used.
```

- Category: Tools
- Language: English (United States)
- Package: `stemdial-0.6.2.zip` from https://github.com/bintangf/stemdial/releases/tag/v0.6.2

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
- [x] Privacy policy URL is public: HTTP 200 on Pages and on GitHub.
- [x] `docs/ASSETS.md`, `src/separator/ort/LICENSE`, `PRIVACY.md`, and the icons are in `stemdial-0.6.2.zip`.
- [ ] Test on a clean Chrome profile with no other extensions.
- [ ] In the developer dashboard, complete the privacy practices form, the single purpose field, both permission justifications, the remote code declaration, the data usage answers, and the trader status.

## Still manual

- The social preview upload and the clean-profile test need a browser session.
- The Chrome Web Store item must be created by hand before the API can upload. The first upload cannot be automated.
- Developer account registration and the one-time fee are outside this repository.

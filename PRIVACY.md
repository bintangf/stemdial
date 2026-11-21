# StemDial Privacy Policy

Last updated: 2026-11-21

StemDial is an extension for Chromium-based browsers that removes or isolates the vocal in audio playing in a browser tab. All processing runs on your device.

## What StemDial handles

- Audio from the tab you choose, and only after you press **Start on this tab**.
- Your mix settings: mode, reduction level, transpose, and the measured audio delay.

## What StemDial does not do

- It does not record, save, upload, or transmit audio.
- It does not send audio, settings, or usage data to any server.
- It has no accounts, analytics, telemetry, ads, or tracking.
- It does not read page content, form data, passwords, or browsing history.

## Where processing happens

Chrome's tab capture API feeds the chosen tab's audio into an offscreen document, where a bundled vocal separation model runs through WebGPU and Web Audio, and the result is played back in the same tab. The model and ONNX Runtime are packaged inside the extension; nothing is downloaded at runtime.

## What is stored

`chrome.storage.local` and `chrome.storage.session` hold only:

- the current mix (mode, reduction levels, semitones),
- the measured audio delay for your machine,
- the last engine status shown in the popup.

This stays in your browser profile. Removing the extension deletes it.

## Permissions

- `tabCapture`: capture audio from the tab you start, only after your click.
- `activeTab`: limit that access to the tab you are looking at.
- `offscreen`: run the audio graph and the local model in a hidden document while a session is active.
- `storage`: remember your mix and the measured delay.

StemDial requests no host permissions and does not access websites on its own.

## Third-party components

- Vocal separation model: KUIELab MDX-Net weights, CC BY 4.0. Attribution and provenance: [docs/ASSETS.md](docs/ASSETS.md).
- ONNX Runtime Web 1.23.2, MIT. Licence text: `src/separator/ort/LICENSE`.

Both are bundled with the extension. No third-party script is loaded from the network.

## Changes

Material changes to this policy are published in this file and recorded in the repository history.

## Contact

Open an issue at https://github.com/bintangf/stemdial/issues.

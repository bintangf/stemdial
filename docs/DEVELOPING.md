# Developing StemDial

Developer notes. The user-facing documentation is [README.md](../README.md).

## Layout

Top level is for people, subfolders for the build: `src/` runs, `tests/` checks, `tools/` measures, `docs/` explains. Paths stay within three levels.

| Path | What it is |
| --- | --- |
| `manifest.json` | MV3 entry. Points at `src/background/service-worker.js` and `src/popup/popup.html`. |
| `src/popup/` | The only control surface. Starts, stops, and adjusts the live mix. |
| `src/icons/` | Toolbar and store icons (16/32/48/128 PNG). Source SVGs in `tools/icons/`. |
| `src/background/service-worker.js` | Composition root. Wires the modules below to `chrome` and registers the message listeners. |
| `src/background/panel.mjs` | Popup protocol: serializes edits, answers status outside the queue, maps ops to the session. |
| `src/background/session.mjs` | Capture lifecycle: start, switch tab, stop, and restore the badge and status. |
| `src/background/mix.mjs` | Mix model: defaults, mode normalization, edit validation, reduction keys, settings access. |
| `src/background/engine-status.mjs` | Engine status store: in-memory, persisted to session storage, broadcast to the popup. |
| `src/background/audio-port.mjs` | The only module that talks to the offscreen document. |
| `src/background/badge.mjs` | Toolbar badge and title. |
| `src/offscreen/` | Offscreen document that holds the captured stream and picks the engine. |
| `src/offscreen/monitor.mjs` | Delayed dry signal and its crossfade to the separator output. |
| `src/separator/engine.mjs` | AI separator: capability check, worker, worklet graph, pitch stage, fallback signalling. |
| `src/separator/capabilities.mjs` | Sample-rate and WebGPU checks before a worker starts. |
| `src/separator/inference.worker.mjs` | Pair scheduler, STFT/ISTFT, stem mixing. |
| `src/separator/model.mjs` | ONNX Runtime session, warm-up, and one inference call. |
| `src/separator/history.mjs` | Ring buffer of complex frames in model layout. |
| `src/separator/gate.mjs` | Slow-GPU gate over the rolling p95. |
| `src/separator/separator.worklet.mjs` | Chunking, delay line, crossfade, and the stem/original blend. |
| `src/separator/pitch.worklet.mjs` | Pitch shifter on the separator output. |
| `src/separator/dsp.mjs` | FFT and STFT/ISTFT geometry fixed by the model. |
| `src/separator/timing.mjs` | Chunk size, buffer bounds, and the inference gate. |
| `src/separator/model/vocals.onnx` | Bundled fp16 model. |
| `src/separator/ort/` | Pinned ONNX Runtime Web build. |
| `src/fallback/` | Stereo-fallback engine, FFT centre worklet, radix-2 FFT, and pitch, used when WebGPU is unavailable or too slow. |
| `src/fallback/center.worklet.mjs` | Per-bin mid/side centre extractor for Instrumental and Vocal focus. |
| `src/fallback/fft.mjs` | Radix-2 FFT used by the fallback centre. |
| `src/fallback/pitch.worklet.mjs` | Fallback pitch processor. |
| `src/fallback/pitch.mjs` | Two-tap pitch shifter, used by both engines. |
| `tests/` | Signal-path and worker-protocol tests. |
| `tools/` | GPU harness, its Playwright drivers, and the model rebuild script. |
| `docs/` | This guide and the model/asset provenance. |

No build step. Chrome loads the source directly.

The background and offscreen modules take their `chrome` and audio ports as arguments; `service-worker.js` and `offscreen.js` are the only files that touch those globals at load time. Tests drive the same modules with fakes, so no browser is needed for protocol or signal-path checks.

## Model

`src/separator/model/vocals.onnx` is Kuielab MDX-Net, fp16, 14.9 MB. The model takes `[1, 4, 2048, 32]` complex spectrogram frames at 44.1 kHz with fft 5120 and hop 1024, and returns the vocal spectrogram. Instrumental is the delayed source minus the vocal. The time axis was shortened from the original 512 frames by `tools/shorten_mdx.py`, which rebuilds the file and checks that every node and weight is unchanged. See [ASSETS.md](ASSETS.md) for the source, SHA-256, and CC BY 4.0 licence.

The Zenodo record for these weights is CC BY 4.0, and the fp32 hash matches the bundled checkpoint.

## Engine budget

One inference covers two 93 ms chunks. `src/separator/timing.mjs` picks the buffer from the warm-up measurement: `3 + (pairMs + 20) / 93` chunks, clamped to 4..6, and the worklet receives it through `processorOptions`. The three chunks are the pair itself plus the analysis lookahead; the rest is inference slack. On the reference Mac that is 372 ms; a slow GPU gets 464 or 557 ms instead of missed slices. `src/separator/engine.mjs` reports the chosen value, `src/offscreen/offscreen.js` forwards it once a second, and the popup appends it to `Local AI active`.

`src/separator/inference.worker.mjs` gates on the p95 of the last timings. The limit is `MAX_INFERENCE_MS` (about 265 ms), which is the most the longest buffer can absorb; above it the worker reports a fallback and `src/offscreen/offscreen.js` swaps to the stereo filter without stopping the stream, unless the engine policy is AI only, in which case it plays the original mix and reports a warning.

The chosen delay is stored as `sepDelay`. The next session starts its monitor at that value so the first sound plays immediately. Once the separator reports its own buffer, `monitor.retune` ramps the dry path to the measured delay before the handover, so a faster session can shrink the delay again instead of inheriting the slowest past run.

Playback never waits for the GPU. A slice with no result plays the dry signal, so a late pair produces a momentary vocal instead of a pause or a growing offset. A pair below -60 dBFS is treated as silence and plays the dry signal too, and the vocal prediction is scaled down to the mixture's magnitude wherever it overshoots, so the model noise floor cannot add hiss during quiet passages either. `src/separator/separator.worklet.mjs` keeps the dry and wet paths on the same sample clock; `tests/separator-playout.test.mjs` checks that a missing pair does not shift later samples.

While the first result is still pending, `src/offscreen/offscreen.js` plays a delayed copy of the tab audio and fades to the separator output when it starts.

When changing the pipeline, re-run the harness on a slow machine, not only on a fast one. Falling under the gate on an idle Mac is not proof.

## Test

```bash
node --test tests/*.test.mjs
```

Signal path only: Modulated tone round-trips, stereo filtering, worker protocol. Separation quality needs a real song.

Harness, with `tools/serve.mjs` running on port 8125:

```bash
CHROME="/path/to/chrome" PLAYWRIGHT="$HOME/.npm/_npx/9b9809298fe40d2c/node_modules/playwright-core" node tools/measure.mjs
```

It writes `tools/measurement.json` with inference percentiles, latency, and band levels for an instrumental/vocal two-tone check.

Reference numbers on an Apple Silicon MacBook Air with the fp16 model: p50 59 ms, max 67 ms over 62 pairs, measured delay 372 ms, no missed slices. Two-tone fixture: instrumental keeps 3000 Hz at +22.4 dB while 800 Hz drops to +15.3 dB, vocal keeps 800 Hz at +9.8 dB while 3000 Hz lands at -2.4 dB, 24.7 dB below the instrumental.

Music probe (a real pop mix, voice-band RMS on the vocal stem): instrumental intro -19.6 dB, verse -5.4 dB, chorus -3.4 dB. These are level readings, not an isolation score. Run it with `SONG=/path/to/audio node tools/music.mjs` while the harness server is up.

Manual check: play a stereo track, start StemDial, switch all three modes, change pitch, close and reopen the popup, then stop and confirm the original audio returns. One tab is processed at a time.

## Package

```bash
mkdir -p dist
git archive --prefix=stemdial/ --format=zip -o dist/stemdial-$(node -p "require('./manifest.json').version").zip HEAD
```

## Release

`.github/workflows/release.yml` runs on tags that start with `v`:

1. Runs the test suite and stops if the tag and `manifest.json` version differ.
2. Builds `dist/stemdial-<version>.zip` with a top-level `stemdial` folder and attaches it to the GitHub release.
3. Uploads and publishes to the Chrome Web Store when the store settings exist.

A tag like `v0.6.1` is a stable release. A tag with a suffix, such as `v0.6.1-beta.1`, is accepted only when the prefix matches the manifest version; it produces a GitHub pre-release, and the store step is skipped.

```bash
git tag v0.6.1 && git push origin v0.6.1
git tag v0.6.1-beta.1 && git push origin v0.6.1-beta.1
```

Store automation reads two repository variables, `CWS_EXTENSION_ID` and `CWS_PUBLISHER_ID`, and three secrets, `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`. Create them from a Chrome Web Store developer account with the API enabled; see the [Chrome Web Store API guide](https://developer.chrome.com/docs/webstore/using-api). Without them, the release step still runs and the store step is skipped. The first store upload must be done by hand in the developer dashboard; the API cannot create items.

Chrome installs extensions from a folder or from the Web Store. Self-signed `.crx` files are rejected unless an enterprise policy allows them, which is why the release asset is a zip.

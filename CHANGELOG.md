# Changelog

## Unreleased

- A pair under -60 dBFS plays the dry signal, so the separator no longer adds hiss when the tab is silent.
- The vocal prediction is capped by the mixture's magnitude in each bin, so the model's noise floor cannot add hiss during quiet passages that are not fully silent.
- The warm-up ignores the first two runs, and the monitor retunes to the delay this session measured, so a slow past run no longer pins every later session at a longer delay.
- The stereo fallback estimates the centre per frequency bin with an FFT, so Vocal focus rejects panned and wide backing much more strongly. Its compressor is gone, and it uses the same soft limiter as the AI path.
- A warning banner shows whenever the AI is not the active engine. The gear menu selects AI with stereo fallback, AI only, or stereo only; changing it restarts a running session automatically.
- Starting a new session no longer closes the new dry monitor, so AI output cannot stay at zero gain after a restart.

## 0.6.2 (2026-11-21)

- Extension icons at 16, 32, 48, and 128 px.
- Privacy policy at `PRIVACY.md` and on the project site.
- Chrome Web Store submission guide with permission justifications.
- GitHub Pages site with install steps and the privacy policy.

## 0.6.1 (2026-11-19)

- Vocal separation runs on the GPU from a bundled model. Instrumental removes the singer; Vocal focus keeps the voice and reduces the backing.
- Full mix leaves the tab untouched and applies transpose only.
- Instrumental and Vocal focus each keep their own reduction level, set in 5% steps with - and +.
- Transpose covers -12 to +12 semitones, with a slider and single-semitone buttons.
- The audio delay follows the machine's measured GPU speed, and the popup shows the value next to the engine status.
- A slice the GPU cannot finish in time plays the original mix, and the separator rejoins at the current position in the song.
- StemDial switches to the stereo filter when WebGPU is missing or too slow, without stopping playback.
- The popup controls one tab at a time, and Stop restores the original mix.
- Audio stays in the browser.
- The vocal model is used under CC BY 4.0; provenance and hashes are in `docs/ASSETS.md`.

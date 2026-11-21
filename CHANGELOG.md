# Changelog

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

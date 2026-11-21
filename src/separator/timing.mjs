export const RATE = 44100;
// The worklet hands the worker one STFT hop at a time.
export const BLOCK = 1024;
// Audio past a region that must arrive before it is separated. Full overlap-add
// needs N - HOP (4096); on MUSDB, 2048 costs about 0.1 dB instrumental SDR.
export const LOOKAHEAD = 2048;
// The worklet fades to the dry signal this many samples before a missing block.
export const FADE = 256;
export const MAX_DELAY_MS = 300;
export const MAX_DELAY = Math.floor(MAX_DELAY_MS * RATE / 1000);
export const MIN_FRAMES = 4;
export const MAX_FRAMES = 8;
const QUANTUM = 128;

const toMs = samples => samples / RATE * 1000;

// One inference separates `frames` hops. The region must outlast the inference,
// and region + lookahead + inference must fit the delay cap. Returns null when
// the GPU cannot meet the cap.
export function planFor(inferMs) {
  const slackMs = inferMs * 1.2 + 12;
  for (let frames = MIN_FRAMES; frames <= MAX_FRAMES; frames++) {
    const region = frames * BLOCK;
    if (slackMs > toMs(region) * 0.95) continue;
    const need = region + LOOKAHEAD + FADE + Math.ceil(slackMs * RATE / 1000);
    const delay = Math.ceil(need / QUANTUM) * QUANTUM;
    if (delay > MAX_DELAY) return null;
    const gateMs = Math.min(toMs(region) * 0.95, toMs(delay - region - LOOKAHEAD - FADE));
    return {frames, delay, gateMs};
  }
  return null;
}

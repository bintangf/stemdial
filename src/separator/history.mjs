import {BINS} from './dsp.mjs';

// Keeps the last N complex frames in model layout, oldest first when read.
export function createHistory(frames) {
  const data = new Float32Array(4 * BINS * frames);
  let count = 0;
  let pos = 0;
  return {
    reset() { count = 0; pos = 0; },
    push(frame) {
      data.set(frame, pos * 4 * BINS);
      pos = (pos + 1) % frames;
      if (count < frames) count++;
    },
    snapshot() {
      const input = new Float32Array(4 * BINS * frames);
      const pad = frames - count;
      const oldest = pos - count + frames * 2;
      for (let j = pad; j < frames; j++) {
        const src = ((oldest + j - pad) % frames) * 4 * BINS;
        for (let ch = 0; ch < 4; ch++) {
          const base = ch * BINS * frames + j;
          for (let bin = 0; bin < BINS; bin++) input[base + bin * frames] = data[src + ch * BINS + bin];
        }
      }
      return input;
    },
  };
}

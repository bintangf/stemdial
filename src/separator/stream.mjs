import {N, HOP, BINS, WINDOW, createFFT, istftFrame, mixGain} from './dsp.mjs';
import {BLOCK, LOOKAHEAD} from './timing.mjs';
import {createHistory} from './history.mjs';
import {isSilentPair} from './silence.mjs';

const RING = 1 << 16;
const MASK = RING - 1;
// Frames computed for a region start up to N - HOP samples before it.
const HEAD = N - HOP;
// This checkpoint predicts the vocal stem about 7 dB under the source level.
const VOCAL_GAIN = 2.3;

// Turns captured blocks into separated regions of `frames` hops. A region is
// separated once LOOKAHEAD samples past it have arrived; frames that would
// need more audio are left out of its overlap-add and normalised away.
export function createStream({frames, historyFrames, infer, post, onStep = () => false}) {
  const region = frames * BLOCK;
  const fft = createFFT();
  const history = createHistory(historyFrames);
  const ringL = new Float32Array(RING), ringR = new Float32Array(RING);
  const accL = new Float32Array(HEAD + region + N), accR = new Float32Array(HEAD + region + N);
  const wsum = new Float32Array(HEAD + region + N);
  const frame = new Float32Array(4 * BINS);
  const re = new Float64Array(N), im = new Float64Array(N);
  const spec = [0, 1, 2, 3].map(() => new Float32Array(BINS));
  let start = 0, end = 0, nextFrame = 0, expected = null, busy = false, generation = 0;

  function restart(at) {
    generation++;
    history.reset();
    accL.fill(0); accR.fill(0); wsum.fill(0);
    start = end = at;
    nextFrame = at / HOP;
  }

  function analyze(g) {
    for (let ch = 0; ch < 2; ch++) {
      const ring = ch ? ringR : ringL;
      for (let i = 0; i < N; i++) re[i] = ring[(g * HOP + i) & MASK] * WINDOW[i];
      im.fill(0);
      fft.forward(re, im);
      const base = ch * 2 * BINS;
      frame.set(re.subarray(0, BINS), base);
      frame.set(im.subarray(0, BINS), base + BINS);
      // Reference inference zeroes the three lowest bins before the model.
      frame.fill(0, base, base + 3);
      frame.fill(0, base + BINS, base + BINS + 3);
    }
    history.push(frame);
  }

  // The vocal estimate is capped at the mixture magnitude in every bin.
  function synthesize(input, output, column, g) {
    const plane = BINS * historyFrames;
    for (let bin = 0; bin < BINS; bin++) {
      const p = bin * historyFrames + column;
      for (let ch = 0; ch < 2; ch++) {
        const re = ch * 2 * plane + p, im = re + plane;
        const gain = 1.025 * mixGain(output[re], output[im], input[re], input[im]);
        spec[2 * ch][bin] = output[re] * gain;
        spec[2 * ch + 1][bin] = output[im] * gain;
      }
    }
    istftFrame(fft, spec[0], spec[1], spec[2], spec[3], 0, accL, accR, wsum, HEAD + g * HOP - start);
  }

  function advance() {
    for (const a of [accL, accR, wsum]) {
      a.copyWithin(0, region);
      a.fill(0, a.length - region);
    }
    start += region;
  }

  async function step(skip) {
    const started = performance.now();
    const index = start / BLOCK;
    const first = nextFrame;
    while (nextFrame * HOP + N <= start + region + LOOKAHEAD) analyze(nextFrame++);
    const last = nextFrame - 1;
    if (skip) {
      post({type: 'skip', index, blocks: frames});
      advance();
      return;
    }
    const origL = new Float32Array(region), origR = new Float32Array(region);
    for (let i = 0; i < region; i++) {
      origL[i] = ringL[(start + i) & MASK];
      origR[i] = ringR[(start + i) & MASK];
    }
    const silent = isSilentPair(origL, origR);
    const run = generation;
    const t0 = performance.now();
    const input = history.snapshot();
    const output = await infer(input);
    const ms = performance.now() - t0;
    if (run !== generation) return;

    // A silent region keeps the clock and history but adds no model noise floor.
    if (!silent) for (let g = first; g <= last; g++) synthesize(input, output, historyFrames - 1 - (last - g), g);
    const vocalL = new Float32Array(region), vocalR = new Float32Array(region);
    const instL = new Float32Array(region), instR = new Float32Array(region);
    for (let i = 0; i < region && !silent; i++) {
      const k = HEAD + i;
      const w = wsum[k] > 1e-6 ? 1 / wsum[k] : 0;
      const vl = accL[k] * w, vr = accR[k] * w;
      instL[i] = origL[i] - vl; instR[i] = origR[i] - vr;
      vocalL[i] = vl * VOCAL_GAIN; vocalR[i] = vr * VOCAL_GAIN;
    }
    const queue = Math.max(0, Math.floor((end - start - region - LOOKAHEAD) / BLOCK));
    advance();
    // The whole step, DSP included, must land within the delay's slack.
    const gate = onStep(performance.now() - started);
    post({type: 'region', index, ms, queue, gate, silent, vocalL, vocalR, instL, instR},
      [vocalL.buffer, vocalR.buffer, instL.buffer, instR.buffer]);
  }

  async function pump() {
    if (busy) return;
    busy = true;
    try {
      while (end >= start + region + LOOKAHEAD) {
        // A whole extra region is waiting: drop this one to catch up, but keep its frames in the history.
        await step(end >= start + 2 * region + LOOKAHEAD);
      }
    } catch (error) {
      post({type: 'skip', index: start / BLOCK, blocks: frames});
      restart(end);
      throw error;
    } finally {
      busy = false;
    }
  }

  return {
    push(index, l, r) {
      const at = index * BLOCK;
      if (index !== expected || at - start > RING / 2) restart(at);
      expected = index + 1;
      for (let i = 0; i < BLOCK; i++) {
        ringL[(at + i) & MASK] = l[i];
        ringR[(at + i) & MASK] = r[i];
      }
      end = at + BLOCK;
      return pump();
    },
  };
}

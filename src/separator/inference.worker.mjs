import {SAMPLE_RATE, N, HOP, BINS, WINDOW, createFFT, istftFrame, mixGain} from './dsp.mjs';
import {CHUNK, MAX_INFERENCE_MS} from './timing.mjs';
import {loadModel} from './model.mjs';
import {createHistory} from './history.mjs';
import {createGate} from './gate.mjs';
import {isSilentPair} from './silence.mjs';

const PAIR = CHUNK * 2;
const FRAMES = PAIR / HOP;
const LOOKAHEAD = N - HOP;
const QUEUE_MAX = 4; // chunks; one inference consumes two
const BUDGET = PAIR / SAMPLE_RATE * 1000;
const DEBUG = false; // log reconstruction levels
const IDENTITY = false;

const post = (msg, transfer) => self.postMessage(msg, transfer || []);
const status = (state, message) => post({type: 'status', state, message});
const gate = createGate({
  limit: MAX_INFERENCE_MS,
  onSlow: p95 => status('fallback', `Slow GPU: ${Math.round(p95)} ms per ${Math.round(BUDGET)} ms of audio, over the ${Math.round(MAX_INFERENCE_MS)} ms the longest buffer allows`),
});

let model, history, fft = createFFT(), busy = false;
let queue = [];
let prevL = new Float32Array(N), prevR = new Float32Array(N);
let carryL = new Float32Array(N), carryR = new Float32Array(N), carryW = new Float32Array(N);
let needReset = false;
const frameBuf = new Float32Array(FRAMES * 4 * BINS);

function reset() {
  prevL.fill(0); prevR.fill(0);
  history?.reset();
  carryL.fill(0); carryR.fill(0); carryW.fill(0);
  needReset = false;
}

async function init(modelUrl) {
  model = await loadModel(modelUrl, {frames: FRAMES, onStatus: status});
  history = createHistory(model.frames);
  post({type: 'ready', initMs: model.initMs, pairMs: model.pairMs});
}

const ana = [new Float64Array(N), new Float64Array(N), new Float64Array(N), new Float64Array(N)];
function analyzeFrame(srcL, srcR, offset, dst) {
  for (let ch = 0; ch < 2; ch++) {
    const [re, im] = [ana[ch * 2], ana[ch * 2 + 1]];
    const src = ch ? srcR : srcL;
    for (let i = 0; i < N; i++) re[i] = src[offset + i] * WINDOW[i];
    im.fill(0);
    fft.forward(re, im);
    frameBuf.set(re.subarray(0, BINS), dst + ch * 2 * BINS);
    frameBuf.set(im.subarray(0, BINS), dst + ch * 2 * BINS + BINS);
  }
}

function rebuildStem(out, accL, accR, wsum) {
  const outL = new Float32Array(BINS), outIL = new Float32Array(BINS);
  const outR = new Float32Array(BINS), outIR = new Float32Array(BINS);
  for (let f = 0; f < FRAMES; f++) {
    const t = model.frames - FRAMES + f;
    const src = f * 4 * BINS;
    for (let bin = 0; bin < BINS; bin++) {
      const p = bin * model.frames + t;
      const l = mixGain(out[p], out[BINS * model.frames + p], frameBuf[src + bin], frameBuf[src + BINS + bin]);
      const r = mixGain(out[2 * BINS * model.frames + p], out[3 * BINS * model.frames + p],
        frameBuf[src + 2 * BINS + bin], frameBuf[src + 3 * BINS + bin]);
      outL[bin] = out[p] * 1.025 * l; outIL[bin] = out[BINS * model.frames + p] * 1.025 * l;
      outR[bin] = out[2 * BINS * model.frames + p] * 1.025 * r;
      outIR[bin] = out[3 * BINS * model.frames + p] * 1.025 * r;
    }
    istftFrame(fft, outL, outIL, outR, outIR, 0, accL, accR, wsum, f * HOP);
  }
}

// Identity path, kept for reconstruction debugging with IDENTITY.
function rebuildInput(accL, accR, wsum) {
  for (let f = 0; f < FRAMES; f++) {
    const src = f * 4 * BINS;
    const outL = frameBuf.slice(src, src + BINS);
    const outIL = frameBuf.slice(src + BINS, src + 2 * BINS);
    const outR = frameBuf.slice(src + 2 * BINS, src + 3 * BINS);
    const outIR = frameBuf.slice(src + 3 * BINS, src + 4 * BINS);
    istftFrame(fft, outL, outIL, outR, outIR, 0, accL, accR, wsum, f * HOP);
  }
}

async function processPair(a, b) {
  const next = queue[0]; // lookahead chunk
  const silent = isSilentPair(a.l, a.r, b.l, b.r);
  if (needReset) reset();

  const workL = new Float32Array(N + PAIR + N);
  const workR = new Float32Array(N + PAIR + N);
  workL.set(prevL); workR.set(prevR);
  workL.set(a.l, N); workR.set(a.r, N);
  workL.set(b.l, N + CHUNK); workR.set(b.r, N + CHUNK);
  const ahead = next ? Math.min(LOOKAHEAD, next.l.length) : 0;
  if (ahead) {
    workL.set(next.l.subarray(0, ahead), N + PAIR);
    workR.set(next.r.subarray(0, ahead), N + PAIR);
  }

  const accL = new Float32Array(PAIR + N), accR = new Float32Array(PAIR + N), wsum = new Float32Array(PAIR + N);
  accL.set(carryL); accR.set(carryR); wsum.set(carryW);
  const origL = workL.slice(N, N + PAIR), origR = workR.slice(N, N + PAIR);

  for (let t = 0; t < FRAMES; t++) analyzeFrame(workL, workR, N + t * HOP, t * 4 * BINS);
  // Reference inference zeroes the three lowest bins before the model.
  for (let t = 0; t < FRAMES; t++) {
    for (let ch = 0; ch < 4; ch++) for (let bin = 0; bin < 3; bin++) frameBuf[t * 4 * BINS + ch * BINS + bin] = 0;
  }

  // Raw spectra: the checkpoint collapses when the input is level-normalised.
  for (let t = 0; t < FRAMES; t++) history.push(frameBuf.subarray(t * 4 * BINS, (t + 1) * 4 * BINS));

  const t0 = performance.now();
  const out = await model.run(history.snapshot());
  const ms = performance.now() - t0;
  gate.push(ms);

  if (!silent && DEBUG && IDENTITY) rebuildInput(accL, accR, wsum);
  else if (!silent) rebuildStem(out, accL, accR, wsum);

  const vocalL = new Float32Array(PAIR), vocalR = new Float32Array(PAIR);
  const instL = new Float32Array(PAIR), instR = new Float32Array(PAIR);
  for (let i = 0; i < PAIR && !silent; i++) {
    const w = wsum[i] > 1e-6 ? 1 / wsum[i] : 0;
    const vl = accL[i] * w, vr = accR[i] * w;
    instL[i] = origL[i] - vl; instR[i] = origR[i] - vr;
    // This checkpoint predicts the vocal stem about 7 dB under the source level.
    const vg = 2.3;
    vocalL[i] = vl * vg; vocalR[i] = vr * vg;
  }
  if (DEBUG && !silent) {
    let ev = 0, es = 0;
    for (let i = 0; i < PAIR; i++) { ev += vocalL[i] * vocalL[i]; es += origL[i] * origL[i]; }
    console.log('stem rms', Math.sqrt(ev / PAIR).toFixed(4), 'src rms', Math.sqrt(es / PAIR).toFixed(4));
  }
  carryL = accL.slice(PAIR); carryR = accR.slice(PAIR); carryW = wsum.slice(PAIR);
  if (silent) {
    // Keep the clock and history, but drop the model noise floor.
    carryL.fill(0); carryR.fill(0); carryW.fill(0);
  }
  prevL = workL.slice(PAIR, N + PAIR); prevR = workR.slice(PAIR, N + PAIR);

  post({
    type: 'pair', index: a.index, ms, queue: queue.length, gate: gate.fired, silent,
    vocalL, vocalR, instL, instR,
  }, [vocalL.buffer, vocalR.buffer, instL.buffer, instR.buffer]);
}

async function pump() {
  if (busy || queue.length < 3) return;
  const a = queue.shift(), b = queue.shift();
  if (a.index + 1 !== b.index) {
    needReset = true;
    post({type: 'skip', index: a.index});
    queue.unshift(b);
    return pump();
  }
  busy = true;
  try {
    await processPair(a, b);
  } catch (error) {
    status('error', error.message);
    reset();
    post({type: 'skip', index: a.index});
    post({type: 'skip', index: b.index});
  } finally {
    busy = false;
    pump();
  }
}

self.onmessage = ({data: m}) => {
  if (m.type === 'init') {
    init(m.modelUrl).catch((error) => {
      status('error', error.message);
      post({type: 'failed', message: error.message});
    });
    return;
  }
  if (m.type !== 'chunk') return;
  if (queue.length && m.index !== queue[queue.length - 1].index + 1) needReset = true;
  queue.push({index: m.index, l: m.l, r: m.r});
  while (queue.length > QUEUE_MAX) {
    post({type: 'skip', index: queue.shift().index});
    needReset = true;
  }
  pump();
};

import assert from 'node:assert';
import {N, HOP, BINS, createFFT, stftInto, istftFrame} from '../src/separator/dsp.mjs';

const fft = createFFT();
const len = 20480 * 2 + N;
const srcL = new Float32Array(len), srcR = new Float32Array(len);
for (let i = 0; i < len; i++) {
  const t = i / 44100;
  srcL[i] = 0.3 * Math.sin(2 * Math.PI * 512 * t) + 0.2 * Math.sin(2 * Math.PI * 3100 * t);
  srcR[i] = 0.3 * Math.sin(2 * Math.PI * 777 * t) + 0.2 * Math.sin(2 * Math.PI * 5900 * t);
}

const frames = Math.floor((len - N) / HOP) + 1;
const accL = new Float64Array(len + N), accR = new Float64Array(len + N), wsum = new Float64Array(len + N);
const rL = new Float32Array(frames * BINS), iL = new Float32Array(frames * BINS);
const rR = new Float32Array(frames * BINS), iR = new Float32Array(frames * BINS);
for (let t = 0; t < frames; t++) stftInto(fft, srcL, srcR, t * HOP, rL, iL, rR, iR, t * BINS);
for (let t = 0; t < frames; t++) istftFrame(fft, rL, iL, rR, iR, t * BINS, accL, accR, wsum, t * HOP);

let max = 0, energy = 0;
for (let i = N; i < len - N; i++) {
  const el = accL[i] / wsum[i] - srcL[i];
  const er = accR[i] / wsum[i] - srcR[i];
  max = Math.max(max, Math.abs(el), Math.abs(er));
  energy += el * el + er * er;
}
const rms = Math.sqrt(energy / (2 * (len - 2 * N)));
assert.ok(max < 2e-5, `max round-trip error ${max}`);
assert.ok(rms < 5e-6, `rms round-trip error ${rms}`);
const peakWsum = wsum[N + 1000] / 1;
const expected = (N / HOP) * 0.375;
assert.ok(Math.abs(peakWsum - expected) < 1e-6, `window sum ${peakWsum} != ${expected}`);
console.log(`ok: max ${max.toExponential(2)} rms ${rms.toExponential(2)} frames ${frames}`);

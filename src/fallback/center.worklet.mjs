import {createFFT} from './fft.mjs';

const N = 1024;
const H = 256;
const BINS = N / 2 + 1;
const WINDOW = Float32Array.from({length: N}, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
const SCALE = 1 / 1.5;

class CenterProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {name: 'center', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate'},
    ];
  }

  constructor() {
    super();
    this.fft = createFFT(N);
    this.histL = new Float32Array(N); this.histR = new Float32Array(N);
    this.fillL = new Float32Array(H); this.fillR = new Float32Array(H);
    this.pendingL = new Float32Array(H); this.pendingR = new Float32Array(H);
    this.pending = 0;
    this.fill = 0; this.total = 0; this.histPos = 0;
    this.midPower = new Float64Array(BINS); this.sidePower = new Float64Array(BINS);
    this.cross = new Float64Array(BINS);
    this.smooth = 1 - Math.exp(-H / (0.025 * sampleRate));
    this.amount = 0;
    this.monoHold = Math.round(sampleRate * 0.3);
    this.identical = this.monoHold;
    this.mono = true;
    this.reL = new Float64Array(N); this.imL = new Float64Array(N);
    this.reR = new Float64Array(N); this.imR = new Float64Array(N);
    this.re = new Float64Array(N); this.im = new Float64Array(N);
    this.acc = new Float64Array(N); this.accPos = 0;
    this.mask = new Float32Array(BINS);
    for (let b = 0; b < BINS; b++) {
      const hz = b * sampleRate / N;
      let m = 1;
      if (hz < 130) m = 0;
      else if (hz < 180) m = (hz - 130) / 50;
      if (hz > 10000) m = 0;
      else if (hz > 9000) m = (10000 - hz) / 1000;
      this.mask[b] = m;
    }
    this.active = true;
    this.port.onmessage = ({data}) => { if (data === 'stop') this.active = false; };
  }

  soft(x) {
    const a = Math.abs(x);
    return a <= 0.95 ? x : Math.sign(x) * (0.95 + 0.05 * Math.tanh((a - 0.95) / 0.05));
  }

  frame(target) {
    this.amount += Math.max(-0.2, Math.min(0.2, (this.mono ? 0 : target) - this.amount));
    for (let i = 0; i < N; i++) {
      const p = (this.histPos + i) & (N - 1), w = WINDOW[i];
      this.reL[i] = this.histL[p] * w; this.imL[i] = 0;
      this.reR[i] = this.histR[p] * w; this.imR[i] = 0;
    }
    this.fft.forward(this.reL, this.imL);
    this.fft.forward(this.reR, this.imR);

    for (let b = 0; b < BINS; b++) {
      const mr = (this.reL[b] + this.reR[b]) * 0.5, mi = (this.imL[b] + this.imR[b]) * 0.5;
      const sr = (this.reL[b] - this.reR[b]) * 0.5, si = (this.imL[b] - this.imR[b]) * 0.5;
      const p = this.midPower[b] += this.smooth * (mr * mr + mi * mi - this.midPower[b]);
      const q = this.sidePower[b] += this.smooth * (sr * sr + si * si - this.sidePower[b]);
      const cross = this.cross[b] += this.smooth * ((mr * sr + mi * si) - this.cross[b]);
      const cancel = Math.max(-1, Math.min(1, cross / (q + 1e-18)));
      const dominance = Math.max(0, (p - q) / (p + q + 1e-18));
      const m = this.mask[b] * dominance;
      const cr = (mr - cancel * sr) * m, ci = (mi - cancel * si) * m;
      this.re[b] = cr; this.im[b] = ci;
      if (b > 0 && b < N / 2) {
        this.re[N - b] = cr; this.im[N - b] = -ci;
      }
    }
    this.im[0] = this.im[N / 2] = 0;
    this.fft.inverse(this.re, this.im);

    for (let i = 0; i < N; i++) this.acc[(this.accPos + i) & (N - 1)] += this.re[i] * WINDOW[i] * SCALE;

    const amount = this.amount, focus = Math.max(0, -amount);
    for (let i = 0; i < H; i++) {
      const p = (this.accPos + i) & (N - 1);
      const c = this.acc[p];
      const dryL = this.histL[(this.histPos + i) & (N - 1)];
      const dryR = this.histR[(this.histPos + i) & (N - 1)];
      let l, r;
      if (amount < 0) {
        l = dryL + focus * (c - dryL);
        r = dryR + focus * (c - dryR);
      } else {
        l = dryL - c * amount;
        r = dryR - c * amount;
      }
      this.pendingL[i] = this.soft(l);
      this.pendingR[i] = this.soft(r);
      this.acc[p] = 0;
    }
    this.accPos = (this.accPos + H) & (N - 1);
    this.pending = H;
  }

  process([input], [[outL, outR]], {center}) {
    if (!this.active) return false;
    const [l, r] = input;
    if (!l) return true;
    for (let i = 0; i < outL.length; i++) {
      if (this.pending > 0) {
        outL[i] = this.pendingL[H - this.pending];
        outR[i] = this.pendingR[H - this.pending];
        this.pending--;
      } else outL[i] = outR[i] = 0;

      const a = l[i], b = r ? r[i] : a;
      if (Math.abs(a - b) > 1e-7) this.identical = 0;
      else if (this.identical < this.monoHold) this.identical++;
      this.mono = this.identical >= this.monoHold;
      this.fillL[this.fill] = a;
      this.fillR[this.fill] = b;
      this.fill++;
      if (this.fill === H) {
        for (let k = 0; k < H; k++) {
          const p = (this.histPos + k) & (N - 1);
          this.histL[p] = this.fillL[k]; this.histR[p] = this.fillR[k];
        }
        this.histPos = (this.histPos + H) & (N - 1);
        this.total += H;
        this.fill = 0;
        if (this.total >= N) this.frame(center[0]);
      }
    }
    return true;
  }
}

registerProcessor('ruang-nada-center', CenterProcessor);

import {Pitch} from './pitch.mjs';
import {VocalFocus} from './vocal-focus.mjs';

class StereoPitch extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {name: 'semitones', defaultValue: 0, minValue: -12, maxValue: 12, automationRate: 'k-rate'},
      {name: 'center', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate'},
    ];
  }

  constructor() {
    super();
    this.left = new Pitch(sampleRate);
    this.right = new Pitch(sampleRate);
    this.voice = new VocalFocus(sampleRate);
    // A 125 Hz Butterworth low-pass keeps centered kick and bass in the return.
    const k = Math.tan(Math.PI * 125 / sampleRate);
    const norm = 1 / (1 + Math.SQRT2 * k + k * k);
    this.b0 = k * k * norm;
    this.a1 = 2 * (k * k - 1) * norm;
    this.a2 = (1 - Math.SQRT2 * k + k * k) * norm;
    this.z1 = this.z2 = 0;
    this.monoHold = Math.round(sampleRate * 0.3);
    this.identical = this.monoHold;
    this.stereoAmount = 0;
    this.slew = 1 - Math.exp(-1 / (sampleRate * 0.012));
    this.active = true;
    this.port.onmessage = ({data}) => { if (data === 'stop') this.active = false; };
  }

  process([input], [[outL, outR]], {semitones, center}) {
    if (!this.active) return false;
    const [left, right] = input;
    if (!left) return true;
    const shift = semitones[0];
    const ratio = 2 ** (shift / 12);
    // Fade between the delayed taps and the direct signal around unison.
    const mix = Math.min(1, Math.abs(shift) * 8);
    for (let i = 0; i < outL.length; i++) {
      const a = left[i], b = right ? right[i] : a;
      // Some captures deliver mono in a stereo container. Only bypass for a
      // sustained sample match, not merely a strongly centered stereo mix.
      if (Math.abs(a - b) > 1e-7) this.identical = 0;
      else if (this.identical < this.monoHold) this.identical++;
      const stereo = this.identical < this.monoHold ? 1 : 0;
      this.stereoAmount += this.slew * (stereo - this.stereoAmount);
      const mid = (a + b) * 0.5;
      const bass = this.b0 * mid + this.z1;
      this.z1 = 2 * this.b0 * mid - this.a1 * bass + this.z2;
      this.z2 = this.b0 * mid - this.a2 * bass;
      const amount = center[0] * this.stereoAmount;
      const midCut = Math.max(0, amount) * (mid - bass);
      const focus = Math.max(0, -amount);
      const vocal = focus ? this.voice.sample(mid-bass, (a-b)*.5) : 0;
      const l = a - midCut + focus * (vocal - a);
      const r = b - midCut + focus * (vocal - b);
      outL[i] = l + mix * (this.left.sample(l, ratio) - l);
      outR[i] = r + mix * (this.right.sample(r, ratio) - r);
    }
    return true;
  }
}

registerProcessor('ruang-nada-stereo-pitch', StereoPitch);

import {Pitch} from '../fallback/pitch.mjs';

class PitchProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.left = new Pitch(sampleRate);
    this.right = new Pitch(sampleRate);
    this.target = 0;
    this.current = 0;
    this.active = true;
    this.port.onmessage = ({data}) => {
      if (data === 'stop') this.active = false;
      else this.target = Math.max(-12, Math.min(12, Number(data) || 0));
    };
  }

  process([input], [[outL, outR]]) {
    if (!this.active) return false;
    const [l, r] = input;
    if (!l) return true;
    for (let i = 0; i < outL.length; i++) {
      this.current += Math.max(-1 / 256, Math.min(1 / 256, this.target - this.current));
      const shift = Math.abs(this.current) < 0.001 ? 0 : this.current;
      const ratio = 2 ** (shift / 12);
      const dry = shift ? Math.min(1, Math.abs(shift) * 8) : 0;
      const a = l[i], b = r ? r[i] : a;
      const ya = this.left.sample(a, ratio), yb = this.right.sample(b, ratio);
      outL[i] = a + dry * (ya - a);
      outR[i] = b + dry * (yb - b);
    }
    return true;
  }
}

registerProcessor('ruang-nada-pitch', PitchProcessor);

// Two overlapping delay taps shift pitch without changing the stream's duration.
export class Pitch {
  constructor(rate) {
    this.span = Math.round(rate * 0.05);
    this.buf = new Float32Array(this.span + 4);
    this.pos = 0;
    this.phase = 0;
  }
  tap(phase) {
    const n = this.buf.length;
    const p = (this.pos + n - 1 - phase * this.span) % n;
    const i = Math.floor(p);
    return this.buf[i] + (p - i) * (this.buf[(i + 1) % n] - this.buf[i]);
  }
  sample(x, ratio) {
    this.buf[this.pos] = x;
    let y = x;
    if (ratio !== 1) {
      const other = (this.phase + 0.5) % 1;
      const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * this.phase);
      y = w * this.tap(this.phase) + (1 - w) * this.tap(other);
      this.phase = (1 + this.phase + (1 - ratio) / this.span) % 1;
    }
    this.pos = (this.pos + 1) % this.buf.length;
    return y;
  }
}

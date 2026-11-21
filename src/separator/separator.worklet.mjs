import {CHUNK, MAX_DELAY, MIN_CHUNKS} from './timing.mjs';
const FADE = 256;
const DELAY_MASK = 32767;
const SLOTS = 8;

class SeparatorWorklet extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const chunks = Math.round((options?.processorOptions?.delay || MIN_CHUNKS * CHUNK) / CHUNK);
    this.delay = Math.min(MAX_DELAY, Math.max(MIN_CHUNKS * CHUNK, chunks * CHUNK));
    this.port.postMessage({type: 'stats', hello: true});
    this.inL = new Float32Array(CHUNK);
    this.inR = new Float32Array(CHUNK);
    this.inPos = 0;
    this.index = 0;
    this.total = 0;
    this.delayL = new Float32Array(DELAY_MASK + 1);
    this.delayR = new Float32Array(DELAY_MASK + 1);
    this.write = 0;
    this.slots = new Array(SLOTS).fill(null);
    this.readChunk = 0;
    this.readOff = 0;
    this.started = false;
    this.wet = 0;
    this.mix = 1;
    this.mixCur = 0;
    this.mode = 'instrumental';
    this.active = true;
    this.misses = 0;
    this.port.onmessage = ({data}) => {
      if (data.type === 'mix') this.mix = Math.max(0, Math.min(1, data.value));
      else if (data.type === 'mode') this.mode = data.value;
      else if (data.type === 'stop') this.active = false;
      else if (data.type === 'pair') this.receive(data);
    };
  }

  receive({index, vocalL, vocalR, instL, instR, queue, ms, gate, outMean, peak}) {
    if (!this.active) return;
    for (const i of [index, index + 1]) {
      if (i < this.readChunk) continue;
      this.slots[i % SLOTS] = {
        index: i, vocalL, vocalR, instL, instR,
        off: i === index ? 0 : CHUNK,
      };
    }
    this.port.postMessage({type: "stats", ms, queue, gate, outMean, peak});
  }

  soft(x) {
    const a = Math.abs(x);
    return a <= 0.95 ? x : Math.sign(x) * (0.95 + 0.05 * Math.tanh((a - 0.95) / 0.05));
  }

  process(inputs, outputs) {
    if (!this.active) return false;
    const [outL, outR] = outputs[0];
    try { this.run(inputs[0], outL, outR); }
    catch (e) { this.port.postMessage({type: 'stats', err: String(e && e.stack || e)}); }
    return true;
  }

  run(input, outL, outR) {
    const l = input[0], r = input[1] || input[0];
    if (!l) return true;
    const mixTarget = this.mix;
    const step = 1 / 256;

    for (let i = 0; i < outL.length; i++) {
      const a = l[i], b = r[i];
      this.inL[this.inPos] = a;
      this.inR[this.inPos] = b;
      this.delayL[this.write] = a;
      this.delayR[this.write] = b;
      this.write = (this.write + 1) & DELAY_MASK;
      this.total++;

      if (!this.started) {
        outL[i] = outR[i] = 0;
        if (this.total >= this.delay) {
          this.started = true;
          this.port.postMessage({type: 'stats', latency: this.delay / sampleRate * 1000});
        }
      } else {
        const slot = this.slots[this.readChunk % SLOTS];
        const ready = slot && slot.index === this.readChunk;
        const next = this.slots[(this.readChunk + 1) % SLOTS];
        const fadeOut = this.readOff >= CHUNK - FADE && next?.index !== this.readChunk + 1;
        const target = ready && !fadeOut ? 1 : 0;
        this.wet += Math.max(-1 / FADE, Math.min(1 / FADE, target - this.wet));
        this.mixCur += Math.max(-step, Math.min(step, mixTarget - this.mixCur));

        const read = (this.write - 1 - this.delay) & DELAY_MASK;
        const wet = this.wet * this.mixCur;
        let al = this.delayL[read], ar = this.delayR[read];
        if (ready && wet > 0) {
          const o = slot.off + this.readOff;
          const stemL = this.mode === 'vocal' ? slot.vocalL : slot.instL;
          const stemR = this.mode === 'vocal' ? slot.vocalR : slot.instR;
          al = al * (1 - wet) + stemL[o] * wet;
          ar = ar * (1 - wet) + stemR[o] * wet;
        }
        outL[i] = this.soft(al);
        outR[i] = this.soft(ar);

        if (this.readOff === 0 && !ready) this.misses++;
        if (++this.readOff === CHUNK) {
          this.slots[this.readChunk % SLOTS] = null;
          this.readChunk++;
          this.readOff = 0;
          this.port.postMessage({type:'stats', played:this.readChunk, misses:this.misses,
            latency:this.delay / sampleRate * 1000, mode:this.mode, wet:this.wet});
        }
      }

      if (++this.inPos === CHUNK) {
        const lcopy = this.inL.slice(), rcopy = this.inR.slice();
        const index = this.index++;
        this.port.postMessage({type: 'chunk', index, l: lcopy, r: rcopy},
          [lcopy.buffer, rcopy.buffer]);
        this.inPos = 0;
      }
    }
    return true;
  }
}

registerProcessor('ruang-nada-separator', SeparatorWorklet);

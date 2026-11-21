import assert from 'node:assert/strict';
import test from 'node:test';
import {CHUNK, MAX_DELAY, MAX_INFERENCE_MS, MIN_CHUNKS, delayChunks, delayFor} from '../src/separator/timing.mjs';

test('the buffer grows with measured inference time and stays bounded', () => {
  assert.equal(delayChunks(30), MIN_CHUNKS);
  assert.ok(delayChunks(60) >= MIN_CHUNKS);
  assert.ok(delayChunks(180) > delayChunks(60));
  assert.equal(delayChunks(5000), MAX_DELAY / CHUNK);
  assert.ok(delayFor(60) / 44100 < .45);
  assert.ok(MAX_INFERENCE_MS > 2 * CHUNK / 44100 * 1000, 'gate covers more than one pair');
});

test('playout stays on the same sample clock across a missing pair', async () => {
  const DELAY = delayFor(54);
  let Processor;
  globalThis.sampleRate = 44100;
  globalThis.AudioWorkletProcessor = class { port = {postMessage() {}}; };
  globalThis.registerProcessor = (_, p) => { Processor = p; };
  await import('../src/separator/separator.worklet.mjs');
  const p = new Processor({processorOptions: {delay: DELAY}});
  const source = i => .1 + (i % 137) / 1024;
  const stem = i => .4 + (i % 199) / 1024;
  for (let pos = 0; pos < DELAY + 10 * CHUNK; pos += 128) {
    if (pos % (2 * CHUNK) === 0 && pos !== 4 * CHUNK) {
      const data = Float32Array.from({length:2 * CHUNK}, (_, i) => stem(pos+i));
      p.receive({index:pos/CHUNK,vocalL:data,vocalR:data,instL:data,instR:data});
    }
    const out = new Float32Array(128);
    p.run([Float32Array.from(out, (_,i)=>source(pos+i))],out,new Float32Array(128));
    for (let i=0;i<128;i++) {
      const index = pos+i-DELAY;
      if (index<0) { assert.equal(out[i],0); continue; }
      if (index % CHUNK < 256 || index % CHUNK >= CHUNK-256) continue;
      const expected = index>=4*CHUNK && index<6*CHUNK ? source(index) : stem(index);
      assert.ok(Math.abs(out[i]-expected)<1e-6, `source frame ${index}`);
    }
  }
  assert.equal(p.misses,2);
  assert.ok(DELAY/44100 < .45);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {BLOCK, FADE, LOOKAHEAD, MAX_DELAY, MAX_DELAY_MS, MIN_FRAMES, RATE, planFor} from '../src/separator/timing.mjs';

test('the plan fits the delay cap and grows with measured inference time', () => {
  const fast = planFor(20), mac = planFor(60), slow = planFor(75);
  assert.equal(fast.frames, MIN_FRAMES);
  assert.equal(mac.frames, MIN_FRAMES);
  assert.ok(slow.frames > MIN_FRAMES, 'a slower GPU needs a longer region');
  for (const [ms, plan] of [[20, fast], [60, mac], [75, slow]]) {
    assert.ok(plan.delay <= MAX_DELAY);
    assert.ok(plan.delay >= plan.frames * BLOCK + LOOKAHEAD + FADE + ms * RATE / 1000);
    assert.ok(plan.gateMs >= ms && plan.gateMs < plan.frames * BLOCK / RATE * 1000);
  }
  assert.ok(fast.delay < mac.delay && mac.delay < slow.delay);
  assert.ok(mac.delay / RATE * 1000 < 240, `Mac-class GPU delay ${mac.delay}`);
  assert.equal(MAX_DELAY, Math.floor(MAX_DELAY_MS * RATE / 1000));
  assert.equal(planFor(90), null, 'too slow for the cap');
});

test('playout stays on the same sample clock across a missing region', async () => {
  const {delay: DELAY, frames} = planFor(54);
  const REGION = frames * BLOCK;
  let Processor;
  globalThis.sampleRate = RATE;
  globalThis.AudioWorkletProcessor = class { port = {postMessage() {}}; };
  globalThis.registerProcessor = (_, p) => { Processor = p; };
  await import('../src/separator/separator.worklet.mjs');
  const p = new Processor({processorOptions: {delay: DELAY}});
  assert.equal(p.delay, DELAY);
  const source = i => .1 + (i % 137) / 1024;
  const stem = i => .4 + (i % 199) / 1024;
  const missing = 2 * REGION;
  for (let pos = 0; pos < DELAY + 6 * REGION; pos += 128) {
    if (pos % REGION === 0 && pos !== missing) {
      const data = Float32Array.from({length: REGION}, (_, i) => stem(pos + i));
      p.receive({index: pos / BLOCK, vocalL: data, vocalR: data, instL: data, instR: data});
    }
    const out = new Float32Array(128);
    p.run([Float32Array.from(out, (_, i) => source(pos + i))], out, new Float32Array(128));
    for (let i = 0; i < 128; i++) {
      const index = pos + i - DELAY;
      if (index < 0) { assert.equal(out[i], 0); continue; }
      if (index % BLOCK < FADE || index % BLOCK >= BLOCK - FADE) continue;
      const expected = index >= missing && index < missing + REGION ? source(index) : stem(index);
      assert.ok(Math.abs(out[i] - expected) < 1e-6, `source frame ${index}`);
    }
  }
  assert.equal(p.misses, frames);
});

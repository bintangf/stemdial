import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.sampleRate = 48000;
globalThis.AudioWorkletProcessor = class { port = {}; };
let Processor;
globalThis.registerProcessor = (_, klass) => { Processor = klass; };
await import('../src/fallback/center.worklet.mjs');

function render(source, center = 1) {
  const processor = new Processor();
  const result = new Float32Array(sampleRate);
  for (let start = 0; start < sampleRate; start += 128) {
    const l = result.subarray(start, start + 128), r = new Float32Array(l.length);
    const input = source.map(fn => Float32Array.from(l, (_, i) => fn(start + i)));
    processor.process([input], [[l, r]], {center: [center]});
  }
  return result;
}

const tone = (hz, i) => 0.2 * Math.sin(2 * Math.PI * hz * i / sampleRate);
function amplitude(data, hz) {
  let sin = 0, cos = 0;
  for (let i = sampleRate / 2; i < data.length; i++) {
    const phase = 2 * Math.PI * hz * i / sampleRate;
    sin += data[i] * Math.sin(phase);
    cos += data[i] * Math.cos(phase);
  }
  return 4 * Math.hypot(sin, cos) / sampleRate;
}

test('full center cut keeps low bass and stereo sides while suppressing vocal-range mid', () => {
  const output = render([1, -1].map(side => i => tone(55, i) + tone(800, i) + side * tone(1300, i)));
  assert.ok(amplitude(output, 55) > 0.19);
  assert.ok(amplitude(output, 800) < 0.03);
  assert.ok(Math.abs(amplitude(output, 1300) - 0.2) < 0.001);
});

test('vocal focus keeps centered voice-range signal and rejects stereo sides', () => {
  const output = render([1, -1].map(side => i => tone(800, i) + side * tone(1300, i)), -1);
  assert.ok(amplitude(output, 800) > 0.19);
  assert.ok(amplitude(output, 1300) < 0.001);
});

test('the fallback output is soft limited', () => {
  const output = render([i => 1.5 * Math.sin(2 * Math.PI * 800 * i / sampleRate)], 0);
  let peak = 0;
  for (const value of output) peak = Math.max(peak, Math.abs(value));
  assert.ok(peak < 1.01, `peak ${peak}`);
});

test('vocal focus rejects backing spread between the channels', () => {
  const output = render([
    i => tone(800, i) + tone(3200, i),
    i => tone(800, i) + 0.2 * Math.cos(2 * Math.PI * 3200 * i / sampleRate),
  ], -1);
  assert.ok(amplitude(output, 800) > 0.19);
  assert.ok(amplitude(output, 3200) < 0.01);
});

test('vocal focus improves centered-tone to panned-backing ratio over simple center extraction', () => {
  const out=render([1,0.1].map(pan=>i=>tone(800,i)+pan*tone(3200,i)),-1);
  const improvement=20*Math.log10((amplitude(out,800)/amplitude(out,3200))*.55);
  console.log(`Synthetic 800 Hz center / 3200 Hz panned backing: ${improvement.toFixed(1)} dB improvement`);
  assert.ok(improvement>10);
});

for (const channels of [1, 2]) {
  test(`center cut retains mono carried in ${channels} channel(s)`, () => {
    const output = render(Array(channels).fill(i => tone(800, i)));
    assert.ok(Math.abs(amplitude(output, 800) - 0.2) < 0.001);
  });
}

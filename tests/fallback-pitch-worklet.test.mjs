import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.sampleRate = 48000;
globalThis.AudioWorkletProcessor = class { port = {}; };
let Processor;
globalThis.registerProcessor = (_, klass) => { Processor = klass; };
await import('../src/fallback/pitch.worklet.mjs');

const block = (n, hz = 440) => Float32Array.from({length: n}, (_, i) => 0.2 * Math.sin(2 * Math.PI * hz * i / sampleRate));

test('unison passes the input and the port drives the target', () => {
  const processor = new Processor();
  const input = [block(128), block(128)];
  const outL = new Float32Array(128), outR = new Float32Array(128);
  processor.process([input], [[outL, outR]]);
  for (let i = 0; i < 128; i++) {
    assert.equal(outL[i], input[0][i]);
    assert.equal(outR[i], input[1][i]);
  }
  processor.port.onmessage({data: 7});
  assert.equal(processor.target, 7);
  processor.port.onmessage({data: 99});
  assert.equal(processor.target, 12);
  processor.port.onmessage({data: 'stop'});
  assert.equal(processor.process([input], [[outL, outR]]), false);
});

test('pitch reaches a semitone target with the one-sample slew', () => {
  const processor = new Processor();
  processor.port.onmessage({data: 1});
  const input = [block(256), block(256)];
  const outL = new Float32Array(256), outR = new Float32Array(256);
  processor.process([input], [[outL, outR]]);
  assert.ok(Math.abs(processor.current - 1) < 1e-9, `current ${processor.current}`);
});

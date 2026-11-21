import test from 'node:test';
import assert from 'node:assert/strict';
import {isSilentPair, pairRms, SILENCE_RMS} from '../src/separator/silence.mjs';

globalThis.sampleRate = 44100;
globalThis.AudioWorkletProcessor = class { port = {postMessage() {}}; };
let Processor;
globalThis.registerProcessor = (_, klass) => { Processor = klass; };
await import('../src/separator/separator.worklet.mjs');

const BLOCK = 1024;

test('a region under the silence floor counts as silent', () => {
  assert.equal(pairRms([new Float32Array(256), new Float32Array(256)]), 0);
  assert.equal(isSilentPair(new Float32Array(256)), true);
  assert.equal(isSilentPair(Float32Array.from({length: 256}, () => SILENCE_RMS / 2)), true);
  assert.equal(isSilentPair(Float32Array.from({length: 256}, () => SILENCE_RMS * 2)), false);
});

test('a silent region plays the dry signal instead of the stem noise', () => {
  const delay = 8 * BLOCK;
  const processor = new Processor({processorOptions: {delay}});
  const stem = Float32Array.from({length: 4 * BLOCK}, () => 0.5);
  processor.receive({index: 0, vocalL: stem, vocalR: stem, instL: stem, instR: stem, silent: true});

  let peak = 0;
  const silent = new Float32Array(128);
  for (let pos = 0; pos < delay + 5 * BLOCK + 512; pos += 128) {
    const outL = new Float32Array(128), outR = new Float32Array(128);
    processor.run([silent, silent], outL, outR);
    if (pos > delay + BLOCK) for (const value of outL) peak = Math.max(peak, Math.abs(value));
  }
  assert.ok(peak < 1e-9, `silent region leaked ${peak}`);
});

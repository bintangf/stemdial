import test from 'node:test';
import assert from 'node:assert/strict';
import {BINS} from '../src/separator/dsp.mjs';
import {createHistory} from '../src/separator/history.mjs';
import {createGate, percentile} from '../src/separator/gate.mjs';

test('percentile picks the nearest rank and tolerates one sample', () => {
  assert.equal(percentile([100, 101, 500], 0.95), 101);
  assert.equal(percentile([42], 0.95), 42);
});

test('history pads the left edge and keeps frames in song order across a wrap', () => {
  const frames = 4, history = createHistory(frames);
  const frame = value => Float32Array.from({length: 4 * BINS}, () => value);
  history.push(frame(1));
  let snapshot = history.snapshot();
  assert.equal(snapshot[0 * BINS * frames + 0], 0);
  assert.equal(snapshot[0 * BINS * frames + frames - 1], 1);
  for (const value of [10, 11, 12, 13, 14]) history.push(frame(value));
  snapshot = history.snapshot();
  assert.deepEqual([0, 1, 2, 3].map(j => snapshot[j]), [11, 12, 13, 14]);
  for (let ch = 0; ch < 4; ch++) {
    assert.deepEqual([0, 1, 2, 3].map(j => snapshot[ch * BINS * frames + j]), [11, 12, 13, 14]);
  }
  history.reset();
  assert.equal(history.snapshot()[0], 0);
});

test('the gate fires once, only after three samples, and reports p95', () => {
  const fired = [];
  const gate = createGate({limit: 265, onSlow: p95 => fired.push(p95)});
  gate.push(100);
  gate.push(100);
  assert.equal(gate.fired, false);
  gate.push(300);
  assert.equal(gate.fired, false, 'p95 of three samples is the middle one');
  gate.push(300);
  assert.equal(gate.fired, true);
  assert.deepEqual(fired, [300]);
  gate.push(1000);
  assert.deepEqual(fired, [300]);
});

test('the gate keeps a fast stream open', () => {
  const gate = createGate({limit: 265, onSlow: () => assert.fail('gate fired')});
  for (const ms of [80, 120, 90, 200, 60]) gate.push(ms);
  assert.equal(gate.fired, false);
});

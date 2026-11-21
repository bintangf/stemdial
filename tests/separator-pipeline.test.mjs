import test from 'node:test';
import assert from 'node:assert/strict';
import {BINS, mixGain} from '../src/separator/dsp.mjs';
import {createHistory} from '../src/separator/history.mjs';
import {createGate, mean, percentile} from '../src/separator/gate.mjs';
import {BLOCK, MIN_FRAMES, RATE} from '../src/separator/timing.mjs';

const REGION_MS = MIN_FRAMES * BLOCK / RATE * 1000;

test('the vocal prediction is held to the mixture magnitude', () => {
  assert.equal(mixGain(0.3, 0.1, 1, 1), 1);
  assert.equal(mixGain(1, 1, 4, 4), 1);
  assert.equal(mixGain(3, 4, 0, 0), 0);
  assert.equal(mixGain(0, 0, 0, 0), 1);
  const gain = mixGain(3, 4, 1, 0);
  assert.ok(Math.abs(Math.hypot(3 * gain, 4 * gain) - 1) < 1e-12);
});

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

test('the throughput gate fires on the mean, not on one slow pair', () => {
  const fired = [];
  const gate = createGate({limit: REGION_MS, minimum: 10, stat: mean, onSlow: value => fired.push(value)});
  for (let i = 0; i < 9; i++) gate.push(120);
  assert.equal(gate.fired, false, 'needs ten samples');
  gate.push(120);
  assert.deepEqual(fired, [120]);

  const steady = createGate({limit: REGION_MS, minimum: 10, stat: mean, onSlow: () => assert.fail('gate fired')});
  for (let i = 0; i < 20; i++) steady.push(i === 5 ? 400 : 50);
  assert.equal(steady.fired, false);
});

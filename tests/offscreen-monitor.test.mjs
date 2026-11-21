import test from 'node:test';
import assert from 'node:assert/strict';
import {createMonitor} from '../src/offscreen/monitor.mjs';

function fakeContext() {
  const calls = {delayMax: null, ramps: [], disconnects: 0};
  const param = value => ({
    value,
    setValueAtTime(level, at) { calls.ramps.push(['set', level, at]); return this; },
    linearRampToValueAtTime(level, at) { calls.ramps.push(['ramp', level, at]); return this; },
    cancelScheduledValues(at) { calls.ramps.push(['cancel', at]); return this; },
  });
  const node = type => {
    const self = {
      type,
      connect: next => next,
      disconnect: () => { calls.disconnects++; },
    };
    if (type === 'gain') self.gain = param(1);
    if (type === 'delay') self.delayTime = param(0);
    return self;
  };
  return {
    calls,
    sampleRate: 44100,
    currentTime: 2,
    destination: {type: 'destination'},
    createMediaStreamSource: () => node('source'),
    createDelay: max => { calls.delayMax = max; return node('delay'); },
    createGain: () => node('gain'),
  };
}

test('the monitor delays the dry signal by the remembered value inside the longest buffer', () => {
  const ctx = fakeContext();
  const monitor = createMonitor(ctx, {id: 'stream'}, 4096, 24576);
  assert.ok(Math.abs(ctx.calls.delayMax - (24576 / 44100 + 0.05)) < 1e-9);
  assert.equal(monitor.latencyMs, 93);
  monitor.close();
});

test('retune ramps the monitor to the delay this session measured', () => {
  const ctx = fakeContext();
  const monitor = createMonitor(ctx, {id: 'stream'}, 16384, 24576);
  monitor.retune(4096);
  assert.equal(monitor.latencyMs, 93);
  const [cancel, set, ramp] = ctx.calls.ramps.slice(-3);
  assert.deepEqual(cancel, ['cancel', 2]);
  assert.deepEqual(set, ['set', 16384 / 44100, 2]);
  assert.deepEqual(ramp, ['ramp', 4096 / 44100, 2.08]);
  monitor.close();
});

test('the handover fades the monitor out under the separator and then disconnects', () => {
  const ctx = fakeContext();
  const monitor = createMonitor(ctx, {id: 'stream'}, 16384, 24576);
  const separator = {gain: {
    setValueAtTime(level, at) { ctx.calls.ramps.push(['set', level, at]); return this; },
    linearRampToValueAtTime(level, at) { ctx.calls.ramps.push(['ramp', level, at]); return this; },
  }};
  monitor.fadeTo(separator);
  assert.deepEqual(ctx.calls.ramps[0], ['set', 1, 2]);
  assert.deepEqual(ctx.calls.ramps[1], ['ramp', 0, 2.02]);
  assert.deepEqual(ctx.calls.ramps[2], ['set', 0, 2]);
  assert.deepEqual(ctx.calls.ramps[3], ['ramp', 1, 2.02]);
  monitor.close();
  monitor.close();
  assert.equal(ctx.calls.disconnects, 3);
});

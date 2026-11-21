import test from 'node:test';
import assert from 'node:assert/strict';
import {requireSeparatorSupport} from '../src/separator/capabilities.mjs';

function withGpu(gpu, run) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {value: {gpu}, configurable: true});
  return Promise.resolve(run()).finally(() => {
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
    else delete globalThis.navigator;
  });
}

test('a non-44100 context reports a fallback before the worker starts', async () => {
  const seen = [];
  await assert.rejects(requireSeparatorSupport({sampleRate: 48000}, (state, message) => seen.push([state, message])), /Unsupported sample rate/);
  assert.equal(seen[0][0], 'fallback');
});

test('missing WebGPU and a missing adapter both report a fallback', async () => {
  await withGpu(undefined, async () => {
    const seen = [];
    await assert.rejects(requireSeparatorSupport({sampleRate: 44100}, (state, message) => seen.push([state, message])), /WebGPU unavailable/);
    assert.deepEqual(seen, [['fallback', 'WebGPU unavailable']]);
  });
  await withGpu({requestAdapter: async () => null}, async () => {
    await assert.rejects(requireSeparatorSupport({sampleRate: 44100}, () => {}), /No WebGPU adapter/);
  });
});

test('an adapter passes', async () => {
  await withGpu({requestAdapter: async () => ({})}, async () => {
    await requireSeparatorSupport({sampleRate: 44100}, () => assert.fail('should not report'));
  });
});

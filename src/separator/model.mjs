import * as ort from './ort/ort.webgpu.min.mjs';
import {BINS} from './dsp.mjs';

ort.env.wasm.numThreads = 1;
// ORT logs "Unknown CPU vendor" on Apple Silicon; it is noise, not a failure.
ort.env.logLevel = 'error';
const wasm = new URL('./ort/', import.meta.url).href;
ort.env.wasm.wasmPaths = {
  'ort-wasm-simd-threaded.asyncify.mjs': wasm + 'ort-wasm-simd-threaded.asyncify.mjs',
  'ort-wasm-simd-threaded.asyncify.wasm': wasm + 'ort-wasm-simd-threaded.asyncify.wasm',
};

const run = (session, inputName, input, frames) =>
  session.run({[inputName]: new ort.Tensor('float32', input, [1, 4, BINS, frames])});

export async function loadModel(modelUrl, {frames, onStatus}) {
  onStatus?.('loading', 'Checking WebGPU');
  if (!navigator.gpu) throw new Error('WebGPU unavailable');
  const adapter = await navigator.gpu.requestAdapter({powerPreference: 'high-performance'});
  if (!adapter) throw new Error('No WebGPU adapter');

  onStatus?.('loading', 'Loading model');
  const model = await (await fetch(modelUrl)).arrayBuffer();
  const t0 = performance.now();
  const session = await ort.InferenceSession.create(model, {executionProviders: ['webgpu'], graphOptimizationLevel: 'basic'});
  const inputName = session.inputNames[0];
  const historyFrames = session.inputMetadata[0].shape[3];
  if (!Number.isInteger(historyFrames) || historyFrames < frames) throw new Error('Unsupported model time dimension');

  onStatus?.('loading', 'Warming up');
  const zeros = new Float32Array(4 * BINS * historyFrames);
  // The first runs include shader compilation; the median of five reflects steady state.
  const warm = [];
  for (let i = 0; i < 5; i++) {
    const w0 = performance.now();
    await run(session, inputName, zeros, historyFrames);
    warm.push(performance.now() - w0);
  }
  warm.sort((a, b) => a - b);

  return {
    frames: historyFrames,
    pairMs: warm[2],
    initMs: performance.now() - t0,
    async run(input) {
      const output = await run(session, inputName, input, historyFrames);
      return output[session.outputNames[0]].data;
    },
  };
}

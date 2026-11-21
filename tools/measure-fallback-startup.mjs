import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const {CHROME, PLAYWRIGHT, BASE = 'http://127.0.0.1:8125', SAMPLES = '20'} = process.env;
assert.ok(PLAYWRIGHT, 'Set PLAYWRIGHT to the playwright-core package directory');
const samples = Number(SAMPLES);
assert.ok(Number.isInteger(samples) && samples > 0, 'SAMPLES must be a positive integer');
const {chromium} = await import(pathToFileURL(resolve(PLAYWRIGHT, 'index.mjs')).href);
const browser = await chromium.launch({executablePath: CHROME, args: [
  '--enable-unsafe-webgpu', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required',
]});

async function sample(base, policy) {
  const page = await browser.newPage();
  try {
    const modelAssets = [];
    page.on('request', req => {
      if (/\.(?:onnx|wasm)$/.test(req.url())) modelAssets.push(new URL(req.url()).pathname);
    });
    const url = new URL('/measure-fallback-startup', base).href;
    await page.route(url, route => route.fulfill({contentType: 'text/html', body: '<!doctype html>'}));
    await page.goto(url);
    const times = await page.evaluate(async policy => {
      const source = new AudioContext({sampleRate: 44100});
      const dest = source.createMediaStreamDestination();
      const tone = source.createOscillator();
      tone.frequency.value = 440;
      const gain = source.createGain();
      gain.gain.value = 0.2;
      const invert = source.createGain();
      invert.gain.value = -1;
      const stereo = source.createChannelMerger(2);
      tone.connect(gain).connect(stereo, 0, 0);
      gain.connect(invert).connect(stereo, 0, 1);
      stereo.connect(dest);
      tone.start();
      await source.resume();

      let handle, output, t0;
      const stages = {};
      chrome.runtime = {
        onMessage: {addListener: listener => { handle = listener; }},
        sendMessage: async ({op, state, message}) => {
          if (op === 'engine-status') stages[message || state] = performance.now() - t0;
        },
      };
      navigator.mediaDevices.getUserMedia = async () => dest.stream;
      // Tap the real stereo filter's output, not the original-audio monitor.
      window.AudioWorkletNode = class extends AudioWorkletNode {
        constructor(ctx, name, options) {
          super(ctx, name, options);
          if (name === 'ruang-nada-fallback-pitch') {
            output = ctx.createAnalyser();
            output.fftSize = 128;
            const splitter = ctx.createChannelSplitter(2);
            this.connect(splitter).connect(output);
          }
        }
      };
      await import('/src/offscreen/offscreen.js');
      t0 = performance.now();
      const reply = new Promise(resolve => handle({
        to: 'audio', op: 'start', streamId: 'fixture', tabId: 1, policy,
        mix: {center: 1, mode: 1, semitones: 0},
      }, {}, resolve));
      const wave = new Float32Array(128);
      let firstAudio;
      while (performance.now() - t0 < 10000) {
        output?.getFloatTimeDomainData(wave);
        if (wave.some(x => Math.abs(x) > 0.02)) {
          firstAudio = performance.now() - t0;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 4));
      }
      if (firstAudio == null) throw Error('No stereo filter audio within 10 seconds');
      const result = await reply;
      if (!result.ok) throw Error(result.message);
      const adapter = await navigator.gpu?.requestAdapter({powerPreference: 'high-performance'});
      if (!adapter || adapter.features.has('shader-f16')) throw Error('Expected a WebGPU adapter without shader-f16');
      return {firstAudio, stages};
    }, policy);
    return {...times, modelAssets};
  } finally { await page.close(); }
}

try {
  const cases = BASE.split(',').flatMap(base => ['auto', 'stereo'].map(policy => ({base, policy, runs: []})));
  for (let i = 0; i < samples; i++) {
    for (const c of i % 2 ? [...cases].reverse() : cases) c.runs.push(await sample(c.base, c.policy));
  }
  for (const {base, policy, runs} of cases) {
    const xs = runs.map(r => r.firstAudio).sort((a, b) => a - b);
    const percentile = p => Math.round(xs[Math.ceil(xs.length * p) - 1]);
    console.log(JSON.stringify({base, policy, p50: percentile(0.5), p95: percentile(0.95), runs}));
  }
} finally { await browser.close(); }

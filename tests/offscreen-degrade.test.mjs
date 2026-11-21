import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';

// Swap the offscreen document's audio modules for stubs driven by globalThis.__stub.
const hooks = `
const stubs = {'../separator/engine.mjs': 'separator', '../fallback/engine.mjs': 'fallback', './monitor.mjs': 'monitor'};
const sources = {
  separator: 'export const createSeparator = o => globalThis.__stub.createSeparator(o);',
  fallback: 'export const createEngine = (c, s) => globalThis.__stub.createEngine(c, s);',
  monitor: 'export const createMonitor = (...a) => globalThis.__stub.createMonitor(...a);',
};
export async function resolve(spec, context, next) {
  if (context.parentURL?.endsWith('/offscreen/offscreen.js') && stubs[spec]) return {url: 'stub:' + stubs[spec], shortCircuit: true};
  return next(spec, context);
}
export async function load(url, context, next) {
  if (url.startsWith('stub:')) return {format: 'module', source: sources[url.slice(5)], shortCircuit: true};
  return next(url, context);
}`;
register('data:text/javascript,' + encodeURIComponent(hooks));

const flush = () => new Promise(resolve => setImmediate(resolve));
const reports = [];
const contexts = [];
let listener;

class FakeContext {
  constructor() { this.state = 'running'; contexts.push(this); }
  async resume() {}
  async close() { this.state = 'closed'; }
  createAnalyser() { return {}; }
  createMediaStreamSource() { return {connect() {}}; }
}
globalThis.AudioContext = FakeContext;
globalThis.chrome = {runtime: {
  sendMessage: async message => { reports.push(message); },
  onMessage: {addListener: fn => { listener = fn; }},
}};
Object.defineProperty(globalThis, 'navigator', {configurable: true, value: {mediaDevices: {getUserMedia: async () => {
  const track = {readyState: 'live', stop() { this.readyState = 'ended'; }};
  return {getTracks: () => [track], getAudioTracks: () => [track]};
}}}});

const stub = globalThis.__stub = {
  monitors: [], separators: [], engines: [],
  beforeReturn: null,
  engineGate: null,
  createMonitor() {
    const monitor = {latencyMs: 0, closed: false, faded: 0, retune() {}, fadeTo() { this.faded++; }, close() { this.closed = true; }};
    stub.monitors.push(monitor);
    return monitor;
  },
  async createSeparator(options) {
    const separator = {options, node: {}, delay: 16384, disconnected: 0,
      setMode() {}, setMix() {}, setPitch() {}, disconnect() { this.disconnected++; }};
    stub.separators.push(separator);
    stub.beforeReturn?.(options);
    stub.beforeReturn = null;
    return separator;
  },
  async createEngine(ctx) {
    await stub.engineGate;
    const engine = {ctx, mix: null, disconnected: 0, set(mix) { this.mix = mix; }, disconnect() { this.disconnected++; }};
    stub.engines.push(engine);
    return engine;
  },
};

await import('../src/offscreen/offscreen.js');
const send = message => new Promise(resolve => listener({to: 'audio', ...message}, {}, resolve));
const mix = {semitones: 0, center: 1, mode: 1};
const start = (tabId, policy = 'auto') => send({op: 'start', streamId: 's', tabId, mix, sepDelay: 16384, policy});
const stereoReports = () => reports.filter(r => r.op === 'engine-status' && r.state === 'stereo');

test.beforeEach(async () => {
  await send({op: 'stop'});
  for (const list of [stub.monitors, stub.separators, stub.engines, reports, contexts]) list.length = 0;
  stub.engineGate = null;
});

test('a separator failure before the handover closes the dry monitor', async () => {
  await start(1);
  const [monitor] = stub.monitors, [separator] = stub.separators;
  separator.options.onStatus('error', 'GPU lost');
  await flush();
  assert.equal(monitor.closed, true, 'the delayed dry path must not keep playing over the fallback');
  assert.equal(separator.disconnected, 1);
  assert.equal(stub.engines.length, 1);
  assert.deepEqual(stub.engines[0].mix, mix);
  assert.equal(stereoReports().at(-1).message, 'GPU lost');
});

test('a failure after the handover swaps the faded separator', async () => {
  await start(1);
  const [monitor] = stub.monitors, [separator] = stub.separators;
  separator.options.onStats({played: 1});
  assert.equal(monitor.faded, 1);
  separator.options.onStatus('fallback', 'Slow GPU');
  await flush();
  assert.equal(separator.disconnected, 1);
  assert.equal(stub.engines.length, 1);
});

test('a new tab failing during setup degrades itself, not the live tab', async () => {
  await start(1);
  stub.beforeReturn = options => options.onStatus('error', 'Model failed');
  await start(2);
  await flush();
  const [first, second] = stub.separators;
  assert.equal(stub.engines.length, 1, 'one fallback, built for the new session');
  assert.equal(stub.engines[0].ctx, contexts[1]);
  assert.equal(first.disconnected, 1, 'the old tab is only torn down by stop()');
  assert.equal(second.disconnected, 1);
  assert.equal(stereoReports().at(-1).tabId, 2);
});

test('a fallback that finishes after stop is discarded', async () => {
  await start(1);
  let release;
  stub.engineGate = new Promise(resolve => { release = resolve; });
  stub.separators[0].options.onStatus('error', 'GPU lost');
  await flush();
  await send({op: 'stop'});
  release();
  await flush();
  assert.equal(stub.engines.length, 1);
  assert.equal(stub.engines[0].disconnected, 1);
  assert.equal(stereoReports().length, 0);
});

test('with the AI-only policy a failure plays the original mix', async () => {
  await start(1, 'ai');
  const [monitor] = stub.monitors, [separator] = stub.separators;
  separator.options.onStatus('error', 'GPU lost.');
  await flush();
  assert.equal(monitor.closed, true);
  assert.equal(separator.disconnected, 1);
  assert.equal(stub.engines.length, 0, 'no stereo fallback');
  const last = reports.filter(r => r.op === 'engine-status').at(-1);
  assert.equal(last.state, 'dry');
  assert.match(last.message, /GPU lost\./);
});

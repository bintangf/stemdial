import {createEngine} from '../fallback/engine.mjs';
import {MAX_DELAY} from '../separator/timing.mjs';
import {createMonitor} from './monitor.mjs';

let stream, ctx, engine, sep, liveMix, tabId = null;

const report = (state, message) => chrome.runtime.sendMessage({to: 'worker', op: 'engine-status', state, message, tabId}).catch(() => {});
const debug = {kind: null, ctxState: null, chunks: 0, ms: 0, latency: 0, gate: null, monitor: 0};
let latencySent = 0;

globalThis.__stemdebug = () => {
  let rms = null;
  if (debug.an) {
    const buf = new Float32Array(debug.an.fftSize);
    debug.an.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const value of buf) sum += value * value;
    rms = Math.sqrt(sum / buf.length);
  }
  return {...debug, tabId, rms, counters: sep?.counters};
};

function apply(mix) {
  liveMix = mix;
  if (sep) {
    sep.setMode(mix.mode === -1 ? 'vocal' : 'instrumental');
    sep.setMix(Math.abs(mix.center));
    sep.setPitch(mix.semitones);
  } else engine?.set(mix);
}

// Swap the AI separator for the stereo filter without leaving a silent gap.
// The fallback is built first: if it fails, the separator keeps playing.
async function degrade(message) {
  if (!ctx || !stream || !sep) return;
  let fallback;
  try {
    fallback = await createEngine(ctx, stream);
  } catch (error) {
    report('error', `Stereo filter failed: ${error.message}`);
    return;
  }
  if (liveMix) fallback.set(liveMix);
  const old = sep;
  sep = null;
  engine = fallback;
  old.disconnect();
  report('stereo', message);
}
const degradeLater = message => degrade(message).catch(error => report('error', error.message));

async function stop() {
  tabId = null;
  stream?.getTracks().forEach(track => track.stop());
  sep?.disconnect();
  engine?.disconnect();
  if (ctx && ctx.state !== 'closed') await ctx.close();
  stream = ctx = engine = sep = liveMix = null;
}

function forwardLatency(latency) {
  if (latency > 0 && performance.now() - latencySent > 1000) {
    latencySent = performance.now();
    chrome.runtime.sendMessage({to: 'worker', op: 'latency', ms: latency}).catch(() => {});
  }
}

function recordStats(stats) {
  debug.chunks++;
  if (stats.ms != null) debug.ms = stats.ms;
  if (stats.latency != null) debug.latency = stats.latency;
  if (stats.gate != null) debug.gate = stats.gate;
}

async function startSeparator({ctx, stream, stored, monitor}) {
  const {createSeparator} = await import('../separator/engine.mjs');
  let monitoring = true;
  let separator = null;
  separator = await createSeparator({
    ctx,
    stream,
    initialGain: 0,
    preferredDelay: stored,
    onStatus(state, message) {
      debug.kind = 'ai';
      debug.ctxState = ctx.state;
      if (state === 'fallback' || state === 'error') degradeLater(message);
      else report(state, message);
    },
    onStats(stats) {
      forwardLatency(stats.latency);
      if (monitoring && stats.played && separator) {
        monitoring = false;
        monitor.fadeTo(separator.node);
      }
      recordStats(stats);
    },
  });
  return separator;
}

async function open({streamId, sepDelay, mix}) {
  let nextStream, nextCtx;
  try {
    nextStream = await navigator.mediaDevices.getUserMedia({audio: {mandatory: {chromeMediaSource: 'tab', chromeMediaSourceId: streamId}}, video: false});
    nextCtx = new AudioContext({sampleRate: 44100, latencyHint: 'interactive'});
    await nextCtx.resume();

    // The monitor starts at the delay this machine used last time, so the
    // handover plays the same sample as the separator. The offscreen document
    // has no storage API; the worker passes the value in.
    const stored = Number(sepDelay) || 0;
    const monitor = createMonitor(nextCtx, nextStream, stored || MAX_DELAY, MAX_DELAY);
    debug.monitor = monitor.latencyMs;
    debug.an = nextCtx.createAnalyser();
    nextCtx.createMediaStreamSource(nextStream).connect(debug.an);

    let nextSep = null, nextEngine = null;
    try {
      nextSep = await startSeparator({ctx: nextCtx, stream: nextStream, stored, monitor});
    } catch (error) {
      nextEngine = await createEngine(nextCtx, nextStream);
      monitor.close();
      report('stereo', 'AI unavailable on this device');
      console.warn('Separator unavailable:', error);
    }
    if (nextSep && nextSep.delay !== stored) {
      chrome.runtime.sendMessage({to: 'worker', op: 'sep-delay', delay: nextSep.delay}).catch(() => {});
    }
    if (nextSep) report('ai');
    else nextEngine.set(mix);
    return {stream: nextStream, ctx: nextCtx, engine: nextEngine, sep: nextSep};
  } catch (error) {
    nextStream?.getTracks().forEach(track => track.stop());
    await nextCtx?.close();
    throw error;
  }
}

async function start(message) {
  let next;
  try {
    next = await open(message);
    await next.ctx.resume();
    if (next.stream.getAudioTracks()[0].readyState === 'ended') throw Error('Tab capture ended.');
    await stop();
    stream = next.stream;
    ctx = next.ctx;
    engine = next.engine;
    sep = next.sep;
    stream.getAudioTracks()[0].onended = () => chrome.runtime.sendMessage({to: 'worker', op: 'ended', tabId: message.tabId});
    tabId = message.tabId;
    liveMix = message.mix;
    if (sep) apply(message.mix);
    else engine.set(message.mix);
  } catch (error) {
    next?.stream.getTracks().forEach(track => track.stop());
    next?.sep?.disconnect();
    next?.engine?.disconnect();
    await next?.ctx?.close();
    throw error;
  }
}

async function handle(message) {
  if (message.op === 'stop') await stop();
  if (message.op === 'set') apply(message.mix);
  if (message.op === 'start') await start(message);
  return {ok: true, tabId, mix: liveMix};
}

chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message.to !== 'audio') return;
  handle(message).then(reply, error => reply({ok: false, message: error.message}));
  return true;
});

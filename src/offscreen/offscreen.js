import {createEngine} from '../fallback/engine.mjs';
import {MAX_DELAY} from '../separator/timing.mjs';
import {createMonitor} from './monitor.mjs';

let stream, ctx, engine, sep, liveMix, tabId = null, monitorNode = null, enginePolicy = 'auto';

function createDry(ctx, stream) {
  const source = ctx.createMediaStreamSource(stream);
  source.connect(ctx.destination);
  return {set() {}, disconnect() { source.disconnect(); }};
}

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
// Only the live session's separator may degrade; a failure reported before
// start() makes it live is retried there.
async function degrade(ai) {
  if (!sep || sep !== ai.separator) return;
  monitorNode?.close();
  monitorNode = null;
  if (enginePolicy === 'ai') {
    sep = null;
    engine = createDry(ctx, stream);
    ai.separator.disconnect();
    report('dry', `AI stopped. ${ai.failure} Stereo fallback is off; playing the original mix.`);
    return;
  }
  let fallback;
  try {
    fallback = await createEngine(ctx, stream);
  } catch (error) {
    if (sep === ai.separator) report('error', `Stereo filter failed: ${error.message}`);
    return;
  }
  if (sep !== ai.separator) {
    fallback.disconnect();
    return;
  }
  if (liveMix) fallback.set(liveMix);
  sep = null;
  engine = fallback;
  ai.separator.disconnect();
  report('stereo', ai.failure);
}
const degradeLater = ai => degrade(ai).catch(error => report('error', error.message));

async function stop() {
  tabId = null;
  stream?.getTracks().forEach(track => track.stop());
  sep?.disconnect();
  engine?.disconnect();
  monitorNode?.close();
  if (ctx && ctx.state !== 'closed') await ctx.close();
  stream = ctx = engine = sep = liveMix = null;
  monitorNode = null;
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

async function startSeparator({ctx, stream, monitor}) {
  const {createSeparator} = await import('../separator/engine.mjs');
  const ai = {separator: null, monitoring: true, failure: null};
  ai.separator = await createSeparator({
    ctx,
    stream,
    initialGain: 0,
    onStatus(state, message) {
      debug.kind = 'ai';
      debug.ctxState = ctx.state;
      if (state === 'fallback' || state === 'error') {
        ai.failure ??= message;
        degradeLater(ai);
      } else report(state, message);
    },
    onStats(stats) {
      forwardLatency(stats.latency);
      if (ai.monitoring && stats.played && ai.separator) {
        ai.monitoring = false;
        monitor.fadeTo(ai.separator.node);
      }
      recordStats(stats);
    },
  });
  // Move the monitor to the buffer this session measured, before the handover.
  monitor.retune(ai.separator.delay);
  debug.monitor = monitor.latencyMs;
  return ai;
}

async function open({streamId, sepDelay, mix, policy}) {
  const selectedPolicy = policy || 'auto';
  let nextStream, nextCtx, monitor = null;
  try {
    nextStream = await navigator.mediaDevices.getUserMedia({audio: {mandatory: {chromeMediaSource: 'tab', chromeMediaSourceId: streamId}}, video: false});
    nextCtx = new AudioContext({sampleRate: 44100, latencyHint: 'interactive'});
    await nextCtx.resume();

    // The monitor starts at the delay this machine used last time, so the
    // handover plays the same sample as the separator. The offscreen document
    // has no storage API; the worker passes the value in.
    const stored = Number(sepDelay) || 0;
    monitor = createMonitor(nextCtx, nextStream, stored || MAX_DELAY, MAX_DELAY);
    debug.monitor = monitor.latencyMs;
    debug.an = nextCtx.createAnalyser();
    nextCtx.createMediaStreamSource(nextStream).connect(debug.an);

    let ai = null, nextSep = null, nextEngine = null;
    if (selectedPolicy === 'stereo') {
      nextEngine = await createEngine(nextCtx, nextStream);
      monitor.close();
      monitor = null;
      report('stereo', 'Stereo filter selected');
    } else {
      try {
        ai = await startSeparator({ctx: nextCtx, stream: nextStream, monitor});
        nextSep = ai.separator;
      } catch (error) {
        monitor.close();
        monitor = null;
        if (selectedPolicy === 'ai') {
          nextEngine = createDry(nextCtx, nextStream);
          report('dry', 'AI unavailable. Stereo fallback is off, so the original mix is playing.');
        } else {
          nextEngine = await createEngine(nextCtx, nextStream);
          report('stereo', 'AI unavailable on this device');
        }
        console.warn('Separator unavailable:', error);
      }
    }
    if (nextSep && nextSep.delay !== stored) {
      chrome.runtime.sendMessage({to: 'worker', op: 'sep-delay', delay: nextSep.delay}).catch(() => {});
    }
    if (nextSep) report('ai');
    else nextEngine.set(mix);
    return {stream: nextStream, ctx: nextCtx, engine: nextEngine, sep: nextSep, ai, monitor, policy: selectedPolicy};
  } catch (error) {
    monitor?.close();
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
    // stop() closes the previous monitor and session; only then adopt the new one.
    await stop();
    enginePolicy = next.policy;
    stream = next.stream;
    ctx = next.ctx;
    engine = next.engine;
    sep = next.sep;
    monitorNode = next.monitor;
    stream.getAudioTracks()[0].onended = () => chrome.runtime.sendMessage({to: 'worker', op: 'ended', tabId: message.tabId});
    tabId = message.tabId;
    liveMix = message.mix;
    if (sep) apply(message.mix);
    else engine.set(message.mix);
    if (next.ai?.failure) degradeLater(next.ai);
  } catch (error) {
    next?.stream.getTracks().forEach(track => track.stop());
    next?.sep?.disconnect();
    next?.engine?.disconnect();
    next?.monitor?.close();
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

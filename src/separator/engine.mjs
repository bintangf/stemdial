import {delayFor} from './timing.mjs';
import {requireSeparatorSupport} from './capabilities.mjs';

const WORKLET = new URL('./separator.worklet.mjs', import.meta.url);
const PITCH = new URL('./pitch.worklet.mjs', import.meta.url);
const WORKER = new URL('./inference.worker.mjs', import.meta.url);
const MODEL = new URL('./model/vocals.onnx', import.meta.url).href;

export async function createSeparator({ctx, stream, onStatus, onStats, initialGain = 1, preferredDelay = 0}) {
  const status = (state, message = '') => onStatus?.(state, message);
  const stats = (data) => onStats?.(data);

  await requireSeparatorSupport(ctx, status);

  status('loading', 'Loading separator');
  const worker = new Worker(WORKER, {type: 'module'});
  const nodes = [];
  let processor, pitch, closed = false;
  const counters = {fromWorklet: 0, pairs: 0, skips: 0, played: 0, misses: 0, maxMs: 0};

  const ready = new Promise((resolve, reject) => {
    worker.onmessage = ({data: m}) => {
      if (m.type === 'status') {
        if (m.state === 'error') status('error', m.message);
        else status(m.state, m.message);
      } else if (m.type === 'ready') resolve(m);
      else if (m.type === 'failed') reject(new Error(m.message));
      else if (m.type === 'pair') {
        counters.pairs++;
        counters.maxMs = Math.max(counters.maxMs, m.ms);
        processor?.port.postMessage(m, [m.vocalL.buffer, m.vocalR.buffer, m.instL.buffer, m.instR.buffer]);
      } else if (m.type === 'skip') { counters.skips++; processor?.port.postMessage(m); }
    };
    worker.onerror = ({message}) => reject(new Error(message));
  });
  worker.postMessage({type: 'init', modelUrl: MODEL});

  function disconnect() {
    if (closed) return;
    closed = true;
    processor?.port.postMessage({type: 'stop'});
    pitch?.port.postMessage('stop');
    processor?.port.close();
    pitch?.port.close();
    for (const node of nodes) node.disconnect();
    worker.terminate();
  }

  try {
    const started = await ready;
    // Reuse the delay this machine used last time so the monitor and the
    // separator play the same sample; grow it if this session measured slower.
    const delay = Math.max(delayFor(Number(started.pairMs) || 0), Number(preferredDelay) || 0);
    status('loading', 'Starting audio');
    await Promise.all([ctx.audioWorklet.addModule(WORKLET), ctx.audioWorklet.addModule(PITCH)]);
    const source = ctx.createMediaStreamSource(stream);
    nodes.push(source);
    processor = new AudioWorkletNode(ctx, 'ruang-nada-separator', {
      channelCountMode: 'clamped-max', channelCount: 2, outputChannelCount: [2],
      processorOptions: {delay},
    });
    pitch = new AudioWorkletNode(ctx, 'ruang-nada-pitch', {
      channelCountMode: 'clamped-max', channelCount: 2, outputChannelCount: [2],
    });
    nodes.push(processor, pitch);
    const output = ctx.createGain();
    output.gain.value = initialGain;
    nodes.push(output);
    source.connect(processor).connect(pitch).connect(output).connect(ctx.destination);

    processor.port.onmessage = ({data: m}) => {
      if (m.type === 'chunk') {
        counters.fromWorklet++;
        worker.postMessage({type: 'chunk', index: m.index, l: m.l, r: m.r}, [m.l.buffer, m.r.buffer]);
      } else if (m.type === 'stats') {
        if (m.played) { counters.played = m.played; counters.misses = m.misses; }
        stats(m);
      }
    };
    processor.port.start();
    status('running', 'Separator running');
    return {
      node: output,
      delay,
      counters,
      setMix(value) { processor?.port.postMessage({type: 'mix', value: Number(value) || 0}); },
      setMode(mode) { processor?.port.postMessage({type: 'mode', value: mode === 'vocal' ? 'vocal' : 'instrumental'}); },
      setPitch(semitones) { pitch?.port.postMessage(Math.max(-12, Math.min(12, Number(semitones) || 0))); },
      disconnect,
    };
  } catch (error) {
    status('error', error.message);
    disconnect();
    throw error;
  }
}

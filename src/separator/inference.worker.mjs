import {SAMPLE_RATE} from './dsp.mjs';
import {BLOCK, MAX_DELAY_MS} from './timing.mjs';
import {loadModel} from './model.mjs';
import {createGate, mean} from './gate.mjs';
import {createStream} from './stream.mjs';

const post = (msg, transfer) => self.postMessage(msg, transfer || []);
const status = (state, message) => post({type: 'status', state, message});

let model, stream, slow = false;
const fallback = message => {
  if (slow) return;
  slow = true;
  status('fallback', message);
};

async function init(modelUrl) {
  model = await loadModel(modelUrl, {onStatus: status});
  post({type: 'ready', initMs: model.initMs, inferMs: model.inferMs});
}

function start({frames, gateMs}) {
  const regionMs = frames * BLOCK / SAMPLE_RATE * 1000;
  // Latency: one region, DSP included, must fit in the slack the delay leaves.
  const gate = createGate({
    limit: gateMs,
    onSlow: p95 => fallback(`Slow GPU: ${Math.round(p95)} ms per ${Math.round(regionMs)} ms of audio, over the ${Math.round(gateMs)} ms a ${MAX_DELAY_MS} ms delay allows`),
  });
  // Throughput: regions that take longer than their audio, DSP included, make
  // the stream skip regions that then play unseparated.
  const throughput = createGate({
    limit: regionMs,
    minimum: 10,
    stat: mean,
    onSlow: avg => fallback(`Slow GPU: ${Math.round(avg)} ms per ${Math.round(regionMs)} ms of audio, too slow to keep up`),
  });
  stream = createStream({
    frames,
    historyFrames: model.frames,
    infer: model.run,
    post,
    onStep: ms => { gate.push(ms); throughput.push(ms); return slow; },
  });
}

self.onmessage = ({data: m}) => {
  if (m.type === 'init') {
    init(m.modelUrl).catch((error) => {
      status('error', error.message);
      post({type: 'failed', message: error.message});
    });
  } else if (m.type === 'plan') start(m);
  else if (m.type === 'block') stream?.push(m.index, m.l, m.r).catch(error => status('error', error.message));
};

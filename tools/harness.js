import {createSeparator} from '../src/separator/engine.mjs';

const $ = (s) => document.querySelector(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (s) => { $('#status').textContent = s; };
const report = {status: [], inference: [], latency: [], queueMax: 0};
let lastLatencyAt = 0;

const ctx = new AudioContext({sampleRate: 44100, latencyHint: 'interactive'});
const splitter = ctx.createChannelSplitter(2);
const taps = [ctx.createAnalyser(), ctx.createAnalyser()];
for (const a of taps) {
  a.fftSize = 16384;
  a.smoothingTimeConstant = 0;
  splitter.connect(a);
}
const capture = new MediaStreamAudioDestinationNode(ctx, {channelCount: 2});
splitter.connect(capture);
const buf = new Float32Array(taps[0].fftSize);

let engine;

function toneStream() {
  const dest = new MediaStreamAudioDestinationNode(ctx, {channelCount: 2});
  const gC = ctx.createGain(); gC.gain.value = 0.18;
  const gS = ctx.createGain(); gS.gain.value = 0.18;
  const center = ctx.createOscillator(); center.frequency.value = 800;
  const side = ctx.createOscillator(); side.frequency.value = 3000;
  const inv = ctx.createGain(); inv.gain.value = -1;
  const merge = ctx.createChannelMerger(2);
  center.connect(gC).connect(merge, 0, 0);
  center.connect(gC).connect(merge, 0, 1);
  side.connect(gS).connect(merge, 0, 0);
  gS.connect(inv).connect(merge, 0, 1);
  merge.connect(dest);
  center.start(); side.start();
  return dest.stream;
}

async function fileStream(file) {
  const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
  const dest = new MediaStreamAudioDestinationNode(ctx, {channelCount: 2});
  const src = ctx.createBufferSource();
  src.buffer = buffer; src.loop = true;
  src.connect(dest); src.start();
  return dest.stream;
}

function band(freq) {
  const w = 2 * Math.PI * freq / ctx.sampleRate;
  const c = 2 * Math.cos(w), s = Math.sin(w);
  let power = 0;
  for (const a of taps) {
    a.getFloatTimeDomainData(buf);
    let q0 = 0, q1 = 0, q2 = 0;
    for (const x of buf) { q0 = c * q1 - q2 + x; q2 = q1; q1 = q0; }
    power += (q1 * q1 + q2 * q2 - c * q1 * q2) / buf.length;
  }
  return 10 * Math.log10(power + 1e-15);
}

function rms() {
  let e = 0;
  for (const a of taps) {
    a.getFloatTimeDomainData(buf);
    for (const x of buf) e += x * x;
  }
  return Math.sqrt(e / (buf.length * taps.length));
}

async function settle(ms) {
  await sleep(Math.max(ms, (report.latencyMean || 1900) + 500));
  const t0 = performance.now();
  while (performance.now() - t0 < 12000 && performance.now() - lastLatencyAt > 900) await sleep(200);
  await sleep(400);
}

async function measureBands() {
  const runs = [];
  for (let i = 0; i < 4; i++) { runs.push([band(800), band(3000)]); await sleep(120); }
  runs.sort((a, b) => b[0] + b[1] - (a[0] + a[1]));
  return {f800: runs[2][0], f3000: runs[2][1]};
}

async function run() {
  try {
    $('#run').disabled = true;
    if (!navigator.gpu) throw new Error('navigator.gpu missing');
    const file = $('#file').files[0];
    const stream = file ? await fileStream(file) : toneStream();
    if (ctx.state !== 'running') await ctx.resume();

    const t0 = performance.now();
    engine = await createSeparator({
      ctx, stream,
      onStatus(state, message) {
        report.status.push(`${state}: ${message}`);
        log(`${state}: ${message}`);
      },
      onStats(s) {
        if (s.ms != null) {
          report.inference.push(s.ms);
          const row = document.createElement('tr');
          row.innerHTML = `<td>${s.ms.toFixed(1)}</td><td>${s.queue}</td><td>${report.latency.at(-1)?.toFixed(0) ?? ''}</td>`;
          $('#stats tbody').append(row);
          report.queueMax = Math.max(report.queueMax, s.queue);
          if (s.gate) log('fallback reported (slow GPU)');
        }
        if (s.latency != null && s.latency > 0) { report.latency.push(s.latency); report.lastMode = s.mode; report.lastWet = s.wet; lastLatencyAt = performance.now(); }
      },
    });
    report.initMs = performance.now() - t0;
    engine.node.connect(splitter);
    engine.setMix(1);
    engine.setMode('instrumental');

    const waitStart = performance.now();
    while (!report.latency.length && performance.now() - waitStart < 30000) await sleep(200);
    report.latencyMean = report.latency.length ? report.latency.reduce((a, b) => a + b, 0) / report.latency.length : 0;
    await settle(1200);

    report.warmupSkipped = report.inference.length;
    report.inference = [];
    $('#stats tbody').replaceChildren();
    while (report.inference.length < 8) await sleep(100);
    report.instrumental = await measureBands();
    report.instMode = report.lastMode;
    report.signalRms = rms();

    engine.setMode('vocal');
    await settle(1500);
    report.vocal = await measureBands();
    report.vocalRms = rms();
    report.vocalMode = report.lastMode;

    const latBefore = report.latency.length;
    const infBefore = report.inference.length;
    engine.setPitch(5);
    await sleep(3000);
    const pitchLat = report.latency.slice(latBefore);
    report.pitch = {
      inferenceAfter: report.inference.length - infBefore,
      latencyAfter: pitchLat.length,
      latencyMax: pitchLat.length ? Math.max(...pitchLat) : 0,
    };
    engine.setPitch(0);

    const xs = [...report.inference].sort((a, b) => a - b);
    report.mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    report.p95 = xs[Math.min(xs.length - 1, Math.floor((xs.length - 1) * 0.95))];
    report.plan = engine.plan;
    report.budget = engine.plan.gateMs;
    report.keepsUp = report.p95 < report.budget && engine.counters.misses === 0;
    report.latencyMean = report.latency.length ? report.latency.reduce((a, b) => a + b, 0) / report.latency.length : 0;
    report.latencyMax = report.latency.length ? Math.max(...report.latency) : 0;
    report.tilt = {instrumental: report.instrumental.f800 - report.instrumental.f3000, vocal: report.vocal.f800 - report.vocal.f3000};
    report.ok = report.signalRms > 0.001 && report.tilt.instrumental < -3 && report.tilt.vocal > 3;

    $('#out').textContent = JSON.stringify(report, null, 2);
    log('done');
    window.__report = report;
  } catch (error) {
    report.error = error.message;
    log(`error: ${error.message}`);
    window.__report = report;
  }
}

$('#run').onclick = run;
window.runHarness = run;
if (new URLSearchParams(location.search).has('auto')) run();

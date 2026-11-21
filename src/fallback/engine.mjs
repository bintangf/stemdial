export async function createEngine(ctx, stream) {
  await ctx.audioWorklet.addModule(new URL('./fallback.worklet.mjs', import.meta.url));
  const nodes = [];
  function own(node) { nodes.push(node); return node; }
  let processor, closed = false;
  function disconnect() {
    if (closed) return;
    closed = true;
    if (processor) {
      processor.port.postMessage('stop');
      processor.port.close();
    }
    for (const node of nodes) node.disconnect();
  }

  try {
    const source = own(ctx.createMediaStreamSource(stream));
    processor = own(new AudioWorkletNode(ctx, 'ruang-nada-stereo-pitch', {
      channelCountMode: 'clamped-max', channelCount: 2, outputChannelCount: [2],
    }));
    const compressor = own(ctx.createDynamicsCompressor());
    compressor.threshold.value = -5;
    compressor.knee.value = 3;
    compressor.ratio.value = 16;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.12;
    // Bound transients during the compressor's attack; leave quiet samples linear.
    const ceiling = own(ctx.createWaveShaper());
    ceiling.curve = Float32Array.from({length: 2049}, (_, i) => {
      const x = i / 1024 - 1, a = Math.abs(x);
      return a <= 0.9 ? x : Math.sign(x) * (0.9 + 0.09 * Math.tanh((a - 0.9) / 0.09));
    });
    source.connect(processor).connect(compressor).connect(ceiling).connect(ctx.destination);

    function set(settings = {}) {
      if (closed) return;
      function adjust(param, value, min, max) {
        if (Number.isFinite(value)) {
          param.setTargetAtTime(Math.min(max, Math.max(min, value)), ctx.currentTime, 0.012);
        }
      }
      adjust(processor.parameters.get('semitones'), settings.semitones, -12, 12);
      adjust(processor.parameters.get('center'), settings.center, -1, 1);
    }
    return {set, disconnect};
  } catch (error) {
    disconnect();
    throw error;
  }
}

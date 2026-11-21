export async function createEngine(ctx, stream, output = ctx.destination) {
  await ctx.audioWorklet.addModule(new URL('./center.worklet.mjs', import.meta.url));
  await ctx.audioWorklet.addModule(new URL('./pitch.worklet.mjs', import.meta.url));
  const nodes = [];
  function own(node) { nodes.push(node); return node; }
  let center, pitch, closed = false;
  function disconnect() {
    if (closed) return;
    closed = true;
    center?.port.postMessage('stop');
    center?.port.close();
    pitch?.port.postMessage('stop');
    pitch?.port.close();
    for (const node of nodes) node.disconnect();
  }

  try {
    const source = own(ctx.createMediaStreamSource(stream));
    center = own(new AudioWorkletNode(ctx, 'ruang-nada-center', {
      channelCountMode: 'clamped-max', channelCount: 2, outputChannelCount: [2],
    }));
    pitch = own(new AudioWorkletNode(ctx, 'ruang-nada-fallback-pitch', {
      channelCountMode: 'clamped-max', channelCount: 2, outputChannelCount: [2],
    }));
    source.connect(center).connect(pitch).connect(output);

    function set(settings = {}) {
      if (closed) return;
      const value = Number(settings.center);
      if (Number.isFinite(value)) {
        center.parameters.get('center').setTargetAtTime(Math.min(1, Math.max(-1, value)), ctx.currentTime, 0.012);
      }
      const semitones = Number(settings.semitones);
      if (Number.isFinite(semitones)) pitch.port.postMessage(Math.max(-12, Math.min(12, semitones)));
    }
    return {set, disconnect};
  } catch (error) {
    disconnect();
    throw error;
  }
}

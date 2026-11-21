const FADE = 0.02;

export function createMonitor(ctx, stream, delayMs, maxDelayMs = delayMs) {
  const source = ctx.createMediaStreamSource(stream);
  const delay = ctx.createDelay(maxDelayMs / ctx.sampleRate + 0.05);
  const gain = ctx.createGain();
  delay.delayTime.value = delayMs / ctx.sampleRate;
  source.connect(delay).connect(gain).connect(ctx.destination);
  let closed = false;

  function close() {
    if (closed) return;
    closed = true;
    source.disconnect();
    delay.disconnect();
    gain.disconnect();
  }

  return {
    latencyMs: Math.round(delayMs / ctx.sampleRate * 1000),
    fadeTo(node) {
      if (closed) return;
      const now = ctx.currentTime;
      gain.gain.setValueAtTime(1, now).linearRampToValueAtTime(0, now + FADE);
      node.gain.setValueAtTime(0, now).linearRampToValueAtTime(1, now + FADE);
      setTimeout(close, 100);
    },
    close,
  };
}

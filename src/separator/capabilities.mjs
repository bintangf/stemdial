export async function requireSeparatorSupport(ctx, status) {
  if (ctx.sampleRate !== 44100) {
    status('fallback', `AudioContext is ${ctx.sampleRate} Hz, model needs 44100`);
    throw new Error(`Unsupported sample rate ${ctx.sampleRate}`);
  }
  if (!navigator.gpu) {
    status('fallback', 'WebGPU unavailable');
    throw new Error('WebGPU unavailable');
  }
  const adapter = await navigator.gpu.requestAdapter({powerPreference: 'high-performance'});
  if (!adapter) {
    status('fallback', 'No WebGPU adapter');
    throw new Error('No WebGPU adapter');
  }
}

export const CHUNK = 4096;
export const RATE = 44100;
// A pair costs the pair itself plus one chunk of analysis lookahead; the read
// head sits three chunks behind the writer and each further chunk adds slack.
export const MIN_CHUNKS = 4;
export const MAX_CHUNKS = 6;
export const MAX_DELAY = MAX_CHUNKS * CHUNK;
// One inference covers two chunks, so the worker must finish a pair, DSP
// included, within two chunks of audio on average or its queue overflows.
export const PAIR_BUDGET_MS = 2 * CHUNK / RATE * 1000;
// Inference is the only part that may overrun the longest buffer.
export const MAX_INFERENCE_MS = (MAX_CHUNKS - 3) * CHUNK / RATE * 1000 * 0.95;

export function delayChunks(pairMs) {
  const perChunk = CHUNK / RATE * 1000;
  const need = 3 + (pairMs + 20) / perChunk;
  return Math.min(MAX_CHUNKS, Math.max(MIN_CHUNKS, Math.ceil(need)));
}

export const delayFor = pairMs => delayChunks(pairMs) * CHUNK;

// About -60 dBFS. Below this a region is treated as silence, so the model's
// noise floor cannot leak into the mix as hiss.
export const SILENCE_RMS = 1e-3;

export function pairRms(chunks) {
  let sum = 0, count = 0;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i];
    count += chunk.length;
  }
  return count ? Math.sqrt(sum / count) : 0;
}

export const isSilentPair = (...chunks) => pairRms(chunks) < SILENCE_RMS;

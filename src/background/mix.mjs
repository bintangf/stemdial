export const DEFAULT_MIX = Object.freeze({semitones: 0, center: 1, mode: 1});
export const MODES = Object.freeze([-1, 0, 1]);

export const modeOf = mix => MODES.includes(mix?.mode) ? mix.mode : Math.sign(mix?.center ?? 0) || 1;

export function normalizeMix(saved) {
  const base = saved || {};
  const mix = {...DEFAULT_MIX, ...base};
  return {...mix, mode: MODES.includes(base.mode) ? base.mode : Math.sign(mix.center) || 1};
}

export const reductionKey = mode => `reduction${mode}`;

export const persistedEdit = (mode, strength) => mode ? {[reductionKey(mode)]: strength} : {};

export function editFrom({mode, strength, pitch}) {
  if (!MODES.includes(mode) || !Number.isInteger(strength) || strength < 0 || strength > 100
      || !Number.isInteger(pitch) || Math.abs(pitch) > 12) throw Error('Invalid audio settings');
  return {mode, center: strength ? mode * strength / 100 : 0, semitones: pitch};
}

export function createSettings(area) {
  return {
    async load() { return normalizeMix((await area.get('mix')).mix); },
    async save(mix) { await area.set({mix}); },
  };
}

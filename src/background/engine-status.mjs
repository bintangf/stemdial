export function createEngineStatus({storage, broadcast, initial = {state: null, message: ''}}) {
  let state = initial;
  let dirty = false;
  return {
    get: () => state,
    async restore() {
      try {
        const saved = (await storage.get('engineState')).engineState;
        if (saved && !dirty) state = saved;
      } catch {}
      return state;
    },
    set(patch) {
      dirty = true;
      state = {...state, ...patch};
      storage.set({engineState: state}).catch(() => {});
      broadcast(state);
    },
  };
}

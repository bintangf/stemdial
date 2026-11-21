export function createSession({audio, capture, offscreen, storage, status, badge}) {
  async function live() {
    if (!(await audio.hasDocument())) return null;
    try { return await audio.request('status'); } catch { return null; }
  }

  async function stop(tabId = null) {
    try {
      if (await audio.hasDocument()) {
        try { await audio.request('stop'); } finally { await offscreen.close(); }
      }
    } finally {
      status.set({state: null, message: '', latency: null});
      if (tabId != null) await badge(tabId, null).catch(() => {});
    }
  }

  async function activate(tab, mix) {
    const existing = await audio.hasDocument();
    const old = existing ? await audio.request('status') : null;
    if (old?.tabId === tab.id) return stop(old.tabId);
    status.set({state: 'loading', message: '', latency: null});
    if (!existing) await offscreen.open();
    try {
      const streamId = await capture.streamId(tab.id);
      const {sepDelay, enginePolicy} = await storage.get(['sepDelay', 'enginePolicy']);
      await audio.request('start', {streamId, tabId: tab.id, mix, sepDelay, policy: enginePolicy || 'auto'});
    } catch (error) {
      if (!existing) await offscreen.close();
      throw error;
    }
    if (old?.tabId != null) await badge(old.tabId, null).catch(() => {});
    await badge(tab.id, mix);
    await storage.set({mix});
  }

  async function restart(tab, mix) {
    await stop(tab.id);
    try { await activate(tab, mix); }
    catch (error) { status.set({state: 'error', message: error.message, latency: null}); throw error; }
  }

  return {
    live,
    stop,
    activate,
    restart,
    setMix: mix => audio.request('set', {mix}),
    async apply(tabId, mix) {
      await audio.request('set', {mix});
      await badge(tabId, mix);
    },
  };
}

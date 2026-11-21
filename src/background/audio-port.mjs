export function createAudioPort(chrome) {
  const hasDocument = async () => (await chrome.runtime.getContexts({contextTypes: ['OFFSCREEN_DOCUMENT']})).length > 0;

  async function request(op, data = {}) {
    const reply = await chrome.runtime.sendMessage({to: 'audio', op, ...data});
    if (!reply?.ok) throw new Error(reply?.message || 'Audio engine did not respond');
    return reply;
  }

  return {
    hasDocument,
    request,
  };
}

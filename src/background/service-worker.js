import {createSettings} from './mix.mjs';
import {createEngineStatus} from './engine-status.mjs';
import {createAudioPort} from './audio-port.mjs';
import {createBadge} from './badge.mjs';
import {createSession} from './session.mjs';
import {createPanel} from './panel.mjs';

export function createWorker(chrome) {
  const status = createEngineStatus({
    storage: chrome.storage.session,
    broadcast: engine => chrome.runtime.sendMessage({to: 'panel', op: 'engine', engine}).catch(() => {}),
  });
  status.restore();

  const audio = createAudioPort(chrome);
  const settings = createSettings(chrome.storage.local);
  const badge = createBadge(chrome.action);
  const local = {
    get: keys => chrome.storage.local.get(keys),
    set: values => chrome.storage.local.set(values),
  };
  const session = createSession({
    audio,
    capture: {streamId: targetTabId => chrome.tabCapture.getMediaStreamId({targetTabId})},
    offscreen: {
      open: () => chrome.offscreen.createDocument({
        url: 'src/offscreen/offscreen.html',
        reasons: ['USER_MEDIA'],
        justification: 'Process and play the selected tab audio.',
      }),
      close: () => chrome.offscreen.closeDocument(),
    },
    storage: local,
    status,
    badge,
  });
  const panel = createPanel({
    session,
    settings,
    storage: local,
    tabs: chrome.tabs,
    status,
    popupUrl: chrome.runtime.getURL('src/popup/popup.html'),
  });

  chrome.runtime.onMessage.addListener((message, sender, reply) => panel.receive(message, sender, reply));

  chrome.runtime.onMessage.addListener(message => {
    if (message.to !== 'worker') return;
    if (message.op === 'engine-status') status.set({state: message.state, message: message.message || ''});
    if (message.op === 'latency') status.set({latency: Math.round(message.ms)});
    if (message.op === 'sep-delay') chrome.storage.local.set({sepDelay: message.delay}).catch(() => {});
    if (message.op === 'ended') panel.enqueue(async () => {
      if (await audio.hasDocument() && (await audio.request('status')).tabId === message.tabId) await session.stop(message.tabId);
    }, async error => {
      console.error(error);
      await chrome.action.setTitle({tabId: message.tabId, title: `StemDial: ${error.message}`});
      await chrome.action.setBadgeText({tabId: message.tabId, text: '!'});
    });
  });

  return {session, panel, status};
}

if (globalThis.chrome?.runtime?.onMessage) createWorker(globalThis.chrome);

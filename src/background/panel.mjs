import {editFrom, persistedEdit} from './mix.mjs';

const EDIT_OPS = new Set(['apply', 'save', 'preview']);

export function createPanel({session, settings, storage, tabs, status, popupUrl}) {
  let tail = Promise.resolve();

  async function respond(message) {
    const [tab] = await tabs.query({active: true, lastFocusedWindow: true});
    if (!tab?.id || tab.id !== message.tabId) throw Error('Active tab changed. Reopen StemDial.');

    const live = await session.live();
    let current = live?.tabId ?? null;
    let mix = current === tab.id && live.mix ? live.mix : await settings.load();

    if (EDIT_OPS.has(message.op)) {
      mix = {...mix, ...editFrom(message)};
      if (message.op === 'preview') {
        if (current === tab.id) await session.setMix(mix);
      } else if (message.op === 'save') {
        await storage.set({mix, ...persistedEdit(message.mode, message.strength)});
        if (current === tab.id) await session.apply(tab.id, mix);
      } else {
        if (current !== tab.id) await session.activate(tab, mix);
        else {
          await session.apply(tab.id, mix);
          await settings.save(mix);
        }
        current = tab.id;
      }
    } else if (message.op === 'stop' && current === tab.id) {
      await session.stop(current);
      current = null;
    }

    return {active: current === tab.id, mix, engine: status.get()};
  }

  function receive(message, sender, reply) {
    if (message.to !== 'panel' || sender.url !== popupUrl) return false;
    // Status is read-only, so it answers now instead of queuing behind a model load.
    if (message.op === 'status') {
      (async () => {
        let live = null;
        try { live = await session.live(); } catch {}
        return {active: live?.tabId === message.tabId, mix: live?.mix ?? await settings.load(), engine: status.get()};
      })().then(reply, error => reply({error: error.message}));
      return true;
    }
    const job = tail.then(() => respond(message));
    tail = job.then(reply, error => reply({error: error.message}));
    return true;
  }

  function enqueue(task, onError = console.error) {
    tail = tail.then(task).catch(onError).catch(console.error);
  }

  return {receive, enqueue};
}

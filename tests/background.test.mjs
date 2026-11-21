import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createWorker} from '../src/background/service-worker.js';
import {DEFAULT_MIX, normalizeMix, editFrom, persistedEdit, modeOf} from '../src/background/mix.mjs';

function harness({engineState} = {}) {
  const listeners = [], store = {}, tab = {id: 1}, sessionStore = engineState ? {engineState} : {};
  let doc = false, live = null;
  const chrome = {
    tabs: {query: async () => [tab]},
    storage: {
      local: {get: async () => store, set: async values => Object.assign(store, values)},
      session: {get: async key => ({[key]: sessionStore[key]}), set: async values => Object.assign(sessionStore, values)},
    },
    action: {setBadgeText: async () => {}, setTitle: async () => {}},
    offscreen: {createDocument: async () => { doc = true; }, closeDocument: async () => { doc = false; live = null; }},
    tabCapture: {getMediaStreamId: async ({targetTabId}) => { if (targetTabId === 2) throw Error('Denied'); return 'stream'; }},
    runtime: {
      getURL: path => 'extension/' + path,
      onMessage: {addListener: listener => listeners.push(listener)},
      getContexts: async () => doc ? [{}] : [],
      sendMessage: async message => {
        if (message.op === 'start') live = {tabId: message.tabId, mix: message.mix};
        if (message.op === 'set') live = {...live, mix: message.mix};
        if (message.op === 'stop') live = null;
        return {ok: true, ...live};
      },
    },
  };
  const worker = createWorker(chrome);
  const panel = (op, mode = 1, strength = 100, pitch = 0, tabId = tab.id) => new Promise(resolve => listeners[0](
    {to: 'panel', tabId, op, mode, strength, pitch},
    {url: 'extension/src/popup/popup.html'},
    resolve,
  ));
  return {panel, tab, store, worker, listeners};
}

test('mix model normalizes old saved settings and keeps an explicit full mix', () => {
  assert.deepEqual(normalizeMix(undefined), {...DEFAULT_MIX});
  assert.equal(normalizeMix({center: -0.4, semitones: -2}).mode, -1);
  assert.equal(normalizeMix({center: 0.4}).mode, 1);
  assert.equal(modeOf({mode: 0, center: 0}), 0);
  assert.equal(modeOf({}), 1);
});

test('an edit maps mode and strength onto center, and mode zero drops the reduction key', () => {
  assert.deepEqual(editFrom({mode: -1, strength: 40, pitch: 3}), {mode: -1, center: -0.4, semitones: 3});
  assert.equal(editFrom({mode: 1, strength: 0, pitch: 0}).center, 0);
  assert.equal(editFrom({mode: 0, strength: 100, pitch: 0}).center, 0);
  assert.deepEqual(persistedEdit(-1, 0), {'reduction-1': 0});
  assert.deepEqual(persistedEdit(0, 50), {});
  assert.throws(() => editFrom({mode: 2, strength: 100, pitch: 0}), /Invalid audio settings/);
  assert.throws(() => editFrom({mode: 1, strength: 100.5, pitch: 0}), /Invalid audio settings/);
  assert.throws(() => editFrom({mode: 1, strength: 100, pitch: -13}), /Invalid audio settings/);
});

test('the popup is the only control surface', () => {
  const source = readFileSync(new URL('../src/background/service-worker.js', import.meta.url), 'utf8');
  assert.ok(!/contextMenus|chrome\.commands/.test(source));
});

test('apply starts capture and persists the mix', async () => {
  const h = harness();
  const reply = await h.panel('apply');
  assert.equal(reply.active, true);
  assert.equal(h.store.mix.mode, 1);
  assert.equal(h.store.mix.center, 1);
  assert.equal((await h.panel('status')).active, true);
});

test('denied handoff preserves running capture', async () => {
  const h = harness();
  await h.panel('apply');
  h.tab.id = 2;
  assert.match((await h.panel('apply')).error, /Denied/);
  h.tab.id = 1;
  assert.equal((await h.panel('status')).active, true);
});

test('pitch previews change live audio without persisting each value or restarting stopped capture', async () => {
  const h = harness();
  await h.panel('apply');
  await h.panel('preview', 1, 100, 5);
  assert.equal((await h.panel('status')).mix.semitones, 5);
  assert.equal(h.store.mix.semitones, 0);
  await h.panel('save', 1, 100, 7);
  assert.equal(h.store.mix.semitones, 7);
  await h.panel('stop');
  assert.equal((await h.panel('preview', 1, 100, 9)).active, false);
});

test('saving a zero-strength mode keeps the mode selectable', async () => {
  const h = harness();
  await h.panel('save', -1, 0);
  assert.equal(h.store.mix.mode, -1);
  assert.equal(h.store.mix.center, 0);
  assert.equal(h.store['reduction-1'], 0);
});

test('invalid settings are rejected before they reach the engine', async () => {
  const h = harness();
  assert.match((await h.panel('apply', 1, 101)).error, /Invalid audio settings/);
  assert.equal(h.store.mix, undefined);
});

test('a stale tab is rejected instead of controlling another tab', async () => {
  const h = harness();
  const stale = h.panel('apply', 1, 100, 0, 1);
  h.tab.id = 2;
  assert.match((await stale).error, /Active tab changed/);
});

test('engine events update the status the popup reads', async () => {
  const h = harness();
  h.listeners[1]({to: 'worker', op: 'engine-status', state: 'loading', message: 'Loading model'});
  assert.deepEqual((await h.panel('status')).engine, {state: 'loading', message: 'Loading model'});
  h.listeners[1]({to: 'worker', op: 'latency', ms: 372.6});
  assert.equal((await h.panel('status')).engine.latency, 373);
  h.listeners[1]({to: 'worker', op: 'sep-delay', delay: 16384});
  assert.equal(h.store.sepDelay, 16384);
});

test('a persisted engine state survives a worker restart', async () => {
  const saved = harness({engineState: {state: 'ai', message: ''}});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(saved.worker.status.get().state, 'ai');
});

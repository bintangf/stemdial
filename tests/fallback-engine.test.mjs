import test from 'node:test';
import assert from 'node:assert/strict';
import {createEngine} from '../src/fallback/engine.mjs';

class FakeNode {
  constructor(name) {
    this.name = name;
    this.connections = [];
    this.disconnected = false;
    this.targets = {};
    const port = {messages: [], closed: false, postMessage: m => port.messages.push(m)};
    port.close = () => { port.closed = true; };
    this.port = port;
    this.parameters = {get: name => ({setTargetAtTime: (value, at, constant) => { this.targets[name] = {value, at, constant}; }})};
  }
  connect(next) { this.connections.push(next); return next; }
  disconnect() { this.disconnected = true; }
}

class FakeSource extends FakeNode {
  constructor() { super('source'); }
}

const nodes = [], sources = [], modules = [];
globalThis.AudioWorkletNode = class extends FakeNode {
  constructor(ctx, name) { super(name); nodes.push(this); }
};

const ctx = {
  currentTime: 2,
  destination: {name: 'destination'},
  audioWorklet: {addModule: async url => { modules.push(String(url)); }},
  createMediaStreamSource: () => { const source = new FakeSource(); sources.push(source); return source; },
};

test('the fallback graph is source → centre → pitch → output and disconnects cleanly', async () => {
  const output = {name: 'output'};
  const engine = await createEngine(ctx, {}, output);
  assert.equal(modules.length, 2);
  assert.ok(modules[0].endsWith('center.worklet.mjs'));
  assert.ok(modules[1].endsWith('pitch.worklet.mjs'));
  assert.equal(sources[0].connections[0], nodes[0]);
  assert.equal(nodes[0].name, 'ruang-nada-center');
  assert.equal(nodes[0].connections[0], nodes[1]);
  assert.equal(nodes[1].name, 'ruang-nada-fallback-pitch');
  assert.equal(nodes[1].connections[0], output);

  engine.set({center: 0.5, semitones: 7});
  assert.deepEqual(nodes[0].targets.center, {value: 0.5, at: 2, constant: 0.012});
  assert.deepEqual(nodes[1].port.messages, [7]);

  engine.disconnect();
  assert.deepEqual(nodes[0].port.messages, ['stop']);
  assert.deepEqual(nodes[1].port.messages, [7, 'stop']);
  assert.ok(nodes[0].port.closed && nodes[1].port.closed);
  assert.ok(sources[0].disconnected && nodes[0].disconnected && nodes[1].disconnected);
});

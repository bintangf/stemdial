import assert from 'node:assert/strict';
import test from 'node:test';
import {BINS} from '../src/separator/dsp.mjs';
import {BLOCK, LOOKAHEAD} from '../src/separator/timing.mjs';
import {createStream} from '../src/separator/stream.mjs';

const HISTORY = 32;
const tone = (i, ch) => ch
  ? 0.3 * Math.sin(2 * Math.PI * 777 * i / 44100) + 0.2 * Math.sin(2 * Math.PI * 5900 * i / 44100)
  : 0.3 * Math.sin(2 * Math.PI * 512 * i / 44100) + 0.2 * Math.sin(2 * Math.PI * 3100 * i / 44100);

// Blocks arrive one at a time and inference keeps up, as in real time.
async function run({frames, blocks, infer = async input => input}) {
  const posts = [];
  const stream = createStream({frames, historyFrames: HISTORY, infer, post: m => posts.push(m)});
  for (let b = 0; b < blocks; b++) {
    const l = Float32Array.from({length: BLOCK}, (_, i) => tone(b * BLOCK + i, 0));
    const r = Float32Array.from({length: BLOCK}, (_, i) => tone(b * BLOCK + i, 1));
    await stream.push(b, l, r);
  }
  return posts;
}

for (const frames of [4, 6]) {
  test(`an identity model rebuilds the source with ${LOOKAHEAD} samples of lookahead (${frames} frames)`, async () => {
    const posts = await run({frames, blocks: 40});
    const regions = posts.filter(m => m.type === 'region');
    assert.equal(regions.length, Math.floor((40 * BLOCK - LOOKAHEAD) / (frames * BLOCK)));
    let max = 0;
    regions.forEach((m, n) => {
      assert.equal(m.index, n * frames);
      if (n < 2) return; // the first region has no earlier frames to overlap
      for (let i = 0; i < frames * BLOCK; i++) {
        const at = m.index * BLOCK + i;
        max = Math.max(max, Math.abs(m.vocalL[i] / 2.3 - 1.025 * tone(at, 0)), Math.abs(m.vocalR[i] / 2.3 - 1.025 * tone(at, 1)));
        assert.ok(Math.abs(m.instL[i] + 0.025 * tone(at, 0)) < 1e-3);
      }
    });
    assert.ok(max < 1e-3, `max rebuild error ${max}`);
  });
}

test('each inference sees a full history with the newest frame last', async () => {
  const seen = [];
  await run({frames: 4, blocks: 60, infer: async input => { seen.push(input.slice()); return input; }});
  const last = seen.at(-1);
  assert.equal(last.length, 4 * BINS * HISTORY);
  // Bin 10 of the left real part is non-zero for every frame once the history is full.
  for (let t = 0; t < HISTORY; t++) assert.notEqual(last[10 * HISTORY + t], 0);
});

test('a gap in the block index restarts the stream at the new position', async () => {
  const posts = [];
  const stream = createStream({frames: 4, historyFrames: HISTORY, infer: async x => x, post: m => posts.push(m)});
  const block = new Float32Array(BLOCK).fill(0.1);
  for (let b = 0; b < 10; b++) await stream.push(b, block, block);
  for (let b = 100; b < 110; b++) await stream.push(b, block, block);
  const indexes = posts.filter(m => m.type === 'region').map(m => m.index);
  assert.deepEqual(indexes, [0, 4, 100, 104]);
});

test('a backlog skips a region instead of falling further behind', async () => {
  const posts = [];
  let release;
  const stream = createStream({
    frames: 4, historyFrames: HISTORY, post: m => posts.push(m),
    infer: x => new Promise(resolve => { release = () => resolve(x); }),
  });
  const block = new Float32Array(BLOCK).fill(0.1);
  const pending = [];
  for (let b = 0; b < 16; b++) pending.push(stream.push(b, block, block));
  release();
  await new Promise(r => setTimeout(r, 0));
  release();
  await Promise.all(pending);
  const types = posts.map(m => `${m.type}:${m.index}`);
  assert.ok(types.includes('skip:4'), types.join(' '));
  assert.ok(types.includes('region:0') && types.includes('region:8'), types.join(' '));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {Pitch} from '../src/fallback/pitch.mjs';

for (const semitones of [-12, 0, 7, 12]) {
  test(`440 Hz shifted ${semitones} semitones`, () => {
    const rate = 48000, dsp = new Pitch(rate), ratio = 2 ** (semitones / 12);
    let prev = 0, crossings = 0;
    for (let i = 0; i < rate * 2; i++) {
      const x = Math.sin(2 * Math.PI * 440 * i / rate);
      const y = dsp.sample(x, ratio);
      if (!semitones) assert.equal(x, y);
      if (i >= rate && prev <= 0 && y > 0) crossings++;
      prev = y;
    }
    assert.ok(Math.abs(crossings - 440 * ratio) < 2, `${crossings} Hz`);
  });
}

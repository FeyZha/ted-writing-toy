import test from 'node:test';
import assert from 'node:assert/strict';
import {sentenceJump} from '../src/sentence-navigation.ts';
import {sentenceStarts} from '../src/lesson-sentences.ts';

test('left restarts a complete sentence rather than the current subtitle fragment', () => {
  assert.equal(sentenceJump(sentenceStarts, 8, 'previous', null, 1000)?.time, 0);
  assert.equal(sentenceJump(sentenceStarts, 28, 'previous', null, 1000)?.time, 21.751);
});
test('another left press goes to the previous sentence while playback advances', () => {
  const first = sentenceJump(sentenceStarts, 29, 'previous', null, 1000);
  const second = sentenceJump(sentenceStarts, 22.35, 'previous', first, 1600);
  assert.equal(first?.time, 21.751);
  assert.equal(second?.time, 15.529);
  assert.equal(sentenceJump(sentenceStarts, 15.75, 'previous', second, 1850)?.time, 13.377);
});
test('a later left press restarts the sentence being listened to again', () => {
  const last = sentenceJump(sentenceStarts, 29, 'previous', null, 1000);
  assert.equal(sentenceJump(sentenceStarts, 24, 'previous', last, 3500)?.time, 21.751);
});
test('left can step back from a paused sentence start without racing playback', () => {
  const last = sentenceJump(sentenceStarts, 29, 'previous', null, 1000);
  assert.equal(sentenceJump(sentenceStarts, 21.751, 'previous', last, 7000)?.time, 15.529);
});
test('right skips to the next sentence; first and last boundaries stay valid', () => {
  assert.equal(sentenceJump(sentenceStarts, 8, 'next', null, 1000)?.time, 13.377);
  assert.equal(sentenceJump(sentenceStarts, 0, 'previous', null, 1000)?.time, 0);
  assert.equal(sentenceJump(sentenceStarts, 82, 'next', null, 1000), null);
  assert.equal(sentenceJump([], 1, 'previous', null, 1000), null);
});
test('the approved lesson has ordered local sentence starts and no laughter-only stop', () => {
  assert.equal(sentenceStarts.length, 14);
  assert.equal(sentenceStarts[0], 0);
  assert.equal(sentenceStarts.at(-1), 75.854);
  assert.ok(sentenceStarts.every((start, i) => start >= 0 && start < 83.416667 && (i === 0 || start > sentenceStarts[i - 1])));
  assert.ok(!sentenceStarts.includes(63.723));
});

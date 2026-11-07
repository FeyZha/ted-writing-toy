import test from 'node:test';
import assert from 'node:assert/strict';
import { freshSession, loadSession, openReference, parseClipVtt, storeSession } from '../src/session.ts';

const reference = { sourceUrl: 'https://example.com/reference.vtt', retrievedAt: '2026-11-07T00:00:00Z', cues: [{ start: 0, end: 3, text: 'A test sentence.' }] };
test('first reveal fixes the latest draft; later editing and revealing preserve it', () => {
  const first = openReference({ ...freshSession(), step: 'write', summary: 'My latest draft. 中文卡点' }, reference);
  assert.equal(first.initialSummary, 'My latest draft. 中文卡点');
  const later = openReference({ ...first, step: 'write', summary: 'My revision.' }, reference);
  assert.equal(later.initialSummary, first.summary);
  assert.equal(later.summary, 'My revision.');
  assert.equal(later.referenceOpenedAt, first.referenceOpenedAt);
});
test('empty first draft is retained as empty, rather than replaced on another reveal', () => {
  const first = openReference(freshSession(), reference);
  assert.equal(openReference({ ...first, summary: 'A later thought.' }, reference).initialSummary, '');
});
test('persisted compare state contains the frozen draft and reference on reload', () => {
  let raw: string | null = null;
  const storage = { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; } };
  const session = openReference({ ...freshSession(), summary: 'Original draft.' }, reference);
  storeSession(storage, session);
  const loaded = loadSession(storage);
  assert.equal(loaded.blocked, false);
  assert.equal(loaded.session.step, 'compare');
  assert.equal(loaded.session.initialSummary, 'Original draft.');
  assert.deepEqual(loaded.session.reference?.cues, reference.cues);
});
test('unreadable storage is not repaired by overwriting it; failed saves throw', () => {
  let writes = 0;
  const storage = { getItem: () => '{broken', setItem: () => { writes += 1; throw new Error('Quota exceeded'); } };
  assert.equal(loadSession(storage).blocked, true);
  assert.equal(writes, 0);
  assert.throws(() => storeSession(storage, freshSession()), /Quota/);
});
test('clip captions keep only matching original text and use clip-relative times', () => {
  const raw = 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nOutside.\n\n00:00:03.500 --> 00:00:05.000\nThe first\ncomplete sentence.\n\n00:00:05.100 --> 00:00:07.000\nAnother &amp; another.\n\n00:00:08.000 --> 00:00:09.000\nAfter the clip.\n';
  const cues = parseClipVtt(raw, 3.65, 7.5);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].start, 0);
  assert.equal(cues[0].text, 'The first complete sentence.');
  assert.equal(cues[1].text, 'Another & another.');
  assert.throws(() => parseClipVtt('<html>Not subtitles</html>', 0, 4));
});

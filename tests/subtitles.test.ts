import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProject, parseSrt, subtitlesToSrt, transcriptToCues } from '../src/core';

test('SRT parser handles comma timecodes, multiline cues, and frame alignment', () => {
  const cues = parseSrt('1\n00:00:01,000 --> 00:00:02,500\nHello\nworld\n\n2\n00:00:03.000 --> 00:00:04.000\nNext', 30);
  assert.equal(cues.length, 2);
  assert.equal(cues[0]?.start, 30);
  assert.equal(cues[0]?.end, 75);
  assert.equal(cues[0]?.text, 'Hello\nworld');
});

test('SRT serializer emits valid round-trippable cues', () => {
  const project = createProject();
  const text = subtitlesToSrt([{ index: 1, start: 30, end: 75, text: 'Hello' }], project.settings.fps);
  assert.match(text, /00:00:01,000 --> 00:00:02,500/);
  assert.equal(parseSrt(text, project.settings.fps)[0]?.text, 'Hello');
});

test('plain transcripts become proportionally timed subtitle cues', () => {
  const cues = transcriptToCues('One short sentence. Then a longer sentence with several words.', 30, 300);
  assert.equal(cues.length, 2);
  assert.equal(cues[0]!.start, 0);
  assert.equal(cues.at(-1)!.end, 300);
  assert.ok(cues[0]!.end > cues[0]!.start);
});

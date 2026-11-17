import test from 'node:test';
import assert from 'node:assert/strict';
import { PROJECT_TEMPLATES, createTemplateProject } from '../src/core';

test('every template builds a populated, valid project', () => {
  for (const tpl of PROJECT_TEMPLATES) {
    const p = createTemplateProject(tpl.id);
    const clips = Object.values(p.clips);
    const texts = clips.filter((c) => c.kind === 'text');
    if (tpl.id !== 'lofi-slowed') assert.equal(texts.length, tpl.texts.length, `${tpl.id}: all text clips placed`);
    if (tpl.visualizer) assert.ok(clips.some((c) => c.kind === 'visualizer'), `${tpl.id}: visualizer`);
    if (tpl.progress) assert.ok(clips.some((c) => c.kind === 'visualizer'), `${tpl.id}: progress`);
    for (const c of clips) assert.ok(p.tracks.some((t) => t.id === c.trackId), `${tpl.id}: clip on a real track`);
    for (const c of texts) assert.ok(c.start + c.duration <= Math.round(tpl.durationSec * p.settings.fps), `${tpl.id}: text inside duration`);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { addClip, createClip, createProject, projectDuration, contentEnd, setClipSpeed } from '../src/core';

const lane = (p: ReturnType<typeof createProject>, kind: string) => p.tracks.find((t) => t.kind === kind)!.id;

test('the video ends where the background ends; audio and text past it are cut', () => {
  let p = createProject('t', 30, '16:9');
  const img = createClip({ kind: 'image', trackId: lane(p, 'image'), name: 'bg', start: 0, duration: 100 });
  const aud = createClip({ kind: 'audio', trackId: lane(p, 'audio'), name: 'song', start: 0, duration: 300 });
  const txt = createClip({ kind: 'text', trackId: lane(p, 'text'), name: 't', start: 0, duration: 250, text: { text: 'x', style: { fontFamily: 'Arial', fontSize: 40, fontWeight: 700, letterSpacing: 0, lineHeight: 1.1, align: 'center', color: '#fff' } } });
  for (const c of [aud, txt]) { const r = addClip(p, c); if (r.ok) p = r.project; }
  assert.equal(projectDuration(p), 300, 'without a background the last clip decides');
  const r = addClip(p, img); assert.ok(r.ok); p = r.project;
  assert.equal(projectDuration(p), 100);
  assert.equal(contentEnd(p), 300);
});

test('speed can go up to 20x', () => {
  let p = createProject('t', 30, '16:9');
  const img = createClip({ kind: 'image', trackId: lane(p, 'image'), name: 'bg', start: 0, duration: 100 });
  const r = addClip(p, img); assert.ok(r.ok); p = r.project;
  const s = setClipSpeed(p, img.id, 20); assert.ok(s.ok);
  assert.equal(s.project.clips[img.id]!.speed, 20);
  const over = setClipSpeed(s.project, img.id, 50); assert.equal(over.project.clips[img.id]!.speed, 20, 'capped at 20x');
});

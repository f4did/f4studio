import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addClip, createClip, createProject, setClipSpeed, setSourceRange, sourceRangeOf } from '../src/core';
import type { Project } from '../src/core';

function withAudio(): { p: Project; id: string; id2: string } {
  let p = createProject('t', 30, '16:9');
  p = { ...p, assets: { a: { id: 'a', kind: 'audio', name: 'a', mimeType: 'audio/wav', durationSec: 20, blobKey: 'a', size: 1 } as never } };
  const track = p.tracks.find((t) => t.kind === 'audio')!;
  const a = createClip({ kind: 'audio', trackId: track.id, assetId: 'a', name: 'a', start: 0, duration: 300 });
  const b = createClip({ kind: 'audio', trackId: track.id, assetId: 'a', name: 'b', start: 300, duration: 150 });
  const r1 = addClip(p, a); assert.ok(r1.ok);
  const r2 = addClip(r1.project, b); assert.ok(r2.ok);
  return { p: r2.project, id: a.id, id2: b.id };
}

test('slowing a clip makes it longer and ripples the following clip', () => {
  const { p, id, id2 } = withAudio();
  const r = setClipSpeed(p, id, 0.5);
  assert.ok(r.ok);
  assert.equal(r.project.clips[id]!.duration, 600);
  assert.equal(r.project.clips[id2]!.start, 600);
  const faster = setClipSpeed(r.project, id, 2);
  assert.ok(faster.ok);
  assert.equal(faster.project.clips[id]!.duration, 150);
});

test('speed changes keep the same source span', () => {
  const { p, id } = withAudio();
  const r = setClipSpeed(p, id, 1.5);
  assert.ok(r.ok);
  const range = sourceRangeOf(r.project, r.project.clips[id]!);
  assert.equal(range.out - range.in, 300);
});

test('setSourceRange trims in/out and rejects bad ranges', () => {
  const { p, id } = withAudio();
  const r = setSourceRange(p, id, 30, 150);
  assert.ok(r.ok);
  assert.equal(r.project.clips[id]!.sourceIn, 30);
  assert.equal(r.project.clips[id]!.duration, 120);
  assert.equal(setSourceRange(p, id, 100, 100).ok, false);
});

import { AUDIO_PRESETS, tuningSemitones, effectivePitchSemitones } from '../src/core';
test('432 Hz tuning is about -0.32 semitones and presets are well-formed', () => {
  assert.ok(Math.abs(tuningSemitones(432) + 0.3177) < 0.001);
  assert.equal(tuningSemitones(440), 0);
  assert.ok(Math.abs(effectivePitchSemitones({ pitchSemitones: 2, tuningHz: 880 }) - 14) < 1e-9);
  assert.ok(AUDIO_PRESETS.length >= 10 && AUDIO_PRESETS.every((p) => p.speed > 0.5 && p.speed < 2));
});

import { evaluateMediaAnimation } from '../src/core';
test('media animation presets move and settle deterministically', () => {
  const clip = { start: 10, duration: 90, animation: { in: { presetId: 'slide-left', durationFrames: 20, speed: 1 }, out: { presetId: 'fade', durationFrames: 20, speed: 1 }, loop: { presetId: 'ken-burns-in', durationFrames: 90, speed: 1 } } };
  const start = evaluateMediaAnimation(clip, 10);
  assert.ok(start.x < -1);
  const mid = evaluateMediaAnimation(clip, 50);
  assert.equal(mid.x, -0.03 * (40 / 90));
  assert.ok(mid.opacity === 1 && mid.scale > 1);
  const end = evaluateMediaAnimation(clip, 99);
  assert.ok(end.opacity < 0.2);
});

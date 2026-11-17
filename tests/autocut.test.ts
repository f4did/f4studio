import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addClip, applyExportPreset, createClip, createProject, EXPORT_PRESETS, findOverlaps, removeSourceRegions,
  clipsOnTrack, type Project,
} from '../src/core/index';

const FPS = 30;
function setup(): { p: Project; v: string } {
  let p = createProject('t', FPS);
  const v = p.tracks.find((t) => t.kind === 'video')!.id;
  p.assets['a'] = { id: 'a', kind: 'video', name: 'a.mp4', mimeType: 'video/mp4', sizeBytes: 1, durationSec: 10, blobKey: 'k', addedAt: 0 };
  const r = addClip(p, createClip({ kind: 'video', trackId: v, start: 0, duration: 300, assetId: 'a' }));
  assert.ok(r.ok); p = r.project;
  return { p, v };
}

test('auto-cut removes silent regions and ripples the remainder', () => {
  const { p, v } = setup();
  const clip = Object.values(p.clips)[0]!;
  // silences at 2-3s and 5-7s of a 10s clip; no padding => remove exactly 30 + 60 frames
  const r = removeSourceRegions(p, clip.id, [{ startSec: 2, endSec: 3 }, { startSec: 5, endSec: 7 }], { padFrames: 0 });
  assert.ok(r.ok, r.ok ? '' : r.reason);
  assert.equal(r.cuts, 2);
  assert.equal(r.removedFrames, 90);
  const clips = clipsOnTrack(r.project, v);
  assert.equal(clips.length, 3);
  assert.equal(clips.reduce((n, c) => n + c.duration, 0), 300 - 90);
  // contiguous (rippled) and starting at 0
  assert.deepEqual(clips.map((c) => c.start), [0, 60, 120]);
  // remaining source ranges: 0-2s, 3-5s, 7-10s
  assert.deepEqual(clips.map((c) => c.sourceIn), [0, 90, 210]);
  assert.equal(findOverlaps(r.project).length, 0);
});

test('auto-cut padding keeps a breath of audio around each cut', () => {
  const { p } = setup();
  const clip = Object.values(p.clips)[0]!;
  const r = removeSourceRegions(p, clip.id, [{ startSec: 2, endSec: 3 }], { padFrames: 3 });
  assert.ok(r.ok);
  assert.equal(r.removedFrames, 30 - 6);
});

test('auto-cut ignores tiny regions, handles edges, and rejects bad input', () => {
  const { p } = setup();
  const clip = Object.values(p.clips)[0]!;
  assert.equal(removeSourceRegions(p, clip.id, [{ startSec: 1, endSec: 1.1 }], { padFrames: 0 }).ok, false);
  const edge = removeSourceRegions(p, clip.id, [{ startSec: 0, endSec: 1 }, { startSec: 9, endSec: 10 }], { padFrames: 0 });
  assert.ok(edge.ok);
  assert.equal(edge.removedFrames, 60);
  assert.equal(findOverlaps(edge.project).length, 0);
  assert.equal(removeSourceRegions(p, 'nope', [{ startSec: 1, endSec: 2 }]).ok, false);
});

test('auto-cut honours clip speed and sourceIn', () => {
  let { p, v } = setup();
  const sped = createClip({ kind: 'video', trackId: v, start: 400, duration: 100, assetId: 'a', speed: 2, sourceIn: 60 });
  const add = addClip(p, sped); assert.ok(add.ok); p = add.project;
  // source seconds 4-5 => source frames 120-150 => timeline offset (120-60)/2=30 .. 45
  const r = removeSourceRegions(p, sped.id, [{ startSec: 4, endSec: 5 }], { padFrames: 0 });
  assert.ok(r.ok);
  assert.equal(r.removedFrames, 15);
  const parts = clipsOnTrack(r.project, v).filter((c) => c.start >= 400);
  assert.equal(parts.length, 2);
  assert.equal(parts[0]!.duration, 30);
  assert.equal(parts[1]!.start, 430);
  assert.equal(parts[1]!.sourceIn, 60 + 90); // 150
});

test('export presets set aspect, even canvas size, fps and bitrates', () => {
  const p = createProject('x', 30);
  for (const preset of EXPORT_PRESETS) {
    const q = applyExportPreset(p, preset);
    assert.equal(q.settings.aspect, preset.aspect);
    assert.equal(q.settings.fps, preset.fps);
    assert.equal(q.export.fps, preset.fps);
    assert.equal(q.settings.width % 2, 0); assert.equal(q.settings.height % 2, 0);
    assert.ok(q.settings.width <= 1920 && q.settings.height <= 1920);
  }
  const vertical = applyExportPreset(p, EXPORT_PRESETS.find((x) => x.id === 'shorts-tiktok')!);
  assert.ok(vertical.settings.height > vertical.settings.width);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addClip, addMarker, canRedo, canUndo, closeGaps, commit, copyClips, createClip, createHistory,
  createProject, createTrack, duplicateClips, findOverlaps, formatTimecode, groupClips, moveClips,
  moveClipsBy, pasteClips, projectDuration, redo, removeClips, rippleDelete, rippleInsert,
  secondsToFrames, slideClip, slipClip, snapClipStart, snapFrame, splitClip, timelineToSource,
  trimLeft, trimRight, ungroupClips, updateClip, undo, dimensionsFor, type Clip, type EditResult, type Project,
} from '../src/core/index';

const FPS = 30;

function setup(): { p: Project; v: string; a: string } {
  const p = createProject('t', FPS);
  const v = p.tracks.find((t) => t.kind === 'video')!.id;
  const a = p.tracks.find((t) => t.kind === 'audio')!.id;
  p.assets['asset1'] = {
    id: 'asset1', kind: 'video', name: 'a.mp4', mimeType: 'video/mp4', sizeBytes: 1,
    durationSec: 10, blobKey: 'k', addedAt: 0,
  }; // 300 frames
  return { p, v, a };
}

function vclip(trackId: string, start: number, duration: number, extra: Partial<Clip> = {}): Clip {
  return createClip({ kind: 'video', trackId, start, duration, assetId: 'asset1', ...extra });
}

function must(r: EditResult): Project {
  assert.equal(r.ok, true, r.ok ? '' : (r as { reason: string }).reason);
  return r.project;
}

// ---------- time ----------

test('timecode and conversions are frame-accurate', () => {
  assert.equal(formatTimecode(0, 30), '00:00:00:00');
  assert.equal(formatTimecode(95, 30), '00:00:03:05');
  assert.equal(formatTimecode(3600 * 30, 30), '01:00:00:00');
  assert.equal(secondsToFrames(1.5, 24), 36);
});

test('timelineToSource maps normal, sped-up and reversed clips', () => {
  const { v } = setup();
  const c = vclip(v, 100, 30, { sourceIn: 50 });
  assert.equal(timelineToSource(c, 99), null);
  assert.equal(timelineToSource(c, 100), 50);
  assert.equal(timelineToSource(c, 129), 79);
  assert.equal(timelineToSource(c, 130), null);
  const fast = vclip(v, 0, 30, { sourceIn: 0, speed: 2 });
  assert.equal(timelineToSource(fast, 10), 20);
  const rev = vclip(v, 0, 30, { sourceIn: 10, reverse: true });
  assert.equal(timelineToSource(rev, 0), 39);
  assert.equal(timelineToSource(rev, 29), 10);
});

test('canvas dimensions never exceed 1920x1080 and are even', () => {
  for (const ar of ['16:9', '9:16', '1:1', '4:5', '3:2', '21:9'] as const) {
    const { width, height } = dimensionsFor(ar);
    assert.ok(width <= 1920 && height <= 1920, ar);
    assert.ok(Math.min(width, height) <= 1080, ar);
    assert.equal(width % 2, 0);
    assert.equal(height % 2, 0);
  }
  assert.deepEqual(dimensionsFor('16:9'), { width: 1920, height: 1080 });
  assert.deepEqual(dimensionsFor('9:16'), { width: 1080, height: 1920 });
});

// ---------- add / validation ----------

test('addClip rejects overlap, accepts cross-type lanes, locked track and bad timing', () => {
  const { p, v, a } = setup();
  const p1 = must(addClip(p, vclip(v, 0, 60)));
  assert.equal(addClip(p1, vclip(v, 30, 60)).ok, false);
  assert.equal(addClip(p1, vclip(v, 60, 30)).ok, true); // butting is fine
  assert.equal(addClip(p1, vclip(a, 0, 30)).ok, true); // cross-type clips are allowed on any lane
  assert.equal(addClip(p1, vclip(v, -1, 30)).ok, false);
  assert.equal(addClip(p1, vclip(v, 100, 0)).ok, false);
  const locked = { ...p1, tracks: p1.tracks.map((t) => (t.id === v ? { ...t, locked: true } : t)) };
  assert.equal(addClip(locked, vclip(v, 200, 10)).ok, false);
});

test('failed edits return the original project reference', () => {
  const { p, v } = setup();
  const p1 = must(addClip(p, vclip(v, 0, 60)));
  const r = addClip(p1, vclip(v, 10, 10));
  assert.equal(r.project, p1);
});

// ---------- move ----------

test('moveClips moves, changes tracks and blocks overlaps and negative starts', () => {
  const { p, v } = setup();
  const v2 = createTrack('video', 2);
  let cur: Project = { ...p, tracks: [...p.tracks, v2] };
  const c1 = vclip(v, 0, 60);
  const c2 = vclip(v, 100, 40);
  cur = must(addClip(addClip(cur, c1).project, c2));
  assert.equal(moveClips(cur, [{ id: c1.id, start: 80 }]).ok, false);
  const moved = must(moveClips(cur, [{ id: c1.id, start: 40 }])); // 40..100 butts against c2
  assert.equal(moved.clips[c1.id]!.start, 40);
  assert.equal(moveClips(cur, [{ id: c1.id, start: -5 }]).ok, false);
  const across = must(moveClips(cur, [{ id: c1.id, start: 90, trackId: v2.id }]));
  assert.equal(across.clips[c1.id]!.trackId, v2.id);
  assert.deepEqual(findOverlaps(across), []);
});

test('moveClipsBy moves a multi-selection together and clamps at frame 0', () => {
  const { p, v } = setup();
  const c1 = vclip(v, 10, 20);
  const c2 = vclip(v, 40, 20);
  const cur = must(addClip(addClip(p, c1).project, c2));
  const left = must(moveClipsBy(cur, [c1.id, c2.id], -100));
  assert.equal(left.clips[c1.id]!.start, 0);
  assert.equal(left.clips[c2.id]!.start, 30); // relative spacing preserved
  const right = must(moveClipsBy(cur, [c1.id, c2.id], 15));
  assert.equal(right.clips[c1.id]!.start, 25);
});

test('locked clips and locked tracks cannot move', () => {
  const { p, v } = setup();
  const c = vclip(v, 0, 30, { locked: true });
  const cur = must(addClip(p, c));
  assert.equal(moveClips(cur, [{ id: c.id, start: 50 }]).ok, false);
});

// ---------- trim ----------

test('trimLeft adjusts start, duration and sourceIn consistently', () => {
  const { p, v } = setup();
  const c = vclip(v, 100, 60, { sourceIn: 20 });
  const cur = must(addClip(p, c));
  const t = must(trimLeft(cur, c.id, 110)).clips[c.id]!;
  assert.deepEqual([t.start, t.duration, t.sourceIn], [110, 50, 30]);
  // end frame on the timeline unchanged
  assert.equal(t.start + t.duration, 160);
  // timeline->source of the first visible frame is the same source frame as before
  assert.equal(timelineToSource(t, 110), timelineToSource(c, 110));
});

test('trimLeft extension is limited by available source and previous clip', () => {
  const { p, v } = setup();
  const prev = vclip(v, 0, 90);
  const c = vclip(v, 100, 60, { sourceIn: 5 });
  const cur = must(addClip(addClip(p, prev).project, c));
  const t = must(trimLeft(cur, c.id, 0)).clips[c.id]!; // wants to go to 0
  assert.equal(t.start, 95); // source limit: only 5 frames available (sourceIn=5)
  assert.equal(t.sourceIn, 0);
  const c2 = vclip(v, 200, 30, { sourceIn: 200 });
  const cur2 = must(addClip(cur, c2));
  const t2 = must(trimLeft(cur2, c2.id, 150)).clips[c2.id]!;
  assert.equal(t2.start, 160); // blocked by the previous clip ending at 160
});

test('trimLeft never reduces below one frame', () => {
  const { p, v } = setup();
  const c = vclip(v, 10, 20);
  const t = must(trimLeft(must(addClip(p, c)), c.id, 999)).clips[c.id]!;
  assert.equal(t.duration, 1);
  assert.equal(t.start, 29);
});

test('trimRight shortens, and extension is clamped by asset length and next clip', () => {
  const { p, v } = setup();
  const c = vclip(v, 0, 60, { sourceIn: 200 }); // 100 frames of source remain after sourceIn=200 within 300
  const cur = must(addClip(p, c));
  assert.equal(must(trimRight(cur, c.id, 30)).clips[c.id]!.duration, 30);
  assert.equal(must(trimRight(cur, c.id, 10_000)).clips[c.id]!.duration, 100);
  const nb = vclip(v, 80, 20);
  const cur2 = must(addClip(cur, nb));
  assert.equal(must(trimRight(cur2, c.id, 10_000)).clips[c.id]!.duration, 80);
});

test('trim honours speed when computing source limits', () => {
  const { p, v } = setup();
  const c = vclip(v, 0, 30, { sourceIn: 0, speed: 2 }); // consumes 60 source frames
  const cur = must(addClip(p, c));
  // 300 total source frames, 60 used -> 240 more -> 120 more timeline frames at 2x
  assert.equal(must(trimRight(cur, c.id, 10_000)).clips[c.id]!.duration, 150);
});

test('image and text clips trim without source limits and keep sourceIn', () => {
  const { p, v } = setup();
  const img = createClip({ kind: 'image', trackId: v, start: 0, duration: 30 });
  const cur = must(addClip(p, img));
  const t = must(trimRight(cur, img.id, 500)).clips[img.id]!;
  assert.equal(t.duration, 500);
  assert.equal(t.sourceIn, 0);
});

test('reverse clip trimming keeps the same source frames visible', () => {
  const { p, v } = setup();
  const c = vclip(v, 100, 60, { sourceIn: 50, reverse: true });
  const cur = must(addClip(p, c));
  const before = timelineToSource(c, 120);
  const t = must(trimLeft(cur, c.id, 110)).clips[c.id]!;
  assert.equal(timelineToSource(t, 120), before);
  const r = must(trimRight(cur, c.id, 150)).clips[c.id]!;
  assert.equal(timelineToSource(r, 120), before);
});

// ---------- split ----------

test('splitClip produces contiguous halves with correct source mapping', () => {
  const { p, v } = setup();
  const c = vclip(v, 100, 60, { sourceIn: 20 });
  const cur = must(addClip(p, c));
  const r = splitClip(cur, c.id, 130);
  const out = must(r);
  const left = out.clips[c.id]!;
  const right = out.clips[r.newId!]!;
  assert.deepEqual([left.start, left.duration], [100, 30]);
  assert.deepEqual([right.start, right.duration], [130, 30]);
  assert.equal(right.sourceIn, 50);
  assert.equal(left.start + left.duration, right.start);
  // Playing the two halves is identical to playing the original.
  for (let f = 100; f < 160; f++) {
    const half = f < 130 ? left : right;
    assert.equal(timelineToSource(half, f), timelineToSource(c, f), `frame ${f}`);
  }
  assert.deepEqual(findOverlaps(out), []);
});

test('splitClip respects speed and reverse', () => {
  const { p, v } = setup();
  const fast = vclip(v, 0, 40, { sourceIn: 10, speed: 2 });
  const out = must(addClip(p, fast));
  const r = splitClip(out, fast.id, 10);
  const s = must(r);
  assert.equal(s.clips[r.newId!]!.sourceIn, 30);
  const rev = vclip(v, 100, 40, { sourceIn: 10, reverse: true });
  const pr = must(addClip(s, rev));
  const rr = splitClip(pr, rev.id, 120);
  const sp = must(rr);
  const l = sp.clips[rev.id]!;
  const rt = sp.clips[rr.newId!]!;
  for (let f = 100; f < 140; f++) {
    assert.equal(timelineToSource(f < 120 ? l : rt, f), timelineToSource(rev, f), `reverse frame ${f}`);
  }
});

test('splitClip rejects boundaries and outside frames; splits keyframes', () => {
  const { p, v } = setup();
  const c = vclip(v, 10, 30, {
    keyframes: { 'transform.x': [{ frame: 5, value: 0, easing: 'linear' }, { frame: 25, value: 1, easing: 'linear' }] },
  });
  const cur = must(addClip(p, c));
  assert.equal(splitClip(cur, c.id, 10).ok, false);
  assert.equal(splitClip(cur, c.id, 40).ok, false);
  assert.equal(splitClip(cur, c.id, 5).ok, false);
  const r = splitClip(cur, c.id, 25); // local frame 15
  const s = must(r);
  assert.equal(s.clips[c.id]!.keyframes['transform.x']!.length, 1);
  assert.deepEqual(s.clips[r.newId!]!.keyframes['transform.x'], [{ frame: 10, value: 1, easing: 'linear' }]);
});

// ---------- ripple ----------

test('rippleDelete closes the gap only on the affected track', () => {
  const { p, v } = setup();
  const v2 = createTrack('video', 2);
  let cur: Project = { ...p, tracks: [...p.tracks, v2] };
  const a = vclip(v, 0, 30);
  const b = vclip(v, 30, 30);
  const c = vclip(v, 60, 30);
  const other = vclip(v2.id, 70, 30);
  for (const x of [a, b, c, other]) cur = must(addClip(cur, x));
  const out = must(rippleDelete(cur, [b.id]));
  assert.equal(out.clips[b.id], undefined);
  assert.equal(out.clips[c.id]!.start, 30);
  assert.equal(out.clips[a.id]!.start, 0);
  assert.equal(out.clips[other.id]!.start, 70);
});

test('rippleDelete of several clips accumulates shifts', () => {
  const { p, v } = setup();
  const cs = [0, 1, 2, 3].map((i) => vclip(v, i * 30, 30));
  let cur = p;
  for (const c of cs) cur = must(addClip(cur, c));
  const out = must(rippleDelete(cur, [cs[0]!.id, cs[2]!.id]));
  assert.equal(out.clips[cs[1]!.id]!.start, 0);
  assert.equal(out.clips[cs[3]!.id]!.start, 30);
});

test('rippleInsert pushes later clips and splits a spanning clip', () => {
  const { p, v } = setup();
  const a = vclip(v, 0, 60);
  const b = vclip(v, 60, 30);
  const cur = must(addClip(addClip(p, a).project, b));
  const ins = vclip(v, 0, 20, { name: 'ins' });
  const out = must(rippleInsert(cur, ins, 30));
  const list = Object.values(out.clips).sort((x, y) => x.start - y.start);
  assert.deepEqual(list.map((c) => [c.start, c.duration]), [[0, 30], [30, 20], [50, 30], [80, 30]]);
  assert.deepEqual(findOverlaps(out), []);
  assert.equal(projectDuration(out), 110);
});

test('closeGaps (magnetic) packs a track in order', () => {
  const { p, v } = setup();
  const a = vclip(v, 10, 20);
  const b = vclip(v, 100, 20);
  const cur = must(addClip(addClip(p, a).project, b));
  const out = must(closeGaps(cur, v));
  assert.equal(out.clips[a.id]!.start, 0);
  assert.equal(out.clips[b.id]!.start, 20);
  assert.equal(closeGaps(out, v).ok, false);
});

// ---------- slip / slide ----------

test('slipClip changes sourceIn only and clamps to the asset', () => {
  const { p, v } = setup();
  const c = vclip(v, 50, 100, { sourceIn: 20 });
  const cur = must(addClip(p, c));
  const s = must(slipClip(cur, c.id, 30)).clips[c.id]!;
  assert.deepEqual([s.start, s.duration, s.sourceIn], [50, 100, 50]);
  assert.equal(must(slipClip(cur, c.id, -999)).clips[c.id]!.sourceIn, 0);
  assert.equal(must(slipClip(cur, c.id, 9999)).clips[c.id]!.sourceIn, 200); // 300 - 100
});

test('slideClip keeps the combined span constant', () => {
  const { p, v } = setup();
  const a = vclip(v, 0, 60, { sourceIn: 0 });
  const b = vclip(v, 60, 60, { sourceIn: 100 });
  const c = vclip(v, 120, 60, { sourceIn: 50 });
  let cur = p;
  for (const x of [a, b, c]) cur = must(addClip(cur, x));
  const out = must(slideClip(cur, b.id, 20));
  assert.equal(out.clips[a.id]!.duration, 80);
  assert.equal(out.clips[b.id]!.start, 80);
  assert.equal(out.clips[c.id]!.start, 140);
  assert.equal(out.clips[c.id]!.duration, 40);
  assert.equal(out.clips[c.id]!.sourceIn, 70);
  assert.equal(out.clips[b.id]!.sourceIn, 100); // slid clip content untouched
  assert.deepEqual(findOverlaps(out), []);
  const maxed = must(slideClip(cur, b.id, 9999));
  assert.equal(maxed.clips[c.id]!.duration, 1);
  assert.equal(slideClip(cur, a.id, 5).ok, true);
  const lone = must(addClip(p, vclip(v, 500, 10)));
  assert.equal(slideClip(lone, Object.keys(lone.clips)[0]!, 5).ok, false);
});

// ---------- duplicate / clipboard / groups ----------

test('duplicateClips places copies after the original, skipping occupied space', () => {
  const { p, v } = setup();
  const a = vclip(v, 0, 30);
  const b = vclip(v, 30, 30);
  const cur = must(addClip(addClip(p, a).project, b));
  const r = duplicateClips(cur, [a.id]);
  const out = must(r);
  assert.equal(out.clips[r.newIds![0]!]!.start, 60);
  assert.notEqual(r.newIds![0], a.id);
  assert.deepEqual(findOverlaps(out), []);
});

test('copy/paste preserves relative offsets and creates new ids', () => {
  const { p, v } = setup();
  const a = vclip(v, 10, 20);
  const b = vclip(v, 50, 20);
  const cur = must(addClip(addClip(p, a).project, b));
  const clip = copyClips(cur, [a.id, b.id]);
  const r = pasteClips(cur, clip, 200);
  const out = must(r);
  const starts = r.newIds!.map((id) => out.clips[id]!.start).sort((x, y) => x - y);
  assert.deepEqual(starts, [200, 240]);
  assert.equal(pasteClips(cur, clip, 0).ok, false); // would overlap originals
  assert.equal(pasteClips(cur, [], 0).ok, false);
});

test('group and ungroup', () => {
  const { p, v } = setup();
  const a = vclip(v, 0, 10);
  const b = vclip(v, 10, 10);
  const cur = must(addClip(addClip(p, a).project, b));
  const g = must(groupClips(cur, [a.id, b.id]));
  assert.ok(g.clips[a.id]!.groupId);
  assert.equal(g.clips[a.id]!.groupId, g.clips[b.id]!.groupId);
  const u = must(ungroupClips(g, [a.id]));
  assert.equal(u.clips[a.id]!.groupId, undefined);
  assert.equal(u.clips[b.id]!.groupId, undefined);
  assert.equal(groupClips(cur, [a.id]).ok, false);
});

test('removeClips skips locked clips', () => {
  const { p, v } = setup();
  const a = vclip(v, 0, 10, { locked: true });
  const b = vclip(v, 10, 10);
  const cur = must(addClip(addClip(p, a).project, b));
  const out = must(removeClips(cur, [a.id, b.id]));
  assert.ok(out.clips[a.id]);
  assert.equal(out.clips[b.id], undefined);
});

// ---------- snapping / markers ----------

test('snapFrame snaps to playhead, clip edges and markers within threshold', () => {
  const { p, v } = setup();
  const c = vclip(v, 100, 50);
  let cur = must(addClip(p, c));
  cur = must(addMarker(cur, 300));
  const o = { thresholdFrames: 5, playhead: 200 };
  assert.deepEqual(snapFrame(cur, 98, o), { frame: 100, snapped: true });
  assert.deepEqual(snapFrame(cur, 152, o), { frame: 150, snapped: true });
  assert.deepEqual(snapFrame(cur, 203, o), { frame: 200, snapped: true });
  assert.deepEqual(snapFrame(cur, 297, o), { frame: 300, snapped: true });
  assert.deepEqual(snapFrame(cur, 175, o), { frame: 175, snapped: false });
});

test('snapClipStart snaps either edge and ignores the clip itself', () => {
  const { p, v } = setup();
  const a = vclip(v, 0, 50);
  const b = vclip(v, 200, 40);
  const cur = must(addClip(addClip(p, a).project, b));
  const o = { thresholdFrames: 6 };
  assert.deepEqual(snapClipStart(cur, b.id, 54, o), { start: 50, snapped: true }); // start -> a.end
  assert.deepEqual(snapClipStart(cur, b.id, 198, o), { start: 198, snapped: false }); // own edges excluded
  const c = vclip(v, 400, 30);
  const cur2 = must(addClip(cur, c));
  assert.deepEqual(snapClipStart(cur2, b.id, 362, o), { start: 360, snapped: true }); // end -> c.start
});

test('addMarker keeps markers sorted and unique per frame', () => {
  const { p } = setup();
  let cur = must(addMarker(p, 50));
  cur = must(addMarker(cur, 10));
  assert.deepEqual(cur.markers.map((m) => m.frame), [10, 50]);
  assert.equal(addMarker(cur, 10).ok, false);
});

// ---------- history ----------

test('history: every edit is one undo step, redo is cleared by a new edit, no-ops are ignored', () => {
  const { p, v } = setup();
  let h = createHistory(p);
  const c = vclip(v, 0, 60);
  h = commit(h, must(addClip(h.present, c)));
  h = commit(h, must(splitClip(h.present, c.id, 30)));
  assert.equal(Object.keys(h.present.clips).length, 2);
  assert.equal(commit(h, h.present), h);
  h = undo(h);
  assert.equal(Object.keys(h.present.clips).length, 1);
  assert.ok(canRedo(h));
  h = redo(h);
  assert.equal(Object.keys(h.present.clips).length, 2);
  h = undo(undo(h));
  assert.equal(Object.keys(h.present.clips).length, 0);
  assert.equal(canUndo(h), false);
  assert.equal(undo(h), h);
  h = commit(h, must(addClip(h.present, vclip(v, 5, 5))));
  assert.equal(canRedo(h), false);
});

test('history respects the limit', () => {
  const { p } = setup();
  let h = createHistory(p);
  for (let i = 0; i < 10; i++) h = commit(h, { ...h.present, name: `n${i}` }, 3);
  assert.equal(h.past.length, 3);
});

// ---------- invariants over a randomized edit session ----------

test('random edit sequences never produce overlaps, negative starts or sub-frame clips', () => {
  const { p, v } = setup();
  let seed = 12345;
  const rnd = (n: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  let cur = p;
  for (let i = 0; i < 4; i++) cur = addClip(cur, vclip(v, i * 70, 60)).project;
  for (let step = 0; step < 400; step++) {
    const ids = Object.keys(cur.clips);
    const id = ids[rnd(ids.length)]!;
    const op = rnd(7);
    let r: EditResult;
    if (op === 0) r = moveClipsBy(cur, [id], rnd(120) - 60);
    else if (op === 1) r = trimLeft(cur, id, rnd(500));
    else if (op === 2) r = trimRight(cur, id, rnd(500));
    else if (op === 3) r = splitClip(cur, id, rnd(500));
    else if (op === 4) r = slipClip(cur, id, rnd(100) - 50);
    else if (op === 5) r = slideClip(cur, id, rnd(60) - 30);
    else r = ids.length > 2 ? removeClips(cur, [id]) : { ok: false, project: cur, reason: 'x' };
    cur = r.project;
    assert.deepEqual(findOverlaps(cur), [], `overlap at step ${step} op ${op}`);
    for (const c of Object.values(cur.clips)) {
      assert.ok(c.start >= 0, `negative start step ${step}`);
      assert.ok(c.duration >= 1, `duration<1 step ${step}`);
      assert.ok(Number.isInteger(c.start) && Number.isInteger(c.duration) && Number.isInteger(c.sourceIn), `non-integer step ${step}`);
      assert.ok(c.sourceIn >= 0, `negative sourceIn step ${step}`);
      assert.ok(c.sourceIn + c.duration * c.speed <= 300 + 1, `source overrun step ${step} op ${op}`);
    }
  }
});

test('updateClip patches fields, keeps timing intact, and rejects locked clips', () => {
  const { p, v } = setup();
  const c = vclip(v, 10, 30);
  const cur = must(addClip(p, c));
  const out = must(updateClip(cur, c.id, { name: 'renamed', speed: 1 }));
  assert.equal(out.clips[c.id]!.name, 'renamed');
  assert.equal(out.clips[c.id]!.start, 10);
  const locked = must(addClip(cur, vclip(v, 100, 10, { locked: true })));
  const lid = Object.values(locked.clips).find((x) => x.locked)!.id;
  assert.equal(updateClip(locked, lid, { name: 'x' }).ok, false);
  assert.equal(updateClip(cur, 'nope', { name: 'x' }).ok, false);
});

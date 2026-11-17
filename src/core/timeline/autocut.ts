/**
 * Auto-cut: remove regions of a clip's SOURCE media (e.g. detected silences) and
 * ripple the remainder together. Pure and immutable like the rest of the timeline
 * engine; every cut is built from splitClip + rippleDelete so the result obeys the
 * same invariants (integer frames, no overlaps, source bounds) as manual edits.
 */
import type { Frames, Id, Project } from '../model/types';
import { clipEnd } from './time';
import { rippleDelete, splitClip, type EditResult } from './operations';

export interface SourceRegion {
  startSec: number;
  endSec: number;
}

export interface AutoCutOptions {
  /** Frames of the silence kept on each side of a cut so speech is not clipped. Default 3. */
  padFrames?: Frames;
  /** Regions shorter than this (after padding) are ignored. Default 6 frames. */
  minFrames?: Frames;
}

export type AutoCutResult = EditResult & { cuts: number; removedFrames: Frames };

export function removeSourceRegions(p: Project, clipId: Id, regions: SourceRegion[], options: AutoCutOptions = {}): AutoCutResult {
  const fail = (reason: string): AutoCutResult => ({ ok: false, project: p, reason, cuts: 0, removedFrames: 0 });
  const clip = p.clips[clipId];
  if (!clip) return fail('Clip not found');
  if (clip.kind !== 'video' && clip.kind !== 'audio') return fail('Auto-cut works on video and audio clips');
  if (clip.reverse) return fail('Auto-cut does not support reversed clips');
  if (clip.freezeFrame !== undefined) return fail('Auto-cut does not support freeze-frame clips');
  const fps = p.settings.fps;
  const pad = Math.max(0, Math.round(options.padFrames ?? 3));
  const min = Math.max(1, Math.round(options.minFrames ?? 6));

  // Source-frame region -> timeline frames for the ORIGINAL clip placement.
  const original = { start: clip.start, end: clipEnd(clip) };
  const spans = regions
    .map((r) => ({
      s: Math.round(clip.start + (r.startSec * fps - clip.sourceIn) / clip.speed) + pad,
      e: Math.round(clip.start + (r.endSec * fps - clip.sourceIn) / clip.speed) - pad,
    }))
    .map((r) => ({ s: Math.max(original.start, r.s), e: Math.min(original.end, r.e) }))
    .filter((r) => r.e - r.s >= min)
    .sort((a, b) => b.s - a.s); // last -> first, so earlier timeline positions stay valid
  if (!spans.length) return fail('No cuttable regions found');

  let cur = p;
  let cuts = 0;
  let removed = 0;
  let lastStart = Infinity;
  for (const span of spans) {
    if (span.e > lastStart) span.e = lastStart; // overlapping regions: never cut the same frames twice
    if (span.e - span.s < min) continue;
    const c = cur.clips[clipId];
    if (!c) break;
    let middleId: Id = clipId;
    if (span.e < clipEnd(c)) {
      const r = splitClip(cur, clipId, span.e);
      if (!r.ok) return fail(r.reason);
      cur = r.project;
    }
    if (span.s > c.start) {
      const r = splitClip(cur, clipId, span.s);
      if (!r.ok || !r.newId) return fail(r.ok ? 'Split failed' : r.reason);
      cur = r.project;
      middleId = r.newId;
    }
    const d = rippleDelete(cur, [middleId]);
    if (!d.ok) return fail(d.reason);
    cur = d.project;
    cuts += 1;
    removed += span.e - span.s;
    lastStart = span.s;
  }
  if (!cuts) return fail('No cuttable regions found');
  return { ok: true, project: cur, cuts, removedFrames: removed };
}

/**
 * Timeline engine: pure, immutable edit operations over the canonical Project.
 *
 * Every function takes a Project and returns an EditResult. A rejected edit
 * returns the ORIGINAL project reference (ok: false) so callers can cheaply
 * detect "nothing changed" and never push a no-op onto the undo stack.
 * All values are integer frames. DOM geometry is never consulted.
 */
import { clone, newId, trackAccepts } from '../model/factory';
import type { Clip, Frames, Id, Marker, Project } from '../model/types';
import { clipEnd, secondsToFrames, sourceSpan } from './time';

export type EditResult =
  | { ok: true; project: Project }
  | { ok: false; project: Project; reason: string };

const ok = (project: Project): EditResult => ({ ok: true, project });
const fail = (project: Project, reason: string): EditResult => ({ ok: false, project, reason });

// ---------- queries ----------

export function clipsOnTrack(p: Project, trackId: Id): Clip[] {
  return Object.values(p.clips)
    .filter((c) => c.trackId === trackId)
    .sort((a, b) => a.start - b.start);
}

/** End of the visual base (video / image clips). Music, text and overlays can't outlive it. */
export function baseEnd(p: Project): Frames | null {
  let end = 0;
  for (const c of Object.values(p.clips)) if (c.kind === 'video' || c.kind === 'image') end = Math.max(end, clipEnd(c));
  return end > 0 ? end : null;
}

/** Timeline length: with a background (video/image) the video ends where it ends; otherwise the last clip decides. */
export function projectDuration(p: Project): Frames {
  const base = baseEnd(p);
  if (base !== null) return base;
  let end = 0;
  for (const c of Object.values(p.clips)) end = Math.max(end, clipEnd(c));
  return Math.max(end, p.settings.backgroundDurationFrames ?? 0);
}

/** Latest end of any clip, regardless of the background (used for timeline scroll width). */
export function contentEnd(p: Project): Frames {
  let end = 0;
  for (const c of Object.values(p.clips)) end = Math.max(end, clipEnd(c));
  return end;
}

export function findOverlaps(p: Project, trackIds?: Iterable<Id>): Array<[Clip, Clip]> {
  const ids = trackIds ? new Set(trackIds) : new Set(p.tracks.map((t) => t.id));
  const out: Array<[Clip, Clip]> = [];
  for (const id of ids) {
    const list = clipsOnTrack(p, id);
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1];
      const b = list[i];
      if (a && b && b.start < clipEnd(a)) out.push([a, b]);
    }
  }
  return out;
}

/** Total frames available in the asset behind a clip (at project fps). Infinity for generated clips. */
function assetFrames(p: Project, c: Clip): number {
  if (c.kind !== 'video' && c.kind !== 'audio') return Infinity;
  const a = c.assetId ? p.assets[c.assetId] : undefined;
  return a ? secondsToFrames(a.durationSec, p.settings.fps) : Infinity;
}

const isMedia = (c: Clip) => c.kind === 'video' || c.kind === 'audio';

/** Compositing tracks intentionally allow layers to overlap; media/audio lanes remain sequential. */
const allowsStacking = (trackKind: Project['tracks'][number]['kind'], clipKind: Clip['kind']) =>
  trackKind === 'text' || trackKind === 'overlay' || trackKind === 'effect' || trackKind === 'audio' || (trackKind === 'image' && clipKind === 'image');

function trackLocked(p: Project, trackId: Id): boolean {
  return p.tracks.find((t) => t.id === trackId)?.locked ?? false;
}

function isEditable(p: Project, c: Clip): boolean {
  return !c.locked && !trackLocked(p, c.trackId);
}

function withClips(p: Project, patch: Record<Id, Clip | null>): Project {
  const clips = { ...p.clips };
  for (const [id, c] of Object.entries(patch)) {
    if (c === null) delete clips[id];
    else clips[id] = c;
  }
  return { ...p, clips, updatedAt: Date.now() };
}

// ---------- add / remove / duplicate ----------

export function addClip(p: Project, clip: Clip): EditResult {
  const track = p.tracks.find((t) => t.id === clip.trackId);
  if (!track) return fail(p, 'Track not found');
  if (track.locked) return fail(p, 'Track is locked');
  if (!trackAccepts(track.kind, clip.kind)) return fail(p, `${track.kind} track cannot hold ${clip.kind} clips`);
  if (clip.start < 0 || clip.duration < 1) return fail(p, 'Invalid clip timing');
  const next = withClips(p, { [clip.id]: clip });
  if (!allowsStacking(track.kind, clip.kind) && findOverlaps(next, [clip.trackId]).length) return fail(p, 'Clip would overlap another clip');
  return ok(next);
}

export function removeClips(p: Project, ids: Id[]): EditResult {
  const patch: Record<Id, null> = {};
  for (const id of ids) {
    const c = p.clips[id];
    if (c && isEditable(p, c)) patch[id] = null;
  }
  if (!Object.keys(patch).length) return fail(p, 'Nothing to delete');
  return ok(withClips(p, patch));
}

/** Duplicate each clip directly after itself, or on the next free slot if occupied. */
export function duplicateClips(p: Project, ids: Id[]): EditResult & { newIds?: Id[] } {
  let cur = p;
  const newIds: Id[] = [];
  for (const id of ids) {
    const c = cur.clips[id];
    if (!c) continue;
    let start = clipEnd(c);
    const siblings = clipsOnTrack(cur, c.trackId);
    for (const s of siblings) {
      if (s.start < start + c.duration && clipEnd(s) > start) start = clipEnd(s);
    }
    const copy: Clip = {
      ...clone(c),
      id: newId('clip'),
      start,
      name: c.name,
      groupId: undefined,
      transitionIn: undefined,
    };
    const r = addClip(cur, copy);
    if (!r.ok) return { ...fail(p, r.reason) };
    cur = r.project;
    newIds.push(copy.id);
  }
  if (!newIds.length) return fail(p, 'Nothing to duplicate');
  return { ...ok(cur), newIds };
}

/** Patch non-timing properties (name, transform, audio, effects, text...). Timing fields must go through the dedicated ops. */
export type ClipPatch = Partial<Omit<Clip, 'id' | 'trackId' | 'start' | 'duration' | 'sourceIn' | 'kind'>>;
export function updateClip(p: Project, id: Id, patch: ClipPatch): EditResult {
  const c = p.clips[id];
  if (!c) return fail(p, 'Clip not found');
  if (!isEditable(p, c)) return fail(p, 'Clip or track is locked');
  return ok(withClips(p, { [id]: { ...c, ...patch } }));
}

// ---------- move ----------

export interface MoveSpec {
  id: Id;
  start: Frames;
  trackId?: Id;
}

/** Move one or many clips atomically. Valid only if the final state has no overlaps. */
export function moveClips(p: Project, moves: MoveSpec[]): EditResult {
  const patch: Record<Id, Clip> = {};
  const touched = new Set<Id>();
  for (const m of moves) {
    const c = p.clips[m.id];
    if (!c) return fail(p, 'Clip not found');
    if (!isEditable(p, c)) return fail(p, 'Clip or track is locked');
    const trackId = m.trackId ?? c.trackId;
    const t = p.tracks.find((x) => x.id === trackId);
    if (!t) return fail(p, 'Target track not found');
    if (t.locked) return fail(p, 'Target track is locked');
    if (!trackAccepts(t.kind, c.kind)) return fail(p, `${t.kind} track cannot hold ${c.kind} clips`);
    const start = Math.round(m.start);
    if (start < 0) return fail(p, 'Cannot move before frame 0');
    patch[m.id] = { ...c, start, trackId };
    touched.add(c.trackId);
    touched.add(trackId);
  }
  const next = withClips(p, patch);
  const stackedMove = [...touched].every((trackId) => allowsStacking(p.tracks.find((track) => track.id === trackId)?.kind ?? 'video', Object.values(next.clips).find((clip) => clip.trackId === trackId)?.kind ?? 'video'));
  if (!stackedMove && findOverlaps(next, touched).length) return fail(p, 'Move would overlap another clip');
  return ok(next);
}

/** Convenience: move a set of clips by a frame delta, clamped so none goes below 0. */
export function moveClipsBy(p: Project, ids: Id[], delta: Frames): EditResult {
  const clips = ids.map((id) => p.clips[id]).filter((c): c is Clip => !!c);
  if (!clips.length) return fail(p, 'Nothing to move');
  const minStart = Math.min(...clips.map((c) => c.start));
  const d = Math.max(Math.round(delta), -minStart);
  return moveClips(p, clips.map((c) => ({ id: c.id, start: c.start + d })));
}

// ---------- trim ----------

function neighbours(p: Project, c: Clip): { prev?: Clip; next?: Clip } {
  const list = clipsOnTrack(p, c.trackId);
  const i = list.findIndex((x) => x.id === c.id);
  return { prev: i > 0 ? list[i - 1] : undefined, next: i >= 0 ? list[i + 1] : undefined };
}

/** Trim the left edge to newStart (clamped to legal bounds). */
export function trimLeft(p: Project, id: Id, newStart: Frames): EditResult {
  const c = p.clips[id];
  if (!c) return fail(p, 'Clip not found');
  if (!isEditable(p, c)) return fail(p, 'Clip or track is locked');
  const { prev } = neighbours(p, c);

  // delta > 0 shrinks from the left, delta < 0 extends to the left.
  const lows = [-c.start, prev ? clipEnd(prev) - c.start : -c.start];
  if (isMedia(c)) {
    if (!c.reverse) lows.push(-Math.floor(c.sourceIn / c.speed));
    else {
      const avail = assetFrames(p, c) - (c.sourceIn + sourceSpan(c));
      if (Number.isFinite(avail)) lows.push(-Math.floor(Math.max(0, avail) / c.speed));
    }
  }
  const delta = Math.min(c.duration - 1, Math.max(Math.round(newStart) - c.start, ...lows));
  if (delta === 0) return fail(p, 'No change');

  const next: Clip = { ...c, start: c.start + delta, duration: c.duration - delta };
  if (isMedia(c) && !c.reverse) next.sourceIn = c.sourceIn + Math.round(delta * c.speed);
  next.keyframes = shiftKeyframes(c.keyframes, -delta);
  if (delta > 0) next.transitionIn = undefined;
  return ok(withClips(p, { [id]: next }));
}

/** Trim the right edge so the clip ends at newEnd (clamped to legal bounds). */
export function trimRight(p: Project, id: Id, newEnd: Frames): EditResult {
  const c = p.clips[id];
  if (!c) return fail(p, 'Clip not found');
  if (!isEditable(p, c)) return fail(p, 'Clip or track is locked');
  const { next: nb } = neighbours(p, c);
  const end = clipEnd(c);

  // delta > 0 shrinks from the right, delta < 0 extends to the right.
  const lows: number[] = [nb ? end - nb.start : -Infinity];
  if (isMedia(c)) {
    if (!c.reverse) {
      const avail = assetFrames(p, c) - (c.sourceIn + sourceSpan(c));
      if (Number.isFinite(avail)) lows.push(-Math.floor(Math.max(0, avail) / c.speed));
    } else {
      lows.push(-Math.floor(c.sourceIn / c.speed));
    }
  }
  const delta = Math.min(c.duration - 1, Math.max(end - Math.round(newEnd), ...lows));
  if (delta === 0) return fail(p, 'No change');

  const next: Clip = { ...c, duration: c.duration - delta };
  if (isMedia(c) && c.reverse) next.sourceIn = c.sourceIn + Math.round(delta * c.speed);
  return ok(withClips(p, { [id]: next }));
}

function shiftKeyframes(map: Clip['keyframes'], by: Frames): Clip['keyframes'] {
  const out: Clip['keyframes'] = {};
  for (const [k, list] of Object.entries(map)) out[k] = list.map((kf) => ({ ...kf, frame: kf.frame + by }));
  return out;
}

// ---------- speed & source range ----------

/**
 * Change playback speed while keeping the same source material, so the clip's
 * timeline length scales with 1/speed (slower = longer). Clips that follow on the
 * same lane are rippled so nothing overlaps.
 */
export function setClipSpeed(p: Project, id: Id, speed: number): EditResult {
  const c = p.clips[id];
  if (!c) return fail(p, 'Clip not found');
  if (!isEditable(p, c)) return fail(p, 'Clip or track is locked');
  const nextSpeed = Math.min(20, Math.max(0.1, Math.round(speed * 1000) / 1000));
  if (Math.abs(nextSpeed - c.speed) < 1e-6) return fail(p, 'No change');
  if (c.kind !== 'video' && c.kind !== 'audio' && c.kind !== 'image') return fail(p, 'Speed applies to media clips');
  if (c.kind === 'image') return ok(withClips(p, { [id]: { ...c, speed: nextSpeed } }));
  const span = sourceSpan(c);
  const duration = Math.max(1, Math.round(span / nextSpeed));
  const delta = duration - c.duration;
  const patch: Record<Id, Clip> = { [id]: { ...c, speed: nextSpeed, duration, keyframes: scaleKeyframes(c.keyframes, c.duration, duration) } };
  if (delta > 0) {
    const end = clipEnd(c);
    for (const other of clipsOnTrack(p, c.trackId)) {
      if (other.id !== id && other.start >= end - 0) patch[other.id] = { ...other, start: other.start + delta };
    }
  }
  return ok(withClips(p, patch));
}

function scaleKeyframes(map: Clip['keyframes'], from: Frames, to: Frames): Clip['keyframes'] {
  if (from === to || from <= 0) return map;
  const out: Clip['keyframes'] = {};
  for (const [k, list] of Object.entries(map)) out[k] = list.map((kf) => ({ ...kf, frame: Math.round((kf.frame * to) / from) }));
  return out;
}

/**
 * Set the visible source range of a video/audio clip: in/out are source frames.
 * The clip keeps its timeline start; its duration becomes (out - in) / speed.
 */
export function setSourceRange(p: Project, id: Id, inFrame: Frames, outFrame: Frames): EditResult {
  const c = p.clips[id];
  if (!c) return fail(p, 'Clip not found');
  if (!isEditable(p, c)) return fail(p, 'Clip or track is locked');
  if (!isMedia(c)) return fail(p, 'Trim applies to video and audio clips');
  const max = assetFrames(p, c);
  const a = Math.max(0, Math.round(inFrame));
  const b = Math.min(Number.isFinite(max) ? max : Infinity, Math.round(outFrame));
  if (b - a < 1) return fail(p, 'The out point must be after the in point');
  const duration = Math.max(1, Math.round((b - a) / c.speed));
  const { next: nb } = neighbours(p, c);
  if (nb && c.start + duration > nb.start && p.tracks.find((t) => t.id === c.trackId)?.kind !== 'overlay') return fail(p, 'Not enough room before the next clip');
  if (a === c.sourceIn && duration === c.duration) return fail(p, 'No change');
  return ok(withClips(p, { [id]: { ...c, sourceIn: a, duration, transitionIn: a !== c.sourceIn ? undefined : c.transitionIn } }));
}

/** Source range (in/out source frames) currently used by a media clip. */
export function sourceRangeOf(p: Project, c: Clip): { in: Frames; out: Frames; max: Frames } {
  return { in: c.sourceIn, out: c.sourceIn + sourceSpan(c), max: assetFrames(p, c) };
}

// ---------- split ----------

/** Split a clip at an absolute timeline frame. The right half gets a new id. */
export function splitClip(p: Project, id: Id, frame: Frames): EditResult & { newId?: Id } {
  const c = p.clips[id];
  if (!c) return fail(p, 'Clip not found');
  if (!isEditable(p, c)) return fail(p, 'Clip or track is locked');
  const at = Math.round(frame);
  if (at <= c.start || at >= clipEnd(c)) return fail(p, 'Playhead is not inside the clip');

  const leftDur = at - c.start;
  const rightDur = c.duration - leftDur;
  const leftSpan = Math.round(leftDur * c.speed);

  const left: Clip = { ...c, duration: leftDur };
  const right: Clip = {
    ...clone(c),
    id: newId('clip'),
    start: at,
    duration: rightDur,
    transitionIn: undefined,
    audio: { ...c.audio, fadeInFrames: 0 },
  };
  left.audio = { ...c.audio, fadeOutFrames: 0 };

  if (isMedia(c) || c.kind === 'image') {
    if (!c.reverse) right.sourceIn = c.sourceIn + leftSpan;
    else left.sourceIn = c.sourceIn + (sourceSpan(c) - leftSpan); // later source frames play first
  }

  const lk: Clip['keyframes'] = {};
  const rk: Clip['keyframes'] = {};
  for (const [k, list] of Object.entries(c.keyframes)) {
    lk[k] = list.filter((kf) => kf.frame < leftDur);
    rk[k] = list.filter((kf) => kf.frame >= leftDur).map((kf) => ({ ...kf, frame: kf.frame - leftDur }));
  }
  left.keyframes = lk;
  right.keyframes = rk;

  return { ...ok(withClips(p, { [left.id]: left, [right.id]: right })), newId: right.id };
}

/** Split every unlocked clip under the playhead (optionally limited to ids). */
export function splitAtPlayhead(p: Project, frame: Frames, ids?: Id[]): EditResult {
  const targets = (ids ?? Object.keys(p.clips)).filter((id) => {
    const c = p.clips[id];
    return c && frame > c.start && frame < clipEnd(c);
  });
  let cur = p;
  let changed = false;
  for (const id of targets) {
    const r = splitClip(cur, id, frame);
    if (r.ok) {
      cur = r.project;
      changed = true;
    }
  }
  return changed ? ok(cur) : fail(p, 'No clip under the playhead');
}

// ---------- ripple ----------

/** Delete clips and close the gaps they leave on their own tracks. */
export function rippleDelete(p: Project, ids: Id[]): EditResult {
  const doomed = ids.map((id) => p.clips[id]).filter((c): c is Clip => !!c && isEditable(p, c));
  if (!doomed.length) return fail(p, 'Nothing to delete');
  const doomedIds = new Set(doomed.map((c) => c.id));
  const patch: Record<Id, Clip | null> = {};
  for (const c of doomed) patch[c.id] = null;

  const byTrack = new Map<Id, Clip[]>();
  for (const c of doomed) byTrack.set(c.trackId, [...(byTrack.get(c.trackId) ?? []), c]);

  for (const [trackId, removed] of byTrack) {
    for (const s of clipsOnTrack(p, trackId)) {
      if (doomedIds.has(s.id)) continue;
      if (!isEditable(p, s)) continue;
      // Shift left by total duration of removed clips that sat entirely before s.
      const shift = removed.filter((r) => clipEnd(r) <= s.start).reduce((n, r) => n + r.duration, 0);
      if (shift) patch[s.id] = { ...s, start: s.start - shift };
    }
  }
  return ok(withClips(p, patch));
}

/** Insert a clip at `at`, pushing later clips on the same track to the right. Splits a clip spanning `at`. */
export function rippleInsert(p: Project, clip: Clip, at: Frames): EditResult {
  let cur = p;
  const spanning = clipsOnTrack(cur, clip.trackId).find((c) => c.start < at && clipEnd(c) > at);
  if (spanning) {
    const r = splitClip(cur, spanning.id, at);
    if (!r.ok) return fail(p, r.reason);
    cur = r.project;
  }
  const patch: Record<Id, Clip> = {};
  for (const c of clipsOnTrack(cur, clip.trackId)) {
    if (c.start >= at) patch[c.id] = { ...c, start: c.start + clip.duration };
  }
  cur = withClips(cur, patch);
  const added = addClip(cur, { ...clip, start: at });
  return added.ok ? added : fail(p, added.reason);
}

/** Magnetic behaviour: pack a track's clips left, preserving order, removing every gap. */
export function closeGaps(p: Project, trackId: Id): EditResult {
  if (trackLocked(p, trackId)) return fail(p, 'Track is locked');
  let cursor = 0;
  const patch: Record<Id, Clip> = {};
  for (const c of clipsOnTrack(p, trackId)) {
    if (c.start !== cursor) patch[c.id] = { ...c, start: cursor };
    cursor += c.duration;
  }
  return Object.keys(patch).length ? ok(withClips(p, patch)) : fail(p, 'No gaps');
}

// ---------- slip / slide ----------

/** Slip: change which part of the source plays without moving the clip on the timeline. */
export function slipClip(p: Project, id: Id, deltaSourceFrames: Frames): EditResult {
  const c = p.clips[id];
  if (!c) return fail(p, 'Clip not found');
  if (!isEditable(p, c)) return fail(p, 'Clip or track is locked');
  if (!isMedia(c)) return fail(p, 'Only video and audio clips can be slipped');
  const span = sourceSpan(c);
  const max = assetFrames(p, c) - span;
  const sourceIn = Math.min(Math.max(0, c.sourceIn + Math.round(deltaSourceFrames)), Number.isFinite(max) ? Math.max(0, max) : Infinity);
  if (sourceIn === c.sourceIn) return fail(p, 'No change');
  return ok(withClips(p, { [id]: { ...c, sourceIn } }));
}

/**
 * Slide: move a clip while the adjacent clips absorb the change by trimming, so the
 * overall span of the three clips is constant. Requires the clip to butt against a neighbour.
 */
export function slideClip(p: Project, id: Id, delta: Frames): EditResult {
  const c = p.clips[id];
  if (!c) return fail(p, 'Clip not found');
  if (!isEditable(p, c)) return fail(p, 'Clip or track is locked');
  const { prev, next } = neighbours(p, c);
  const prevAdj = prev && clipEnd(prev) === c.start ? prev : undefined;
  const nextAdj = next && clipEnd(c) === next.start ? next : undefined;
  if (!prevAdj && !nextAdj) return fail(p, 'Slide needs an adjacent clip');

  let d = Math.round(delta);
  // prev end moves by d (duration +d), next start moves by d (duration -d).
  if (prevAdj) d = Math.max(d, -(prevAdj.duration - 1));
  else d = Math.max(d, -c.start);
  if (nextAdj) d = Math.min(d, nextAdj.duration - 1);
  if (prevAdj && isMedia(prevAdj) && !prevAdj.reverse) {
    const avail = assetFrames(p, prevAdj) - (prevAdj.sourceIn + sourceSpan(prevAdj));
    if (Number.isFinite(avail)) d = Math.min(d, Math.floor(Math.max(0, avail) / prevAdj.speed));
  }
  if (nextAdj && isMedia(nextAdj) && !nextAdj.reverse) {
    d = Math.max(d, -Math.floor(nextAdj.sourceIn / nextAdj.speed));
  }
  if (d === 0) return fail(p, 'No change');

  const patch: Record<Id, Clip> = { [c.id]: { ...c, start: c.start + d } };
  if (prevAdj) patch[prevAdj.id] = { ...prevAdj, duration: prevAdj.duration + d };
  if (nextAdj) {
    const n: Clip = { ...nextAdj, start: nextAdj.start + d, duration: nextAdj.duration - d };
    if (isMedia(nextAdj) && !nextAdj.reverse) n.sourceIn = nextAdj.sourceIn + Math.round(d * nextAdj.speed);
    patch[nextAdj.id] = n;
  }
  return ok(withClips(p, patch));
}

// ---------- groups ----------

export function groupClips(p: Project, ids: Id[]): EditResult {
  const members = ids.filter((id) => p.clips[id]);
  if (members.length < 2) return fail(p, 'Select at least two clips to group');
  const groupId = newId('grp');
  const patch: Record<Id, Clip> = {};
  for (const id of members) patch[id] = { ...(p.clips[id] as Clip), groupId };
  return ok(withClips(p, patch));
}

export function ungroupClips(p: Project, ids: Id[]): EditResult {
  const groups = new Set(ids.map((id) => p.clips[id]?.groupId).filter((g): g is Id => !!g));
  if (!groups.size) return fail(p, 'Selection is not grouped');
  const patch: Record<Id, Clip> = {};
  for (const c of Object.values(p.clips)) {
    if (c.groupId && groups.has(c.groupId)) patch[c.id] = { ...c, groupId: undefined };
  }
  return ok(withClips(p, patch));
}

/** Expand a selection to include every member of any group it touches. */
export function expandSelectionToGroups(p: Project, ids: Id[]): Id[] {
  const groups = new Set(ids.map((id) => p.clips[id]?.groupId).filter((g): g is Id => !!g));
  if (!groups.size) return ids;
  const out = new Set(ids);
  for (const c of Object.values(p.clips)) if (c.groupId && groups.has(c.groupId)) out.add(c.id);
  return [...out];
}

// ---------- clipboard ----------

export function copyClips(p: Project, ids: Id[]): Clip[] {
  return ids.map((id) => p.clips[id]).filter((c): c is Clip => !!c).map((c) => clone(c));
}

/** Paste clips so the earliest one starts at `at`, keeping relative offsets and original tracks. */
export function pasteClips(p: Project, clips: Clip[], at: Frames): EditResult & { newIds?: Id[] } {
  if (!clips.length) return fail(p, 'Clipboard is empty');
  const base = Math.min(...clips.map((c) => c.start));
  let cur = p;
  const newIds: Id[] = [];
  for (const c of clips) {
    const trackId = cur.tracks.some((t) => t.id === c.trackId) ? c.trackId : undefined;
    if (!trackId) return fail(p, 'Original track no longer exists');
    const copy: Clip = { ...clone(c), id: newId('clip'), start: at + (c.start - base), groupId: undefined };
    const r = addClip(cur, copy);
    if (!r.ok) return fail(p, r.reason);
    cur = r.project;
    newIds.push(copy.id);
  }
  return { ...ok(cur), newIds };
}

// ---------- snapping ----------

export interface SnapOptions {
  thresholdFrames: Frames;
  playhead?: Frames;
  markers?: Marker[];
  excludeIds?: Id[];
  clipEdges?: boolean;
}

export function snapPoints(p: Project, o: SnapOptions): Frames[] {
  const pts = new Set<Frames>([0]);
  if (o.playhead !== undefined) pts.add(o.playhead);
  for (const m of o.markers ?? p.markers) pts.add(m.frame);
  if (o.clipEdges !== false) {
    const skip = new Set(o.excludeIds ?? []);
    for (const c of Object.values(p.clips)) {
      if (skip.has(c.id)) continue;
      pts.add(c.start);
      pts.add(clipEnd(c));
    }
  }
  return [...pts];
}

/** Snap a single frame to the nearest point within the threshold. */
export function snapFrame(p: Project, frame: Frames, o: SnapOptions): { frame: Frames; snapped: boolean } {
  let best = frame;
  let bestDist = o.thresholdFrames + 1;
  for (const pt of snapPoints(p, o)) {
    const d = Math.abs(pt - frame);
    if (d < bestDist) {
      best = pt;
      bestDist = d;
    }
  }
  return bestDist <= o.thresholdFrames ? { frame: best, snapped: true } : { frame, snapped: false };
}

/** Snap a moving clip: test both its start and its end against snap points. */
export function snapClipStart(p: Project, id: Id, proposedStart: Frames, o: SnapOptions): { start: Frames; snapped: boolean } {
  const c = p.clips[id];
  if (!c) return { start: proposedStart, snapped: false };
  const opts = { ...o, excludeIds: [...(o.excludeIds ?? []), id] };
  const a = snapFrame(p, proposedStart, opts);
  const b = snapFrame(p, proposedStart + c.duration, opts);
  const da = a.snapped ? Math.abs(a.frame - proposedStart) : Infinity;
  const db = b.snapped ? Math.abs(b.frame - (proposedStart + c.duration)) : Infinity;
  if (da === Infinity && db === Infinity) return { start: proposedStart, snapped: false };
  return da <= db ? { start: a.frame, snapped: true } : { start: b.frame - c.duration, snapped: true };
}

// ---------- markers ----------

export function addMarker(p: Project, frame: Frames, label = '', color = '#a78bfa'): EditResult {
  if (p.markers.some((m) => m.frame === frame)) return fail(p, 'Marker already exists here');
  const markers = [...p.markers, { id: newId('mk'), frame, label, color }].sort((a, b) => a.frame - b.frame);
  return ok({ ...p, markers, updatedAt: Date.now() });
}

export function removeMarker(p: Project, markerId: Id): EditResult {
  if (!p.markers.some((m) => m.id === markerId)) return fail(p, 'Marker not found');
  return ok({ ...p, markers: p.markers.filter((m) => m.id !== markerId), updatedAt: Date.now() });
}

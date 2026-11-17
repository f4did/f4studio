import type { Clip, Frames } from '../model/types';

export function secondsToFrames(sec: number, fps: number): Frames {
  return Math.round(sec * fps);
}

export function framesToSeconds(frames: Frames, fps: number): number {
  return frames / fps;
}

/** HH:MM:SS:FF */
export function formatTimecode(frames: Frames, fps: number): string {
  const f = Math.max(0, Math.round(frames));
  const total = Math.floor(f / fps);
  const ff = f - total * fps;
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(h)}:${p(m)}:${p(s)}:${p(ff)}`;
}

export const clipEnd = (c: Pick<Clip, 'start' | 'duration'>): Frames => c.start + c.duration;

/** Number of source frames consumed by the clip's timeline duration. */
export function sourceSpan(c: Pick<Clip, 'duration' | 'speed'>): Frames {
  return Math.max(1, Math.round(c.duration * c.speed));
}

/**
 * Map a timeline frame to a source time in project-rate frames.
 * Returns null if the frame is outside the clip.
 * Reverse clips read the source backwards from the end of their consumed span.
 */
export function timelineToSource(c: Clip, frame: Frames): Frames | null {
  if (frame < c.start || frame >= clipEnd(c)) return null;
  if (c.freezeFrame !== undefined) return Math.max(0, Math.round(c.freezeFrame));
  const local = (frame - c.start) * c.speed;
  const span = sourceSpan(c);
  return c.reverse ? c.sourceIn + span - 1 - local : c.sourceIn + local;
}

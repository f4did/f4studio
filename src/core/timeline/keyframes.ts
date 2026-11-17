import type { Easing, Keyframe, KeyframeMap } from '../model/types';

function ease(value: number, easing: Easing): number {
  if (easing === 'easeIn') return value * value;
  if (easing === 'easeOut') return 1 - (1 - value) ** 2;
  if (easing === 'easeInOut') return value < 0.5 ? 2 * value * value : 1 - (-2 * value + 2) ** 2 / 2;
  return value;
}

export function evaluateKeyframes(frames: Keyframe[] | undefined, at: number, fallback: number): number {
  if (!frames?.length) return fallback;
  const sorted = [...frames].sort((a, b) => a.frame - b.frame);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return fallback;
  if (at <= first.frame) return first.value;
  if (at >= last.frame) return last.value;
  const index = sorted.findIndex((frame, i) => frame.frame <= at && sorted[i + 1]!.frame >= at);
  if (index < 0) return fallback;
  const a = sorted[index]!;
  const b = sorted[index + 1]!;
  if (a.easing === 'hold') return a.value;
  const span = Math.max(1, b.frame - a.frame);
  return a.value + (b.value - a.value) * ease((at - a.frame) / span, a.easing);
}

export function setKeyframe(map: KeyframeMap, path: string, frame: number, value: number, easing: Easing = 'easeInOut'): KeyframeMap {
  const next = { ...map };
  const frames = [...(next[path] ?? [])].filter((item) => item.frame !== frame);
  frames.push({ frame: Math.max(0, Math.round(frame)), value, easing });
  frames.sort((a, b) => a.frame - b.frame);
  next[path] = frames;
  return next;
}

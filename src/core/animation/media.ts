import type { AnimationRef, Clip } from '../model/types';

export interface MediaAnimationPreset { id: string; name: string; slot: 'in' | 'out' | 'loop' }
export interface MediaAnimationFrame { opacity: number; x: number; y: number; scale: number; rotation: number; blur: number }

const p = (id: string, name: string, slot: MediaAnimationPreset['slot']): MediaAnimationPreset => ({ id, name, slot });

export const MEDIA_ANIMATION_PRESETS: MediaAnimationPreset[] = [
  p('fade', 'Fade', 'in'), p('zoom-in', 'Zoom in', 'in'), p('zoom-out', 'Zoom out', 'in'), p('pop', 'Pop', 'in'),
  p('slide-left', 'Slide from left', 'in'), p('slide-right', 'Slide from right', 'in'), p('slide-up', 'Slide from top', 'in'), p('slide-down', 'Slide from bottom', 'in'),
  p('spin', 'Spin in', 'in'), p('drop', 'Drop & bounce', 'in'), p('blur', 'Blur reveal', 'in'),
  p('fade', 'Fade', 'out'), p('zoom-out', 'Zoom out', 'out'), p('slide-left', 'Slide to left', 'out'), p('slide-right', 'Slide to right', 'out'), p('spin', 'Spin away', 'out'), p('blur', 'Blur away', 'out'),
  p('ken-burns-in', 'Ken Burns zoom in', 'loop'), p('ken-burns-out', 'Ken Burns zoom out', 'loop'), p('pulse', 'Pulse', 'loop'), p('float', 'Float', 'loop'), p('sway', 'Sway', 'loop'), p('shake', 'Shake', 'loop'), p('spin-slow', 'Slow spin', 'loop'), p('heartbeat', 'Heartbeat', 'loop'),
];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeOut = (v: number) => 1 - (1 - v) ** 3;
const easeBack = (v: number) => { const c = 1.70158; const t = v - 1; return 1 + (c + 1) * t ** 3 + c * t ** 2; };

/** progress 0..1 into the animation (for out: 0 = fully visible, 1 = gone). */
function one(id: string, progress: number, mode: 'in' | 'out' | 'loop'): MediaAnimationFrame {
  const f: MediaAnimationFrame = { opacity: 1, x: 0, y: 0, scale: 1, rotation: 0, blur: 0 };
  const t = clamp01(progress);
  const e = easeOut(t);
  // For "in", e goes 0 -> 1 (hidden -> shown). For "out", use the inverse amount.
  const k = mode === 'out' ? t : 1 - e; // k = how far from the resting pose (0 rest, 1 extreme)
  switch (id) {
    case 'fade': f.opacity = 1 - k; break;
    case 'zoom-in': f.scale = 1 - 0.6 * k; f.opacity = 1 - k; break;
    case 'zoom-out': f.scale = mode === 'out' ? 1 - 0.6 * k : 1 + 0.6 * k; f.opacity = 1 - k; break;
    case 'pop': f.scale = mode === 'out' ? 1 - k : easeBack(t); f.opacity = mode === 'out' ? 1 - k : clamp01(t * 3); break;
    case 'slide-left': f.x = (mode === 'out' ? -1 : -1) * k * 1.1; break;
    case 'slide-right': f.x = k * 1.1; break;
    case 'slide-up': f.y = -k * 1.1; break;
    case 'slide-down': f.y = k * 1.1; break;
    case 'spin': f.rotation = (mode === 'out' ? 1 : -1) * k * 360; f.scale = 1 - 0.8 * k; f.opacity = 1 - k * 0.8; break;
    case 'drop': f.y = mode === 'out' ? k * 1.1 : -(1 - easeBounce(t)) * 1.1; f.opacity = mode === 'out' ? 1 - k : clamp01(t * 4); break;
    case 'blur': f.blur = k * 24; f.opacity = 1 - k * 0.7; break;
    case 'ken-burns-in': f.scale = 1 + 0.18 * t; f.x = -0.03 * t; break;
    case 'ken-burns-out': f.scale = 1.18 - 0.18 * t; f.x = 0.03 * (1 - t); break;
    case 'pulse': f.scale = 1 + Math.sin(t * Math.PI * 2) * 0.05; break;
    case 'float': f.y = Math.sin(t * Math.PI * 2) * 0.04; break;
    case 'sway': f.rotation = Math.sin(t * Math.PI * 2) * 4; break;
    case 'shake': f.x = Math.sin(t * Math.PI * 16) * 0.012; f.y = Math.cos(t * Math.PI * 13) * 0.012; break;
    case 'spin-slow': f.rotation = t * 360; break;
    case 'heartbeat': f.scale = 1 + (Math.exp(-((t * 4) % 1) * 6) * 0.08); break;
  }
  return f;
}

function easeBounce(t: number): number {
  const n1 = 7.5625, d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) { t -= 1.5 / d1; return n1 * t * t + 0.75; }
  if (t < 2.5 / d1) { t -= 2.25 / d1; return n1 * t * t + 0.9375; }
  t -= 2.625 / d1; return n1 * t * t + 0.984375;
}

const merge = (a: MediaAnimationFrame, b: MediaAnimationFrame): MediaAnimationFrame => ({
  opacity: a.opacity * b.opacity, x: a.x + b.x, y: a.y + b.y, scale: a.scale * b.scale, rotation: a.rotation + b.rotation, blur: Math.max(a.blur, b.blur),
});

/** Deterministic motion for a clip at a timeline frame (used by preview and export). */
export function evaluateMediaAnimation(clip: Pick<Clip, 'animation' | 'start' | 'duration'>, frame: number): MediaAnimationFrame {
  let out: MediaAnimationFrame = { opacity: 1, x: 0, y: 0, scale: 1, rotation: 0, blur: 0 };
  const a = clip.animation;
  if (!a) return out;
  const local = frame - clip.start;
  const dur = (ref: AnimationRef) => Math.max(1, Math.min(ref.durationFrames, clip.duration));
  if (a.in && local < dur(a.in)) out = merge(out, one(a.in.presetId, local / dur(a.in), 'in'));
  if (a.out) {
    const d = dur(a.out);
    const outStart = clip.duration - d;
    if (local >= outStart) out = merge(out, one(a.out.presetId, (local - outStart) / d, 'out'));
  }
  if (a.loop) {
    const id = a.loop.presetId;
    if (id.startsWith('ken-burns')) out = merge(out, one(id, local / Math.max(1, clip.duration), 'loop'));
    else { const d = Math.max(1, a.loop.durationFrames); out = merge(out, one(id, (((local % d) + d) % d) / d, 'loop')); }
  }
  return out;
}

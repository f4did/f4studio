import type { AnimationRef, Frames } from '../model/types';

export type AnimationCategory = 'entrance' | 'exit' | 'loop' | 'advanced';

export interface TextAnimationPreset {
  id: string;
  name: string;
  category: AnimationCategory;
  /** The deterministic motion family used by the canvas and future export renderer. */
  behavior: 'fade' | 'typewriter' | 'scale' | 'slide' | 'rotate' | 'blur' | 'bounce' | 'glitch' | 'pulse' | 'float' | 'wave' | 'flicker' | 'shake' | 'gradient' | 'mask' | 'flip';
}

const preset = (id: string, name: string, category: AnimationCategory, behavior: TextAnimationPreset['behavior']): TextAnimationPreset => ({ id, name, category, behavior });

export const TEXT_ANIMATION_PRESETS: TextAnimationPreset[] = [
  preset('fade-in', 'Fade in', 'entrance', 'fade'),
  preset('typewriter', 'Typewriter', 'entrance', 'typewriter'),
  preset('letter-reveal', 'Letter reveal', 'entrance', 'mask'),
  preset('word-reveal', 'Word reveal', 'entrance', 'mask'),
  preset('character-bounce', 'Character bounce', 'entrance', 'bounce'),
  preset('scale-pop', 'Scale pop', 'entrance', 'scale'),
  preset('zoom-in', 'Zoom in', 'entrance', 'scale'),
  preset('slide-left', 'Slide from left', 'entrance', 'slide'),
  preset('slide-right', 'Slide from right', 'entrance', 'slide'),
  preset('slide-up', 'Slide from top', 'entrance', 'slide'),
  preset('slide-down', 'Slide from bottom', 'entrance', 'slide'),
  preset('rotate-in', 'Rotate in', 'entrance', 'rotate'),
  preset('flip-in', 'Flip in', 'entrance', 'flip'),
  preset('blur-reveal', 'Blur reveal', 'entrance', 'blur'),
  preset('glitch-reveal', 'Glitch reveal', 'entrance', 'glitch'),
  preset('elastic-entrance', 'Elastic entrance', 'entrance', 'bounce'),
  preset('fade-out', 'Fade out', 'exit', 'fade'),
  preset('zoom-out', 'Zoom out', 'exit', 'scale'),
  preset('slide-away-left', 'Slide away left', 'exit', 'slide'),
  preset('slide-away-right', 'Slide away right', 'exit', 'slide'),
  preset('rotate-away', 'Rotate away', 'exit', 'rotate'),
  preset('character-fall', 'Character fall', 'exit', 'bounce'),
  preset('blur-out', 'Blur out', 'exit', 'blur'),
  preset('mask-wipe', 'Mask wipe', 'exit', 'mask'),
  preset('pulse', 'Pulse', 'loop', 'pulse'),
  preset('floating', 'Floating', 'loop', 'float'),
  preset('wave', 'Wave', 'loop', 'wave'),
  preset('neon-flicker', 'Neon flicker', 'loop', 'flicker'),
  preset('shake', 'Shake', 'loop', 'shake'),
  preset('bounce', 'Bounce', 'loop', 'bounce'),
  preset('breathing', 'Breathing', 'loop', 'pulse'),
  preset('gradient-movement', 'Gradient movement', 'loop', 'gradient'),
  preset('typewriter-loop', 'Typewriter loop', 'loop', 'typewriter'),
  preset('glitch-loop', 'Glitch loop', 'loop', 'glitch'),
  preset('per-character', 'Per-character cascade', 'advanced', 'mask'),
  preset('per-word', 'Per-word cascade', 'advanced', 'mask'),
  preset('text-on-path', 'Text on path', 'advanced', 'wave'),
  preset('animated-gradient', 'Animated gradient', 'advanced', 'gradient'),
  preset('text-mask', 'Text mask', 'advanced', 'mask'),
  preset('rotation-3d', '3D-style rotation', 'advanced', 'flip'),
  preset('kinetic-typography', 'Kinetic typography', 'advanced', 'wave'),
  preset('lower-third', 'Lower third', 'advanced', 'slide'),
  preset('animated-subtitles', 'Animated subtitles', 'advanced', 'typewriter'),
  preset('caption-pop', 'Caption pop', 'advanced', 'scale'),
  preset('caption-highlight', 'Caption highlight', 'advanced', 'gradient'),
  preset('glow-pulse', 'Glow pulse', 'advanced', 'pulse'),
  preset('rubber-band', 'Rubber band', 'advanced', 'bounce'),
  preset('split-reveal', 'Split reveal', 'advanced', 'mask'),
  preset('chromatic-glitch', 'Chromatic glitch', 'advanced', 'glitch'),
  preset('tracking-expansion', 'Tracking expansion', 'advanced', 'scale'),
];

export interface TextAnimationFrame {
  opacity: number;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  blur: number;
  letterSpacing: number;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const easeOut = (value: number) => 1 - (1 - value) ** 3;

/** Evaluate a preset using only timeline time, making preview and export deterministic. */
export function evaluateTextAnimation(ref: AnimationRef | undefined, progress: number, reverse = false): TextAnimationFrame {
  const preset = TEXT_ANIMATION_PRESETS.find((item) => item.id === ref?.presetId);
  if (!preset) return { opacity: 1, x: 0, y: 0, scale: 1, rotation: 0, blur: 0, letterSpacing: 0 };
  const p = clamp01(reverse ? 1 - progress : progress);
  const eased = easeOut(p);
  const base: TextAnimationFrame = { opacity: 1, x: 0, y: 0, scale: 1, rotation: 0, blur: 0, letterSpacing: 0 };
  switch (preset.behavior) {
    case 'fade': base.opacity = eased; break;
    case 'typewriter': base.opacity = p < 0.05 ? 0.2 : 1; base.letterSpacing = (1 - eased) * 8; break;
    case 'scale': base.scale = reverse ? 1 + (1 - eased) * 0.35 : 0.65 + eased * 0.35; base.opacity = eased; break;
    case 'slide': base.x = reverse ? (1 - eased) * 0.35 : (1 - eased) * -0.35; base.opacity = eased; break;
    case 'rotate': base.rotation = reverse ? (1 - eased) * 18 : (1 - eased) * -18; base.opacity = eased; break;
    case 'flip': base.scale = Math.max(0.05, Math.sin((reverse ? eased : 1 - eased) * Math.PI / 2)); base.opacity = eased; break;
    case 'blur': base.blur = (1 - eased) * 14; base.opacity = eased; break;
    case 'bounce': base.y = Math.sin(eased * Math.PI) * (reverse ? 0.08 : -0.08); base.scale = 0.85 + Math.sin(eased * Math.PI) * 0.15; break;
    case 'pulse': base.scale = 1 + Math.sin(p * Math.PI * 2) * 0.04; break;
    case 'float': base.y = Math.sin(p * Math.PI * 2) * 0.04; break;
    case 'wave': base.rotation = Math.sin(p * Math.PI * 2) * 4; base.y = Math.sin(p * Math.PI * 4) * 0.025; break;
    case 'flicker': base.opacity = 0.7 + (Math.sin(p * 71) + 1) * 0.15; break;
    case 'shake': base.x = Math.sin(p * Math.PI * 16) * 0.025; base.y = Math.cos(p * Math.PI * 13) * 0.025; break;
    case 'gradient': base.letterSpacing = Math.sin(p * Math.PI * 2) * 2; break;
    case 'mask': base.opacity = eased; base.x = (1 - eased) * -0.08; break;
    case 'glitch': base.x = Math.sin(p * 53) * 0.02; base.opacity = p > 0.08 ? 1 : 0.4; break;
  }
  return base;
}

export function animationRef(presetId: string, durationFrames: Frames): AnimationRef {
  return { presetId, durationFrames: Math.max(1, Math.round(durationFrames)), speed: 1 };
}

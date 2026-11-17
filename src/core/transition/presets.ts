import type { TransitionRef } from '../model/types';

export type TransitionBehavior = 'dissolve' | 'fadeBlack' | 'fadeWhite' | 'slide' | 'push' | 'zoom' | 'wipe' | 'spin' | 'glitch' | 'blur' | 'mosaic' | 'burn';

export interface TransitionPreset {
  id: string;
  name: string;
  category: 'basic' | 'slide' | 'zoom' | 'wipe' | 'creative';
  behavior: TransitionBehavior;
  direction: TransitionRef['direction'];
}

const t = (id: string, name: string, category: TransitionPreset['category'], behavior: TransitionBehavior, direction: TransitionRef['direction'] = 'none'): TransitionPreset => ({ id, name, category, behavior, direction });

export const TRANSITION_PRESETS: TransitionPreset[] = [
  t('cross-dissolve', 'Cross dissolve', 'basic', 'dissolve'),
  t('fade-black', 'Fade through black', 'basic', 'fadeBlack'),
  t('fade-white', 'Fade through white', 'basic', 'fadeWhite'),
  t('dip-color', 'Dip to color', 'basic', 'fadeBlack'),
  t('slide-left', 'Slide left', 'slide', 'slide', 'left'),
  t('slide-right', 'Slide right', 'slide', 'slide', 'right'),
  t('slide-up', 'Slide up', 'slide', 'slide', 'up'),
  t('slide-down', 'Slide down', 'slide', 'slide', 'down'),
  t('push-left', 'Push left', 'slide', 'push', 'left'),
  t('push-right', 'Push right', 'slide', 'push', 'right'),
  t('pull-left', 'Pull left', 'slide', 'push', 'left'),
  t('pull-right', 'Pull right', 'slide', 'push', 'right'),
  t('split-slide', 'Split slide', 'slide', 'slide', 'right'),
  t('zoom-in', 'Zoom in', 'zoom', 'zoom', 'none'),
  t('zoom-out', 'Zoom out', 'zoom', 'zoom', 'none'),
  t('zoom-blur', 'Zoom blur', 'zoom', 'blur', 'none'),
  t('punch-zoom', 'Punch zoom', 'zoom', 'zoom', 'none'),
  t('radial-zoom', 'Radial zoom', 'zoom', 'zoom', 'none'),
  t('linear-wipe', 'Linear wipe', 'wipe', 'wipe', 'right'),
  t('circular-wipe', 'Circular wipe', 'wipe', 'wipe', 'none'),
  t('iris', 'Iris', 'wipe', 'wipe', 'none'),
  t('diagonal-wipe', 'Diagonal wipe', 'wipe', 'wipe', 'right'),
  t('clock-wipe', 'Clock wipe', 'wipe', 'wipe', 'right'),
  t('glitch', 'Glitch', 'creative', 'glitch'),
  t('rgb-split', 'RGB split', 'creative', 'glitch'),
  t('pixel-dissolve', 'Pixel dissolve', 'creative', 'mosaic'),
  t('film-burn', 'Film burn', 'creative', 'burn'),
  t('light-leak', 'Light leak', 'creative', 'burn'),
  t('spin', 'Spin', 'creative', 'spin'),
  t('blur-dissolve', 'Blur dissolve', 'creative', 'blur'),
];

export interface TransitionFrame {
  alpha: number;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  blur: number;
  color?: string;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const ease = (value: number) => 1 - (1 - value) ** 3;

/** Deterministic transition motion shared by preview now and export later. */
export function evaluateTransition(ref: TransitionRef | undefined, progress: number): TransitionFrame {
  const preset = TRANSITION_PRESETS.find((item) => item.id === ref?.type);
  if (!preset) return { alpha: 1, x: 0, y: 0, scale: 1, rotation: 0, blur: 0 };
  const p = clamp01(progress);
  const e = ease(p);
  const intensity = Math.max(0, Math.min(2, ref?.intensity ?? 1));
  const result: TransitionFrame = { alpha: e, x: 0, y: 0, scale: 1, rotation: 0, blur: 0, color: ref?.color };
  if (preset.behavior === 'dissolve') result.alpha = e;
  if (preset.behavior === 'fadeBlack' || preset.behavior === 'fadeWhite') result.alpha = e;
  if (preset.behavior === 'slide' || preset.behavior === 'push') {
    const amount = (1 - e) * intensity;
    if (preset.direction === 'left') result.x = amount;
    if (preset.direction === 'right') result.x = -amount;
    if (preset.direction === 'up') result.y = amount;
    if (preset.direction === 'down') result.y = -amount;
    result.alpha = Math.min(1, e + 0.15);
  }
  if (preset.behavior === 'zoom') result.scale = 1 + (1 - e) * 0.65 * intensity;
  if (preset.behavior === 'wipe') result.alpha = e;
  if (preset.behavior === 'spin') { result.rotation = (1 - e) * 360 * intensity; result.scale = 0.75 + e * 0.25; }
  if (preset.behavior === 'glitch') { result.x = Math.sin(p * 67) * 0.025 * intensity; result.alpha = e; }
  if (preset.behavior === 'blur') result.blur = (1 - e) * 16 * intensity;
  if (preset.behavior === 'mosaic') result.blur = (1 - e) * 4 * intensity;
  if (preset.behavior === 'burn') result.alpha = Math.min(1, e * 1.3);
  return result;
}

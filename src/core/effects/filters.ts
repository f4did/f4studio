import { newId } from '../model/factory';
import type { EffectInstance } from '../model/types';

export type FilterCategory = 'cinematic' | 'vintage' | 'film' | 'retro' | 'warm' | 'cool' | 'monochrome' | 'social' | 'dreamy' | 'contrast';

export interface FilterPreset {
  id: string;
  name: string;
  category: FilterCategory;
  params: Record<string, number>;
}

const f = (id: string, name: string, category: FilterCategory, params: Record<string, number>): FilterPreset => ({ id, name, category, params });

export const FILTER_PRESETS: FilterPreset[] = [
  f('cinema-noir', 'Cinema Noir', 'cinematic', { contrast: 1.28, saturation: 0.72, brightness: -0.04 }),
  f('cinema-teal', 'Teal & Orange', 'cinematic', { contrast: 1.12, saturation: 1.18, hue: -8 }),
  f('cinema-night', 'Night Drive', 'cinematic', { contrast: 1.22, saturation: 0.82, brightness: -0.1, hue: 14 }),
  f('cinema-muted', 'Muted Drama', 'cinematic', { contrast: 1.18, saturation: 0.62, brightness: -0.02 }),
  f('vintage-fade', 'Vintage Fade', 'vintage', { contrast: 0.92, saturation: 0.78, sepia: 0.2, brightness: 0.05 }),
  f('vintage-amber', 'Amber Memory', 'vintage', { contrast: 1.02, saturation: 0.9, sepia: 0.34, hue: -8 }),
  f('vintage-copper', 'Copper Print', 'vintage', { contrast: 1.16, saturation: 0.82, sepia: 0.28, brightness: -0.02 }),
  f('vintage-wash', 'Washed Polaroid', 'vintage', { contrast: 0.84, saturation: 0.68, brightness: 0.1, sepia: 0.12 }),
  f('film-35mm', '35mm Print', 'film', { contrast: 1.08, saturation: 1.08, sepia: 0.06 }),
  f('film-super8', 'Super 8', 'film', { contrast: 1.2, saturation: 0.88, sepia: 0.18, brightness: 0.04 }),
  f('film-bleach', 'Bleach Bypass', 'film', { contrast: 1.36, saturation: 0.46, brightness: -0.03 }),
  f('film-soft', 'Soft Film', 'film', { contrast: 0.92, saturation: 0.92, brightness: 0.05, blur: 0.35 }),
  f('retro-vhs', 'VHS', 'retro', { contrast: 1.12, saturation: 1.12, hue: 8, blur: 0.2 }),
  f('retro-arcade', 'Arcade Glow', 'retro', { contrast: 1.3, saturation: 1.42, hue: -18, brightness: 0.02 }),
  f('retro-pop', 'Pop Flash', 'retro', { contrast: 1.24, saturation: 1.34, brightness: 0.08 }),
  f('retro-duotone', 'Duo Tone', 'retro', { contrast: 1.18, saturation: 0.3, sepia: 0.25, hue: 24 }),
  f('warm-sunset', 'Sunset', 'warm', { contrast: 1.04, saturation: 1.18, brightness: 0.06, hue: -12 }),
  f('warm-golden', 'Golden Hour', 'warm', { contrast: 1.08, saturation: 1.12, brightness: 0.08, sepia: 0.1 }),
  f('warm-candle', 'Candlelight', 'warm', { contrast: 1.12, saturation: 0.98, brightness: -0.02, hue: -18 }),
  f('warm-peach', 'Peach Skin', 'warm', { contrast: 0.98, saturation: 1.08, brightness: 0.06, hue: -6 }),
  f('cool-arctic', 'Arctic', 'cool', { contrast: 1.08, saturation: 0.88, hue: 24, brightness: 0.04 }),
  f('cool-moon', 'Moonlight', 'cool', { contrast: 1.2, saturation: 0.62, hue: 36, brightness: -0.08 }),
  f('cool-ocean', 'Ocean Blue', 'cool', { contrast: 1.06, saturation: 1.12, hue: 18 }),
  f('cool-steel', 'Steel', 'cool', { contrast: 1.24, saturation: 0.54, hue: 28, brightness: -0.02 }),
  f('mono-classic', 'Classic B&W', 'monochrome', { contrast: 1.18, saturation: 0 }),
  f('mono-highkey', 'High-Key Mono', 'monochrome', { contrast: 0.92, saturation: 0, brightness: 0.14 }),
  f('mono-lowkey', 'Low-Key Mono', 'monochrome', { contrast: 1.42, saturation: 0, brightness: -0.12 }),
  f('mono-silver', 'Silver Gelatin', 'monochrome', { contrast: 1.1, saturation: 0, brightness: 0.02, sepia: 0.06 }),
  f('social-vivid', 'Vivid Social', 'social', { contrast: 1.14, saturation: 1.36, brightness: 0.04 }),
  f('social-clean', 'Clean Creator', 'social', { contrast: 1.02, saturation: 1.08, brightness: 0.06 }),
  f('social-neon', 'Neon Night', 'social', { contrast: 1.32, saturation: 1.5, hue: -14, brightness: -0.04 }),
  f('social-portrait', 'Portrait Lift', 'social', { contrast: 0.96, saturation: 1.04, brightness: 0.1, blur: 0.15 }),
  f('dreamy-haze', 'Dreamy Haze', 'dreamy', { contrast: 0.86, saturation: 1.06, brightness: 0.1, blur: 0.45 }),
  f('dreamy-lavender', 'Lavender Dream', 'dreamy', { contrast: 0.92, saturation: 0.92, hue: 34, brightness: 0.08 }),
  f('dreamy-rose', 'Rose Glow', 'dreamy', { contrast: 0.94, saturation: 1.12, hue: -22, brightness: 0.08 }),
  f('dreamy-mist', 'Morning Mist', 'dreamy', { contrast: 0.8, saturation: 0.72, brightness: 0.14, blur: 0.3 }),
  f('contrast-crush', 'Contrast Crush', 'contrast', { contrast: 1.58, saturation: 1.08, brightness: -0.05 }),
  f('contrast-punch', 'Punch', 'contrast', { contrast: 1.34, saturation: 1.24, brightness: 0.02 }),
  f('contrast-flat', 'Flat Log', 'contrast', { contrast: 0.72, saturation: 0.78, brightness: 0.12 }),
  f('contrast-hdr', 'HDR Pop', 'contrast', { contrast: 1.48, saturation: 1.3, brightness: 0.05 }),
  f('cinema-blockbuster', 'Blockbuster', 'cinematic', { contrast: 1.26, saturation: 1.16, hue: -10, brightness: -0.03 }),
  f('cinema-matte', 'Matte Black', 'cinematic', { contrast: 0.94, saturation: 0.86, brightness: 0.02, sepia: 0.08 }),
  f('retro-neon-cyan', 'Cyan Neon', 'retro', { contrast: 1.42, saturation: 1.58, hue: 34, brightness: -0.02 }),
  f('retro-magenta', 'Magenta Flash', 'retro', { contrast: 1.28, saturation: 1.46, hue: -32, brightness: 0.03 }),
  f('warm-film-glow', 'Film Glow', 'warm', { contrast: 1.02, saturation: 1.2, brightness: 0.1, sepia: 0.12, blur: 0.18 }),
  f('cool-cyberpunk', 'Cyberpunk', 'cool', { contrast: 1.38, saturation: 1.62, hue: 48, brightness: -0.06 }),
  f('mono-soft', 'Soft Mono', 'monochrome', { contrast: 0.94, saturation: 0, brightness: 0.08, blur: 0.12 }),
  f('dreamy-bloom', 'Bloom Dream', 'dreamy', { contrast: 0.9, saturation: 1.18, brightness: 0.12, blur: 0.28 }),
];

export function effectsForFilter(id: string): EffectInstance[] {
  const preset = FILTER_PRESETS.find((item) => item.id === id);
  if (!preset) return [];
  return Object.entries(preset.params).map(([type, value]) => ({ id: newId('fx'), type, enabled: true, intensity: 1, params: { value } }));
}

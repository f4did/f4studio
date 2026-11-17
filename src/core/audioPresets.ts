import type { AudioProcessing, AudioSettings } from './model/types';

export interface AudioPreset {
  id: string;
  name: string;
  hint: string;
  speed: number;
  /** true = classic tape/vinyl behaviour (slower is lower), false = keep pitch. */
  tape: boolean;
  pitchSemitones: number;
  processing: Partial<AudioProcessing>;
}

export const AUDIO_PRESETS: AudioPreset[] = [
  { id: 'slow-reverb', name: 'Slow + Reverb', hint: 'soft / dreamy', speed: 0.85, tape: true, pitchSemitones: 0, processing: { reverb: 0.5, muffle: 0.12, warmth: 0.3, vinyl: 0.12, eqHigh: -2 } },
  { id: 'nightcore', name: 'Nightcore', hint: 'fast / bright', speed: 1.25, tape: true, pitchSemitones: 0, processing: { eqHigh: 3, reverb: 0.1 } },
  { id: 'daycore', name: 'Daycore', hint: 'low / heavy', speed: 0.8, tape: true, pitchSemitones: 0, processing: { eqLow: 3, reverb: 0.25, muffle: 0.2 } },
  { id: 'tape-ghost', name: 'Tape Ghost', hint: 'wobbly / haunted', speed: 0.92, tape: true, pitchSemitones: 0, processing: { wobble: 0.55, vinyl: 0.35, echo: 0.3, reverb: 0.4, warmth: 0.5, muffle: 0.25 } },
  { id: 'phonk', name: 'Phonk', hint: 'drive / cowbell punch', speed: 0.95, tape: true, pitchSemitones: 0, processing: { eqLow: 7, drive: 0.6, compressor: 0.55, limiter: 0.4 } },
  { id: 'funk-flip', name: 'Funk Flip', hint: 'groove / punchy', speed: 1.08, tape: false, pitchSemitones: 1, processing: { eqLow: 3, eqMid: 2, compressor: 0.4, warmth: 0.3 } },
  { id: 'qawwali-air', name: 'Qawwali Air', hint: 'airy / hall', speed: 1, tape: false, pitchSemitones: 0, processing: { reverb: 0.55, echo: 0.2, eqHigh: 3, warmth: 0.25 } },
  { id: 'clarity', name: 'Clarity Boost', hint: 'clean / present', speed: 1, tape: false, pitchSemitones: 0, processing: { eqLow: -2, eqMid: 3, eqHigh: 4, compressor: 0.35, limiter: 0.3 } },
  { id: 'bass-boost', name: 'Bass Boost', hint: 'subs / thump', speed: 1, tape: false, pitchSemitones: 0, processing: { eqLow: 10, drive: 0.25, limiter: 0.5 } },
  { id: 'telephone', name: 'Telephone', hint: 'narrow / lo-fi', speed: 1, tape: false, pitchSemitones: 0, processing: { eqLow: -14, eqHigh: -10, eqMid: 6, drive: 0.35, muffle: 0.35 } },
  { id: 'underwater', name: 'Underwater', hint: 'muffled / wavy', speed: 0.95, tape: true, pitchSemitones: 0, processing: { muffle: 0.85, wobble: 0.35, reverb: 0.3 } },
  { id: 'vintage-vinyl', name: 'Vintage Vinyl', hint: 'crackle / warm', speed: 1, tape: false, pitchSemitones: 0, processing: { vinyl: 0.6, warmth: 0.7, eqHigh: -3, muffle: 0.1 } },
];

export const FREQUENCY_LAB: Array<{ hz: number; name: string; hint: string }> = [
  { hz: 432, name: 'Relax', hint: 'soft / grounded' },
  { hz: 396, name: 'Ground', hint: 'release / reset' },
  { hz: 528, name: 'Meditate', hint: 'focus / restore' },
  { hz: 639, name: 'Heart', hint: 'warm / open' },
  { hz: 741, name: 'Clarity', hint: 'lift / clean' },
  { hz: 852, name: 'Intuition', hint: 'airy / wide' },
];

/** Semitones needed to retune A=440 material to A=hz. */
export function tuningSemitones(hz: number | undefined): number {
  if (!hz || !Number.isFinite(hz) || hz <= 0) return 0;
  return 12 * Math.log2(hz / 440);
}

/**
 * Total pitch correction (in semitones, fractional) applied after resampling for speed.
 * Tape mode lets pitch follow speed; otherwise speed is compensated so only tempo changes.
 */
export function effectivePitchSemitones(audio: Pick<AudioSettings, 'pitchSemitones' | 'tuningHz'>): number {
  return (audio.pitchSemitones || 0) + tuningSemitones(audio.tuningHz);
}

export function emptyProcessing(): AudioProcessing {
  return { eqLow: 0, eqMid: 0, eqHigh: 0, compressor: 0, limiter: 0, reverb: 0, echo: 0, warmth: 0, drive: 0, wobble: 0, vinyl: 0, muffle: 0 };
}

export function presetAudio(audio: AudioSettings, preset: AudioPreset): AudioSettings {
  return { ...audio, preservePitch: !preset.tape, pitchSemitones: preset.pitchSemitones, tuningHz: undefined, processing: { ...emptyProcessing(), ...preset.processing } };
}

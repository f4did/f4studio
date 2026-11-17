/** One-click editing helpers that combine analysis with the pure timeline operations. */
import { removeSourceRegions, type Id } from '../core';
import { useEditor } from '../store/editor';
import { silenceRegionsFor } from './waveform';

export interface AutoCutSettings { thresholdDb: number; minSilenceSec: number; padFrames: number }
export const DEFAULT_AUTOCUT: AutoCutSettings = { thresholdDb: -38, minSilenceSec: 0.45, padFrames: 4 };

/** Detect silences in the selected (or given) clip's source and cut them out, rippling the rest together. */
export async function autoCutSilence(clipId?: Id, settings: AutoCutSettings = DEFAULT_AUTOCUT): Promise<string> {
  const s = useEditor.getState();
  const id = clipId ?? (s.selection.length === 1 ? s.selection[0] : undefined);
  const project = s.project();
  const clip = id ? project.clips[id] : undefined;
  if (!clip || (clip.kind !== 'video' && clip.kind !== 'audio')) return 'Select a video or audio clip first.';
  const asset = clip.assetId ? project.assets[clip.assetId] : undefined;
  if (!asset) return 'This clip has no source media.';
  let regions;
  try {
    regions = await silenceRegionsFor(asset, { thresholdDb: settings.thresholdDb, minDurationSec: settings.minSilenceSec });
  } catch {
    return 'Could not analyse the audio of this clip (no audio track, or the codec is not decodable here).';
  }
  if (!regions.length) return 'No silences found (or this file\'s audio could not be decoded). Try a higher threshold or a shorter minimum length.';
  let result = { cuts: 0, removedFrames: 0 };
  const applied = useEditor.getState().apply((p) => {
    const r = removeSourceRegions(p, clip.id, regions, { padFrames: settings.padFrames });
    if (r.ok) result = { cuts: r.cuts, removedFrames: r.removedFrames };
    return r;
  });
  if (!applied) return useEditor.getState().message ?? 'Nothing could be cut.';
  const secs = result.removedFrames / project.settings.fps;
  return `Removed ${result.cuts} silence${result.cuts === 1 ? '' : 's'} (${secs.toFixed(1)} s). Undo with Ctrl/Cmd+Z.`;
}

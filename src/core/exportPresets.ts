/** Platform export presets. Pure data + a pure apply function so they can be unit-tested. */
import { dimensionsFor } from './model/factory';
import type { AspectRatioKey, ExportSettings, Fps, Project } from './model/types';

export interface ExportPreset {
  id: string;
  label: string;
  hint: string;
  aspect: AspectRatioKey;
  resolution: ExportSettings['resolution'];
  fps: Fps;
  videoBitrateKbps: number;
  audioBitrateKbps: number;
}

export const EXPORT_PRESETS: ExportPreset[] = [
  { id: 'youtube-1080', label: 'YouTube 1080p', hint: '16:9 · 30 fps · 8 Mbps', aspect: '16:9', resolution: 1080, fps: 30, videoBitrateKbps: 8000, audioBitrateKbps: 192 },
  { id: 'youtube-60', label: 'YouTube 1080p60', hint: '16:9 · 60 fps · 12 Mbps', aspect: '16:9', resolution: 1080, fps: 60, videoBitrateKbps: 12000, audioBitrateKbps: 192 },
  { id: 'shorts-tiktok', label: 'TikTok / Reels / Shorts', hint: '9:16 · 30 fps · 8 Mbps', aspect: '9:16', resolution: 1080, fps: 30, videoBitrateKbps: 8000, audioBitrateKbps: 192 },
  { id: 'instagram-square', label: 'Instagram square', hint: '1:1 · 30 fps · 6 Mbps', aspect: '1:1', resolution: 1080, fps: 30, videoBitrateKbps: 6000, audioBitrateKbps: 160 },
  { id: 'instagram-portrait', label: 'Instagram portrait', hint: '4:5 · 30 fps · 6 Mbps', aspect: '4:5', resolution: 1080, fps: 30, videoBitrateKbps: 6000, audioBitrateKbps: 160 },
  { id: 'cinema', label: 'Cinematic 21:9', hint: '21:9 · 24 fps · 10 Mbps', aspect: '21:9', resolution: 1080, fps: 24, videoBitrateKbps: 10000, audioBitrateKbps: 256 },
  { id: 'web-720', label: 'Web / email 720p', hint: '16:9 · 30 fps · 3 Mbps', aspect: '16:9', resolution: 720, fps: 30, videoBitrateKbps: 3000, audioBitrateKbps: 128 },
  { id: 'draft-480', label: 'Quick draft 480p', hint: '16:9 · 24 fps · 1.2 Mbps — fastest', aspect: '16:9', resolution: 480, fps: 24, videoBitrateKbps: 1200, audioBitrateKbps: 96 },
];

export function applyExportPreset(p: Project, preset: ExportPreset): Project {
  return {
    ...p,
    settings: { ...p.settings, aspect: preset.aspect, fps: preset.fps, ...dimensionsFor(preset.aspect) },
    export: { ...p.export, resolution: preset.resolution, fps: preset.fps, videoBitrateKbps: preset.videoBitrateKbps, audioBitrateKbps: preset.audioBitrateKbps },
    updatedAt: Date.now(),
  };
}

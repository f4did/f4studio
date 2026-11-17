/**
 * Pure export-option logic: turns the user's export settings into encoder
 * arguments, a file name and a size estimate. Kept free of DOM/ffmpeg imports
 * so every choice in the Export dialog is unit-testable.
 */
import type { ExportQuality, ExportSettings, ExportSpeed, Project } from './model/types';

export const QUALITY_OPTIONS: Array<{ id: ExportQuality; label: string; hint: string; crf: number; vp8Crf: number }> = [
  { id: 'draft', label: 'Draft', hint: 'Smallest file, visible compression', crf: 28, vp8Crf: 20 },
  { id: 'good', label: 'Good', hint: 'Great for sharing and messaging', crf: 23, vp8Crf: 12 },
  { id: 'high', label: 'High', hint: 'Recommended for YouTube & social', crf: 19, vp8Crf: 8 },
  { id: 'best', label: 'Best', hint: 'Near-lossless, large file', crf: 15, vp8Crf: 4 },
];

export const SPEED_OPTIONS: Array<{ id: ExportSpeed; label: string; hint: string; preset: string }> = [
  { id: 'fast', label: 'Fastest', hint: 'Quickest render, larger file', preset: 'ultrafast' },
  { id: 'balanced', label: 'Balanced', hint: 'Good speed and size', preset: 'veryfast' },
  { id: 'slow', label: 'Smallest file', hint: 'Slower render, best compression', preset: 'medium' },
];

export const FORMAT_OPTIONS = [
  { id: 'mp4' as const, label: 'MP4', detail: 'H.264 + AAC · plays everywhere', mime: 'video/mp4', videoCodec: 'h264' as const, audioCodec: 'aac' as const },
  { id: 'webm' as const, label: 'WebM', detail: 'VP8 + Opus · web & Chrome', mime: 'video/webm', videoCodec: 'vp8' as const, audioCodec: 'opus' as const },
];

export const RESOLUTION_OPTIONS: Array<ExportSettings['resolution']> = [360, 480, 720, 1080];

export function normalizedExport(settings: ExportSettings): Required<Omit<ExportSettings, 'fileName'>> & { fileName: string } {
  const format = FORMAT_OPTIONS.find((item) => item.id === settings.container) ?? FORMAT_OPTIONS[0]!;
  return {
    resolution: settings.resolution,
    fps: settings.fps,
    container: format.id,
    videoCodec: format.videoCodec,
    audioCodec: format.audioCodec,
    videoBitrateKbps: Math.max(200, Math.min(60000, Math.round(settings.videoBitrateKbps || 8000))),
    audioBitrateKbps: Math.max(48, Math.min(512, Math.round(settings.audioBitrateKbps || 192))),
    rateControl: settings.rateControl ?? 'quality',
    quality: settings.quality ?? 'high',
    speed: settings.speed ?? 'balanced',
    fileName: sanitizeFileName(settings.fileName ?? ''),
  };
}

export function sanitizeFileName(name: string): string {
  return name.replace(/\.(mp4|webm)$/i, '').replace(/[^a-z0-9-_ ]+/gi, '-').replace(/\s+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

export interface EncodePlan {
  args: string[];
  output: string;
  extension: 'mp4' | 'webm';
  mime: string;
}

/** Encoder arguments that follow `-t <duration> -r <fps>` in the ffmpeg command. */
export function buildEncodePlan(settings: ExportSettings, hasAudio: boolean): EncodePlan {
  const s = normalizedExport(settings);
  const format = FORMAT_OPTIONS.find((item) => item.id === s.container)!;
  const quality = QUALITY_OPTIONS.find((item) => item.id === s.quality)!;
  const speed = SPEED_OPTIONS.find((item) => item.id === s.speed)!;
  const args: string[] = [];
  if (s.container === 'mp4') {
    args.push('-c:v', 'libx264', '-preset', speed.preset);
    if (s.speed === 'fast') args.push('-tune', 'zerolatency');
    if (s.rateControl === 'bitrate') args.push('-b:v', `${s.videoBitrateKbps}k`, '-maxrate', `${Math.round(s.videoBitrateKbps * 1.5)}k`, '-bufsize', `${s.videoBitrateKbps * 2}k`);
    else args.push('-crf', String(quality.crf));
    args.push('-pix_fmt', 'yuv420p');
    if (hasAudio) args.push('-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', `${s.audioBitrateKbps}k`);
    args.push('-movflags', '+faststart');
  } else {
    args.push('-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', s.speed === 'slow' ? '4' : s.speed === 'balanced' ? '6' : '8');
    if (s.rateControl === 'bitrate') args.push('-b:v', `${s.videoBitrateKbps}k`);
    else args.push('-crf', String(quality.vp8Crf), '-b:v', `${Math.max(1500, Math.round(estimatedBitrateKbps(s)))}k`);
    args.push('-pix_fmt', 'yuv420p');
    if (hasAudio) args.push('-c:a', 'libopus', '-ar', '48000', '-ac', '2', '-b:a', `${s.audioBitrateKbps}k`);
  }
  const output = `f4-export.${format.id}`;
  return { args: [...args, output], output, extension: format.id, mime: format.mime };
}

/** Typical video bitrate (kbps) that a constant-quality encode lands on. Heuristic, used for estimates. */
export function estimatedBitrateKbps(settings: Pick<ExportSettings, 'resolution' | 'fps' | 'rateControl' | 'quality' | 'videoBitrateKbps'>): number {
  if (settings.rateControl === 'bitrate') return settings.videoBitrateKbps;
  const base1080p30 = { draft: 2500, good: 5000, high: 8000, best: 16000 }[settings.quality ?? 'high'];
  const pixels = (settings.resolution / 1080) ** 2;
  return base1080p30 * pixels * (settings.fps / 30) ** 0.7;
}

export function estimateSizeBytes(settings: ExportSettings, durationSec: number, hasAudio: boolean): number {
  const s = normalizedExport(settings);
  const video = estimatedBitrateKbps(s);
  const audio = hasAudio ? s.audioBitrateKbps : 0;
  return Math.round(((video + audio) * 1000 / 8) * Math.max(0, durationSec));
}

export function exportFileName(projectName: string, settings: ExportSettings): string {
  const s = normalizedExport(settings);
  const base = s.fileName || sanitizeFileName(projectName) || 'f4-project';
  return `${base}.${s.container}`;
}

const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);

/**
 * Resolve the requested export resolution as the short-edge/vertical resolution.
 * In a landscape 16:9 project, 1080p means 1920x1080; portrait and square keep their aspect.
 */
export function outputSize(project: Pick<Project, 'settings' | 'export'>): { width: number; height: number } {
  const aspect = project.settings.width / project.settings.height;
  const resolution = project.export.resolution;
  if (aspect >= 1) return { width: even(resolution * aspect), height: even(resolution) };
  return { width: even(resolution), height: even(resolution / aspect) };
}

/** Video bitrate in bits/s for the WebCodecs encoder. */
export function targetVideoBitrate(settings: ExportSettings): number {
  return Math.round(estimatedBitrateKbps(normalizedExport(settings)) * 1000);
}

/** H.264 codec string (High profile) whose level fits the frame size and rate. */
export function avcCodecString(width: number, height: number, fps: number, profile: '64' | '4d' | '42' = '64'): string {
  const macroblocksPerSecond = Math.ceil(width / 16) * Math.ceil(height / 16) * fps;
  const level = macroblocksPerSecond <= 108000 ? '1f' : macroblocksPerSecond <= 245760 ? '28' : macroblocksPerSecond <= 522240 ? '2a' : '33';
  return `avc1.${profile}00${level}`;
}

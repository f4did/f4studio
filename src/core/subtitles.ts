import { createClip } from './model/factory';
import type { Fps, Project } from './model/types';
import { addClip } from './timeline/operations';

export interface SubtitleCue {
  index: number;
  start: number;
  end: number;
  text: string;
}

/** Turn a plain transcript into readable, proportionally timed subtitle cues. */
export function transcriptToCues(input: string, fps: Fps, durationFrames: number): SubtitleCue[] {
  void fps;
  const normalized = input.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  const chunks = normalized.split(/(?<=[.!?])\s+/).flatMap((sentence) => {
    const words = sentence.trim().split(/\s+/).filter(Boolean);
    const result: string[] = [];
    for (let index = 0; index < words.length; index += 8) result.push(words.slice(index, index + 8).join(' '));
    return result;
  }).filter(Boolean);
  const totalWords = chunks.reduce((sum, chunk) => sum + chunk.split(/\s+/).length, 0);
  const endFrame = Math.max(1, Math.round(durationFrames));
  let cursor = 0;
  return chunks.map((text, index) => {
    const share = text.split(/\s+/).length / Math.max(1, totalWords);
    const next = index === chunks.length - 1 ? endFrame : Math.max(cursor + 1, Math.round(cursor + endFrame * share));
    const cue = { index: index + 1, start: cursor, end: next, text };
    cursor = next;
    return cue;
  });
}

function parseTimecode(value: string, fps: Fps): number {
  const match = value.trim().replace(',', '.').match(/^(\d+):(\d{2}):(\d{2})\.(\d{3})$/);
  if (!match) throw new Error(`Invalid SRT timecode: ${value}`);
  const [, hours, minutes, seconds, milliseconds] = match;
  return Math.round((Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds) + Number(milliseconds) / 1000) * fps);
}

export function parseSrt(input: string, fps: Fps): SubtitleCue[] {
  const blocks = input.replace(/^\uFEFF/, '').replace(/\r/g, '').split(/\n{2,}/);
  const cues: SubtitleCue[] = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    if (lines.length < 2) continue;
    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex < 0) continue;
    const [startRaw, endRaw] = lines[timingIndex]!.split('-->').map((item) => item.trim());
    if (!startRaw || !endRaw) throw new Error('Invalid SRT cue timing.');
    const start = parseTimecode(startRaw, fps);
    const end = parseTimecode(endRaw.split(' ')[0]!, fps);
    if (end <= start) continue;
    cues.push({ index: Number(lines[0]) || cues.length + 1, start, end, text: lines.slice(timingIndex + 1).join('\n').trim() });
  }
  return cues.filter((cue) => cue.text).sort((a, b) => a.start - b.start);
}

function formatTimecode(frame: number, fps: Fps): string {
  const totalMilliseconds = Math.round((frame / fps) * 1000);
  const ms = totalMilliseconds % 1000;
  const totalSeconds = Math.floor(totalMilliseconds / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

export function subtitlesToSrt(cues: SubtitleCue[], fps: Fps): string {
  return cues.map((cue, index) => `${index + 1}\n${formatTimecode(cue.start, fps)} --> ${formatTimecode(cue.end, fps)}\n${cue.text}`).join('\n\n') + (cues.length ? '\n' : '');
}

export function projectSubtitles(project: Project): SubtitleCue[] {
  return Object.values(project.clips).filter((clip) => clip.kind === 'text' && clip.text).sort((a, b) => a.start - b.start).map((clip, index) => ({ index: index + 1, start: clip.start, end: clip.start + clip.duration, text: clip.text!.text }));
}

export function addSubtitleCues(project: Project, cues: SubtitleCue[]): { ok: true; project: Project; added: number } | { ok: false; project: Project; reason: string } {
  const track = project.tracks.find((item) => item.kind === 'text' && !item.locked);
  if (!track) return { ok: false, project, reason: 'No unlocked text track is available.' };
  let next = project;
  let added = 0;
  for (const cue of cues) {
    const clip = createClip({ kind: 'text', trackId: track.id, name: `Subtitle ${cue.index}`, start: cue.start, duration: Math.max(1, cue.end - cue.start), text: { text: cue.text, style: { fontFamily: 'Inter, sans-serif', fontSize: 48, fontWeight: 700, letterSpacing: 0, lineHeight: 1.15, align: 'center', color: '#ffffff', background: { color: '#000000aa', padding: 12, radius: 8 } } } });
    const result = addClip(next, clip);
    if (!result.ok) continue;
    next = result.project;
    added += 1;
  }
  return { ok: true, project: next, added };
}

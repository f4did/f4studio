import { createClip, createProject, createTrack, defaultTransform, defaultVisualizer } from './model/factory';
import { animationRef } from './animation/presets';
import type { Clip, Project, TextStyle, TrackKind, VisualizerType } from './model/types';
import { addClip } from './timeline/operations';

export interface TemplateText {
  text: string;
  /** seconds */
  at: number;
  /** seconds */
  length: number;
  x?: number;
  y: number;
  size: number;
  weight?: number;
  color?: string;
  align?: 'left' | 'center' | 'right';
  family?: string;
  letterSpacing?: number;
  gradientTo?: string;
  animIn?: string;
  animOut?: string;
  animLoop?: string;
  countdown?: boolean;
  /** lane label shown in the timeline */
  lane?: string;
}

export interface TemplateSticker { glyph: string; name: string; at: number; length: number; x: number; y: number; scale: number; animIn?: string; animLoop?: string }

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  category: 'Music' | 'Social' | 'Creator' | 'Business' | 'Celebrate';
  aspect: '16:9' | '9:16' | '1:1';
  background: string;
  accent: string;
  /** seconds */
  durationSec: number;
  gradient?: { from: string; to: string; angle: number };
  /** id from the generated backdrop library (engine/generate BACKDROPS) */
  backdrop?: string;
  /** id from the generated song library (engine/synth SONGS) */
  song?: string;
  visualizer?: VisualizerType;
  progress?: VisualizerType;
  texts: TemplateText[];
  stickers?: TemplateSticker[];
  includeVisualizer?: boolean;
}

const S = (text: string, at: number, length: number, y: number, size: number, extra: Partial<TemplateText> = {}): TemplateText => ({ text, at, length, y, size, ...extra });

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  { id: 'lofi-slowed', name: 'Lofi · Slowed + Reverb', category: 'Music', description: 'Big title, subtitle, artist and channel credits, dotted-spike visualizer and a progress-bar frame — with a real lofi track included.', aspect: '16:9', background: '#1b1020', accent: '#ffd9a8', durationSec: 16, gradient: { from: '#e8946e', to: '#2c1a4a', angle: 90 }, backdrop: 'sunset', song: 'lofi', visualizer: 'dotline', progress: 'framepulse', includeVisualizer: true, texts: [] },
  { id: 'cinematic-travel', name: 'Cinematic Travel', category: 'Creator', description: 'Slow ken-burns backdrop, typewriter title, location lower third and a cinematic score.', aspect: '16:9', background: '#090b16', accent: '#a78bfa', durationSec: 12, backdrop: 'ocean', song: 'cinematic',
    texts: [S('WANDER FURTHER', 0.4, 4.6, -0.12, 96, { animIn: 'letter-reveal', animOut: 'fade-out', letterSpacing: 6, gradientTo: '#a78bfa' }), S('A CINEMATIC JOURNEY', 2, 4, 0.1, 40, { animIn: 'slide-down', animOut: 'fade-out', letterSpacing: 10, weight: 600 }), S('YOUR LOCATION', 6, 5, 0.78, 30, { x: -0.86, align: 'left', animIn: 'slide-left', animOut: 'fade-out', weight: 700, lane: 'Lower third' }), S('THE END', 8.6, 3, -0.02, 84, { animIn: 'zoom-in', weight: 800, letterSpacing: 8 })] },
  { id: 'reels-shorts', name: 'Reels & Shorts', category: 'Social', description: 'Vertical hook, punchy captions with pop animations, emoji stickers and an upbeat beat.', aspect: '9:16', background: '#160914', accent: '#f472b6', durationSec: 10, backdrop: 'candy', song: 'pop', progress: 'progressline',
    texts: [S('WAIT FOR IT…', 0, 2.6, -0.5, 84, { animIn: 'scale-pop', animLoop: 'pulse', gradientTo: '#f472b6' }), S('THE MOMENT', 2.8, 2.7, -0.2, 110, { animIn: 'character-bounce', animOut: 'fade-out' }), S('MAKE IT COUNT', 5.6, 3, 0.05, 86, { animIn: 'slide-up', animOut: 'fade-out' }), S('FOLLOW FOR MORE', 7.6, 2.4, 0.62, 56, { animIn: 'scale-pop', animLoop: 'pulse', weight: 800, lane: 'CTA' })],
    stickers: [{ glyph: '🔥', name: 'Fire', at: 2.8, length: 7, x: 0.62, y: -0.62, scale: 0.28, animIn: 'pop', animLoop: 'heartbeat' }, { glyph: '✨', name: 'Sparkles', at: 0, length: 10, x: -0.62, y: 0.52, scale: 0.22, animLoop: 'float' }] },
  { id: 'youtube-creator', name: 'YouTube Creator', category: 'Creator', description: 'Channel intro, animated lower third, chapter card and a subscribe call-to-action with bell.', aspect: '16:9', background: '#0b1117', accent: '#22d3ee', durationSec: 14, backdrop: 'midnight', song: 'pop', progress: 'progressline',
    texts: [S('F4 CREATOR', 0.2, 3.4, -0.08, 110, { animIn: 'scale-pop', animOut: 'fade-out', gradientTo: '#22d3ee' }), S('Your name · Your channel', 4, 4, 0.74, 32, { x: -0.86, align: 'left', animIn: 'slide-left', animOut: 'fade-out', weight: 700, lane: 'Lower third' }), S('CHAPTER 01 · THE SETUP', 8, 3, -0.04, 64, { animIn: 'slide-right', animOut: 'fade-out' }), S('SUBSCRIBE FOR MORE', 11, 3, 0.18, 62, { animIn: 'scale-pop', animLoop: 'pulse', lane: 'CTA' })],
    stickers: [{ glyph: '🔔', name: 'Bell', at: 11, length: 3, x: 0.52, y: 0.18, scale: 0.16, animIn: 'pop', animLoop: 'sway' }] },
  { id: 'music-visualizer', name: 'Music Visualizer', category: 'Music', description: 'Audio-reactive radial spectrum, title card and a progress line over a neon-drive track.', aspect: '16:9', background: '#10091c', accent: '#c084fc', durationSec: 16, backdrop: 'aurora', song: 'synthwave', visualizer: 'radial', progress: 'progressline', includeVisualizer: true,
    texts: [S('SONIC MOTION', 0.3, 7, -0.62, 76, { animIn: 'letter-reveal', gradientTo: '#c084fc', letterSpacing: 8 }), S('LIVE SESSION', 1.4, 7, 0.66, 40, { animIn: 'slide-up', weight: 600, letterSpacing: 12 }), S('NOW PLAYING', 8, 8, -0.62, 76, { animIn: 'zoom-in', gradientTo: '#22d3ee' })] },
  { id: 'podcast-wave', name: 'Podcast Wave', category: 'Creator', description: 'Speaker card, episode title, live waveform and a progress ring — drop your recording on the Music lane.', aspect: '16:9', background: '#07131a', accent: '#2dd4bf', durationSec: 16, backdrop: 'ocean', song: 'ambient', visualizer: 'linewave', progress: 'progressline', includeVisualizer: true,
    texts: [S('THE F4 PODCAST', 0.2, 6, -0.28, 84, { animIn: 'slide-down', gradientTo: '#2dd4bf' }), S('EPISODE 01 · CREATIVE CONTROL', 1.2, 6, -0.08, 38, { animIn: 'fade-in', weight: 600, letterSpacing: 4 }), S('Host name · Guest name', 2, 12, 0.78, 30, { x: -0.86, align: 'left', animIn: 'slide-left', weight: 700, lane: 'Speakers' })] },
  { id: 'neon-lyrics', name: 'Neon Lyrics', category: 'Music', description: 'Vertical lyric card with a glowing frame pulse, rounded bars and word-by-word lyric reveals.', aspect: '9:16', background: '#12071d', accent: '#f0abfc', durationSec: 14, backdrop: 'neon-grid', song: 'synthwave', visualizer: 'roundbars', progress: 'framepulse', includeVisualizer: true,
    texts: [S('YOUR LYRIC HERE', 0.3, 4.2, -0.22, 84, { animIn: 'word-reveal', animOut: 'fade-out', gradientTo: '#f0abfc' }), S('SLOWED + REVERB', 4.8, 4.4, 0.0, 70, { animIn: 'letter-reveal', animOut: 'fade-out' }), S('@YOURHANDLE', 9.6, 4.4, 0.5, 52, { animIn: 'slide-up', animLoop: 'pulse', weight: 700 })] },
  { id: 'product-launch', name: 'Product Launch', category: 'Business', description: 'Clean hero reveal, feature callouts and an end card with a rocket — square, ready for feeds.', aspect: '1:1', background: '#0b0d12', accent: '#60a5fa', durationSec: 12, backdrop: 'midnight', song: 'pop', progress: 'progresssegments',
    texts: [S('NEW DROP', 0.2, 3.2, -0.3, 110, { animIn: 'scale-pop', animOut: 'fade-out', gradientTo: '#60a5fa', family: 'Segoe UI, Arial, sans-serif' }), S('DESIGNED TO MOVE', 3.4, 3.6, 0.0, 76, { animIn: 'slide-right', animOut: 'fade-out', family: 'Segoe UI, Arial, sans-serif' }), S('AVAILABLE NOW', 7.4, 4.4, 0.36, 60, { animIn: 'zoom-in', animLoop: 'pulse', family: 'Segoe UI, Arial, sans-serif', lane: 'CTA' })],
    stickers: [{ glyph: '🚀', name: 'Rocket', at: 7.4, length: 4.6, x: 0, y: -0.38, scale: 0.34, animIn: 'drop', animLoop: 'float' }] },
  { id: 'birthday-party', name: 'Birthday Party', category: 'Celebrate', description: 'Confetti-bright backdrop, bouncing HAPPY BIRTHDAY title, party stickers and a cheerful tune.', aspect: '1:1', background: '#2b1055', accent: '#fbbf24', durationSec: 10, backdrop: 'candy', song: 'pop',
    texts: [S('HAPPY', 0.2, 9.6, -0.42, 150, { animIn: 'character-bounce', gradientTo: '#fbbf24' }), S('BIRTHDAY!', 1.0, 8.8, -0.02, 150, { animIn: 'character-bounce', animLoop: 'pulse', gradientTo: '#f472b6' }), S('to someone special', 2.4, 7.4, 0.42, 54, { animIn: 'fade-in', weight: 600 })],
    stickers: [{ glyph: '🎉', name: 'Party', at: 0.4, length: 9.6, x: -0.68, y: 0.62, scale: 0.26, animIn: 'pop', animLoop: 'sway' }, { glyph: '🎂', name: 'Cake', at: 1.2, length: 8.8, x: 0.68, y: 0.62, scale: 0.26, animIn: 'drop', animLoop: 'float' }, { glyph: '🎈', name: 'Balloon', at: 0.8, length: 9.2, x: 0.72, y: -0.62, scale: 0.22, animLoop: 'float' }] },
  { id: 'countdown-hype', name: 'Countdown Hype', category: 'Celebrate', description: 'A real 10-second countdown timer over an ember backdrop, ending with a big reveal.', aspect: '16:9', background: '#0c0a09', accent: '#f97316', durationSec: 13, backdrop: 'ember', song: 'cinematic', progress: 'progressline',
    texts: [S('COMING SOON', 0.2, 3.8, -0.42, 70, { animIn: 'slide-down', letterSpacing: 12, weight: 700 }), S('10', 0.5, 10, 0.05, 220, { countdown: true, animLoop: 'pulse', gradientTo: '#f97316', lane: 'Countdown' }), S("IT'S HERE", 10.6, 2.4, -0.02, 150, { animIn: 'scale-pop', animLoop: 'shake', gradientTo: '#fde68a' })] },
  { id: 'quote-card', name: 'Quote Card', category: 'Social', description: 'A calm quote on a soft gradient with a drifting sparkle and ambient music.', aspect: '1:1', background: '#1e1b4b', accent: '#c4b5fd', durationSec: 10, backdrop: 'lavender', song: 'ambient', progress: 'progressline',
    texts: [S('“Make something\nyou are proud of.”', 0.4, 8.6, -0.06, 76, { animIn: 'word-reveal', animOut: 'fade-out', color: '#1e1b4b', family: 'Georgia, serif', weight: 700 }), S('— YOUR NAME', 3.4, 5.6, 0.5, 34, { animIn: 'fade-in', color: '#4c1d95', weight: 700, letterSpacing: 8 })],
    stickers: [{ glyph: '✨', name: 'Sparkles', at: 0, length: 10, x: 0.66, y: -0.62, scale: 0.2, animLoop: 'float' }] },
];

/** Place a clip on the first track of `kind` where it fits, adding a new lane (above the existing ones of that kind) when it overlaps. */
export function placeOnLane(project: Project, kind: TrackKind, clip: Omit<Clip, 'trackId'> & { trackId?: string }, laneName?: string): Project {
  let next = project;
  const candidates = next.tracks.filter((t) => t.kind === kind);
  for (const track of candidates) {
    const r = addClip(next, { ...clip, trackId: track.id } as Clip);
    if (r.ok) return r.project;
  }
  const created = { ...createTrack(kind, candidates.length + 1), ...(laneName ? { name: laneName } : {}) };
  const firstOfKind = next.tracks.findIndex((t) => t.kind === kind);
  const at = firstOfKind < 0 ? 0 : firstOfKind;
  next = { ...next, tracks: [...next.tracks.slice(0, at), created, ...next.tracks.slice(at)] };
  const r = addClip(next, { ...clip, trackId: created.id } as Clip);
  return r.ok ? r.project : project;
}

export function createTemplateProject(templateId: string): Project {
  const template = PROJECT_TEMPLATES.find((item) => item.id === templateId) ?? PROJECT_TEMPLATES[0]!;
  const project = createProject(template.name, 30, template.aspect);
  if (template.id === 'lofi-slowed') return createLofiProject(project, template);
  const fps = project.settings.fps;
  const total = Math.round(template.durationSec * fps);
  const f = (sec: number) => Math.round(sec * fps);
  let next: Project = { ...project, settings: { ...project.settings, backgroundColor: template.background, ...(template.gradient ? { background: { type: 'linear' as const, ...template.gradient, opacity: 1 } } : {}) } };
  const textLane = next.tracks.find((t) => t.kind === 'text')!;
  for (const t of template.texts) {
    const style: TextStyle = { fontFamily: t.family ?? 'Arial, sans-serif', fontSize: t.size, fontWeight: t.weight ?? 800, letterSpacing: t.letterSpacing ?? 1, lineHeight: 1.1, align: t.align ?? 'center', color: t.color ?? '#ffffff', ...(t.gradientTo ? { gradient: { from: t.color ?? '#ffffff', to: t.gradientTo, angle: 90 } } : {}) };
    const dur = Math.max(1, Math.min(f(t.length), total - f(t.at)));
    const clip = createClip({ kind: 'text', trackId: textLane.id, name: t.lane ?? t.text.split('\n')[0]!.slice(0, 28), start: f(t.at), duration: dur, transform: { ...defaultTransform(), x: t.x ?? 0, y: t.y },
      text: { text: t.text, style, ...(t.countdown ? { timerMode: 'countdown' as const } : {}), ...(t.animIn ? { animationIn: animationRef(t.animIn, 18) } : {}), ...(t.animOut ? { animationOut: animationRef(t.animOut, 15) } : {}), ...(t.animLoop ? { animationLoop: animationRef(t.animLoop, 45) } : {}) } });
    next = placeOnLane(next, 'text', clip, 'Text');
  }
  for (const [type, label] of [[template.visualizer, 'Audio visualizer'], [template.progress, 'Progress bar']] as const) {
    if (!type) continue;
    next = placeOnLane(next, 'overlay', createClip({ kind: 'visualizer', trackId: '', name: label, start: 0, duration: total, visualizer: defaultVisualizer(type) }), label);
  }
  return next;
}

function createLofiProject(base: Project, template: ProjectTemplate): Project {
  const name = (track: ReturnType<typeof createTrack>, label: string) => ({ ...track, name: label });
  const progressTrack = name(createTrack('overlay', 1), 'Progress bar');
  const visualizerTrack = name(createTrack('overlay', 2), 'Audio visualizer');
  const titleTrack = name(createTrack('text', 1), 'Title');
  const subtitleTrack = name(createTrack('text', 2), 'Subtitle');
  const artistTrack = name(createTrack('text', 3), 'Artist');
  const channelTrack = name(createTrack('text', 4), 'Channel');
  const videoTrack = name(createTrack('video', 1), 'Video');
  const imageTrack = name(createTrack('image', 1), 'Background');
  const audioTrack = name(createTrack('audio', 1), 'Music');
  let next: Project = {
    ...base,
    settings: { ...base.settings, backgroundColor: template.background, background: { type: 'linear', from: '#e8946e', to: '#2c1a4a', angle: 90, opacity: 1 } },
    tracks: [progressTrack, visualizerTrack, titleTrack, subtitleTrack, artistTrack, channelTrack, videoTrack, imageTrack, audioTrack],
  };
  const total = Math.round(template.durationSec * base.settings.fps);
  const shadow = undefined;
  const text = (trackId: string, label: string, content: string, x: number, y: number, fontSize: number, fontWeight: number, align: 'left' | 'center' | 'right') => {
    const clip = createClip({ kind: 'text', trackId, name: label, start: 0, duration: total, transform: { ...defaultTransform(), x, y }, text: { text: content, style: { fontFamily: 'Arial, sans-serif', fontSize, fontWeight, letterSpacing: 0.5, lineHeight: 1.1, align, color: '#ffffff', shadow } } });
    const result = addClip(next, clip);
    if (result.ok) next = result.project;
  };
  text(titleTrack.id, 'Title', 'Song Title', 0, -0.14, 96, 800, 'center');
  text(subtitleTrack.id, 'Subtitle', '(Slowed + Reverb)', 0, 0.06, 44, 600, 'center');
  text(artistTrack.id, 'Artist', 'Artist Name', -0.9, 0.8, 34, 600, 'left');
  text(channelTrack.id, 'Channel', 'Your Channel | Reverb Echoes', 0.9, 0.8, 30, 600, 'right');
  const viz = createClip({ kind: 'visualizer', trackId: visualizerTrack.id, name: 'Audio visualizer', start: 0, duration: total, visualizer: defaultVisualizer('dotline') });
  const frame = createClip({ kind: 'visualizer', trackId: progressTrack.id, name: 'Progress bar', start: 0, duration: total, visualizer: defaultVisualizer('framepulse') });
  for (const clip of [viz, frame]) {
    const result = addClip(next, clip);
    if (result.ok) next = result.project;
  }
  return next;
}

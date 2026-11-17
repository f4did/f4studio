import {
  ASPECT_RATIOS,
  type AspectRatioKey,
  type AudioSettings,
  type Clip,
  type ClipKind,
  type Fps,
  type Id,
  type Project,
  type Track,
  type TrackKind,
  type Transform,
  PROGRESS_VISUALIZERS,
  type VisualizerConfig,
} from './types';

let counter = 0;
/** Unique within a session (counter) and across sessions (random + time). */
export function newId(prefix = 'id'): Id {
  counter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${rand}${counter.toString(36)}`;
}

/** Deep clone of JSON-shaped model data (the project model is JSON-serialisable by design). */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function defaultTransform(): Transform {
  return {
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    anchorX: 0.5,
    anchorY: 0.5,
    opacity: 1,
    flipH: false,
    flipV: false,
    crop: { left: 0, top: 0, right: 0, bottom: 0 },
    cornerRadius: 0,
  };
}

export function defaultAudio(): AudioSettings {
  return { volume: 1, pan: 0, muted: false, fadeInFrames: 0, fadeOutFrames: 0, pitchSemitones: 0, processing: { eqLow: 0, eqMid: 0, eqHigh: 0, compressor: 0, limiter: 0, reverb: 0, echo: 0 }, ducking: { enabled: false, amount: 0.5, attackFrames: 6, releaseFrames: 15 } };
}

export function isProgressVisualizer(type: VisualizerConfig['type']): boolean {
  return (PROGRESS_VISUALIZERS as readonly string[]).includes(type);
}

export function defaultVisualizer(type: VisualizerConfig['type'] = 'spectrum'): VisualizerConfig {
  const white = type === 'linewave' || type === 'framepulse' || type === 'dotline' || type === 'dotmatrix' || type === 'progressline' || type === 'progresssegments';
  const base: VisualizerConfig = { type, primaryColor: white ? '#ffffff' : '#a78bfa', secondaryColor: white ? '#ffffff' : '#22d3ee', bars: 48, sensitivity: 1, smoothing: 0.55, radius: 0.28, frequencyMin: 0, frequencyMax: 1, showBorder: type === 'framepulse', borderOpacity: 0.3, borderWidth: 2, waveformY: 0.84 };
  switch (type) {
    case 'dotline': return { ...base, bars: 110, waveformY: 0.9, primaryColor: '#ffffff', secondaryColor: '#161616' };
    case 'roundbars': return { ...base, bars: 40, waveformY: 0.82, primaryColor: '#ffffff', secondaryColor: '#c4b5fd' };
    case 'dotmatrix': return { ...base, bars: 36, waveformY: 0.8 };
    case 'ripple': return { ...base, radius: 0.12, waveformY: 0.5, primaryColor: '#ffffff', secondaryColor: '#a78bfa' };
    case 'framepulse': return { ...base, borderOpacity: 0.55, borderWidth: 4 };
    case 'progressline': return { ...base, borderOpacity: 0.9, borderWidth: 8, waveformY: 0.94, secondaryColor: '#c4b5fd' };
    case 'progresssegments': return { ...base, bars: 28, borderOpacity: 0.9, borderWidth: 14, waveformY: 0.93 };
    case 'progressring': return { ...base, radius: 0.14, borderOpacity: 0.9, borderWidth: 10, waveformY: 0.5, primaryColor: '#c4b5fd', secondaryColor: '#ffffff' };
    default: return base;
  }
}

export function createClip(
  partial: Pick<Clip, 'kind' | 'trackId' | 'start' | 'duration'> & Partial<Clip>,
): Clip {
  return {
    id: newId('clip'),
    name: partial.kind,
    sourceIn: 0,
    speed: 1,
    reverse: false,
    transform: defaultTransform(),
    audio: defaultAudio(),
    effects: [],
    keyframes: {},
    ...partial,
  };
}

const TRACK_LABEL: Record<TrackKind, string> = {
  video: 'Video',
  image: 'Image',
  audio: 'Audio',
  text: 'Text',
  overlay: 'Overlay',
  effect: 'Effects',
};

export function createTrack(kind: TrackKind, index: number): Track {
  return {
    id: newId('trk'),
    kind,
    name: `${TRACK_LABEL[kind]} ${index}`,
    height: 40,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    volume: 1,
  };
}

/** Which clip kinds a track kind accepts. */
export function trackAccepts(track: TrackKind, clip: ClipKind): boolean {
  // Lanes are organizational/compositing layers, not type restrictions.
  // Users can intentionally place any clip on any lane and reorder lanes for
  // the desired visual stacking order.
  void track;
  void clip;
  return true;
}

export function dimensionsFor(aspect: AspectRatioKey, longEdge = 1920): { width: number; height: number } {
  const [w, h] = ASPECT_RATIOS[aspect];
  // Cap at 1920x1080 class: the long edge never exceeds 1920 and the short edge never exceeds 1080.
  const scale = Math.min(longEdge / Math.max(w, h), 1080 / Math.min(w, h));
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return { width: even(w * scale), height: even(h * scale) };
}

export function createProject(name = 'Untitled project', fps: Fps = 30, aspect: AspectRatioKey = '16:9'): Project {
  const now = Date.now();
  const { width, height } = dimensionsFor(aspect);
  return {
    schemaVersion: 1,
    id: newId('prj'),
    name,
    createdAt: now,
    updatedAt: now,
    settings: { fps, aspect, width, height, backgroundColor: '#000000', background: { type: 'solid', from: '#000000', to: '#160b2b', angle: 135, opacity: 1 }, backgroundDurationFrames: fps * 5 },
    assets: {},
    tracks: [createTrack('overlay', 1), createTrack('text', 1), createTrack('video', 1), createTrack('image', 1), createTrack('audio', 1)],
    clips: {},
    markers: [],
    export: {
      resolution: 1080,
      fps,
      container: 'mp4',
      videoCodec: 'h264',
      audioCodec: 'aac',
      videoBitrateKbps: 8000,
      audioBitrateKbps: 192,
      rateControl: 'quality',
      quality: 'high',
      speed: 'fast',
    },
  };
}

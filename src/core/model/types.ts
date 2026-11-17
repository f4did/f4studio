/**
 * Canonical project data model for F4 Clip Editor.
 *
 * Independent of the UI: no React, no DOM types. All timeline timing is stored
 * as INTEGER FRAMES at the project frame rate. Seconds are only derived for display
 * or for source-media seeking (see core/timeline/time.ts).
 */

export type Id = string;
export type Frames = number; // integer, project-frame-rate units

export const SUPPORTED_FPS = [24, 25, 30, 60] as const;
export type Fps = (typeof SUPPORTED_FPS)[number];

export const ASPECT_RATIOS = {
  '16:9': [16, 9],
  '9:16': [9, 16],
  '1:1': [1, 1],
  '4:5': [4, 5],
  '3:2': [3, 2],
  '21:9': [21, 9],
} as const;
export type AspectRatioKey = keyof typeof ASPECT_RATIOS;

export type TrackKind = 'video' | 'image' | 'audio' | 'text' | 'overlay' | 'effect';

export type ClipKind =
  | 'video'
  | 'image'
  | 'audio'
  | 'text'
  | 'shape'
  | 'visualizer'
  | 'effect';

/** Progress styles need no audio: they fill from 0 to 100% over the clip's length. */
export const PROGRESS_VISUALIZERS = ['framepulse', 'progressline', 'progressring', 'progresssegments'] as const;

export type VisualizerType = 'spectrum' | 'radial' | 'oscilloscope' | 'mirrored' | 'heartbeat' | 'orbit' | 'countdown' | 'linewave' | 'framepulse' | 'dotline' | 'roundbars' | 'dotmatrix' | 'ripple' | 'progressline' | 'progressring' | 'progresssegments';

export interface VisualizerConfig {
  type: VisualizerType;
  primaryColor: string;
  secondaryColor: string;
  bars: number;
  sensitivity: number;
  smoothing: number;
  radius: number;
  frequencyMin: number;
  frequencyMax: number;
  showBorder?: boolean;
  borderOpacity?: number;
  borderWidth?: number;
  waveformY?: number;
}

// ---------- Keyframes ----------

export type Easing = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'hold';

export interface Keyframe {
  /** Frame offset relative to the clip's start on the timeline (not absolute). */
  frame: Frames;
  value: number;
  easing: Easing;
}

/** Map of property path (e.g. "transform.x", "audio.volume") -> sorted keyframes. */
export type KeyframeMap = Record<string, Keyframe[]>;

// ---------- Properties ----------

export interface Transform {
  /** Normalized canvas units: 0 = centre, ±1 = canvas half-extent. */
  x: number;
  y: number;
  /** Size relative to the canvas (1 = fills canvas along fit axis). */
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
  /** Degrees. */
  rotation: number;
  /** Anchor in 0..1 of the clip box. */
  anchorX: number;
  anchorY: number;
  opacity: number; // 0..1
  flipH: boolean;
  flipV: boolean;
  /** Crop as fractions 0..1 trimmed from each edge. */
  crop: { left: number; top: number; right: number; bottom: number };
  cornerRadius: number;
}

export interface AudioSettings {
  volume: number; // linear gain, 1 = 0 dB
  pan: number; // -1..1
  muted: boolean;
  fadeInFrames: Frames;
  fadeOutFrames: Frames;
  pitchSemitones: number;
  /** Keep the original pitch when speed changes (default true). false = tape style: slower is lower. */
  preservePitch?: boolean;
  /** Reference tuning in Hz (A=440 baseline). Shifts pitch by 12*log2(hz/440) semitones. */
  tuningHz?: number;
  processing: AudioProcessing;
  ducking?: DuckingSettings;
}

export interface DuckingSettings {
  enabled: boolean;
  sidechainTrackId?: Id;
  amount: number;
  attackFrames: Frames;
  releaseFrames: Frames;
}

export interface AudioProcessing {
  eqLow: number;
  eqMid: number;
  eqHigh: number;
  compressor: number;
  limiter: number;
  reverb: number;
  echo: number;
  /** 0..1 analogue warmth (soft low-shelf lift + gentle saturation). */
  warmth?: number;
  /** 0..1 harmonic drive / saturation. */
  drive?: number;
  /** 0..1 tape wow & flutter (pitch wobble). */
  wobble?: number;
  /** 0..1 vinyl crackle and hiss. */
  vinyl?: number;
  /** 0..1 low-pass muffling (underwater / far-away). */
  muffle?: number;
}

export interface EffectInstance {
  id: Id;
  /** Registry key, e.g. "brightness", "vignette". */
  type: string;
  enabled: boolean;
  intensity: number; // 0..1 mix
  params: Record<string, number | string | boolean>;
}

export interface TransitionRef {
  id: Id;
  type: string;
  durationFrames: Frames;
  direction: 'left' | 'right' | 'up' | 'down' | 'none';
  intensity: number;
  color?: string;
  params: Record<string, number | string | boolean>;
}

export interface TextStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  italic?: boolean;
  underline?: boolean;
  letterSpacing: number;
  lineHeight: number;
  align: 'left' | 'center' | 'right';
  color: string;
  gradient?: { from: string; to: string; angle: number };
  outline?: { color: string; width: number };
  shadow?: { color: string; blur: number; offsetX: number; offsetY: number };
  background?: { color: string; padding: number; radius: number };
}

export interface TextContent {
  text: string;
  style: TextStyle;
  timerMode?: 'stopwatch' | 'countdown';
  /** Animation preset ids from the animation registry. */
  animationIn?: AnimationRef;
  animationOut?: AnimationRef;
  animationLoop?: AnimationRef;
}

export interface AnimationRef {
  presetId: string;
  durationFrames: Frames;
  speed: number;
}

// ---------- Clips / tracks / assets ----------

export interface Clip {
  id: Id;
  kind: ClipKind;
  trackId: Id;
  assetId?: Id;
  name: string;

  /** Position on the timeline. */
  start: Frames;
  /** Length on the timeline. Always >= 1. */
  duration: Frames;

  /** Source in-point in source frames-at-project-rate. Ignored for generated clips. */
  sourceIn: Frames;
  /** Playback speed multiplier. 1 = normal. Source consumed = duration * speed. */
  speed: number;
  reverse: boolean;
  /** Optional source frame held for the entire clip duration. */
  freezeFrame?: Frames;

  transform: Transform;
  audio: AudioSettings;
  effects: EffectInstance[];
  /** Transition applied at the head of this clip (blending from previous clip). */
  transitionIn?: TransitionRef;
  /** Motion presets for image / video / visualizer clips (text uses text.animation*). */
  animation?: { in?: AnimationRef; out?: AnimationRef; loop?: AnimationRef };
  text?: TextContent;
  visualizer?: VisualizerConfig;
  keyframes: KeyframeMap;

  groupId?: Id;
  locked?: boolean;
}

export interface Track {
  id: Id;
  kind: TrackKind;
  name: string;
  height: number;
  locked: boolean;
  visible: boolean;
  muted: boolean;
  solo: boolean;
  volume: number;
}

export type AssetKind = 'video' | 'image' | 'audio';

export interface Asset {
  id: Id;
  kind: AssetKind;
  name: string;
  mimeType: string;
  sizeBytes: number;
  /** Seconds. Images use a default still duration. */
  durationSec: number;
  width?: number;
  height?: number;
  fps?: number;
  hasAudio?: boolean;
  /** Key of the blob in IndexedDB. Blob itself is never stored in the project JSON. */
  blobKey: string;
  addedAt: number;
  artist?: string;
  coverAssetId?: Id;
}

export interface Marker {
  id: Id;
  frame: Frames;
  label: string;
  color: string;
}

export type ExportQuality = 'draft' | 'good' | 'high' | 'best';
export type ExportSpeed = 'fast' | 'balanced' | 'slow';

export interface ExportSettings {
  resolution: 360 | 480 | 720 | 1080;
  fps: Fps;
  container: 'mp4' | 'webm';
  videoCodec: 'h264' | 'vp8';
  audioCodec: 'aac' | 'opus';
  /** Target bitrate; only used when rateControl is 'bitrate'. */
  videoBitrateKbps: number;
  audioBitrateKbps: number;
  /** Constant-quality (default) or target-bitrate encoding. */
  rateControl?: 'quality' | 'bitrate';
  quality?: ExportQuality;
  speed?: ExportSpeed;
  /** File name without extension. */
  fileName?: string;
}

export interface ProjectSettings {
  fps: Fps;
  aspect: AspectRatioKey;
  /** Canvas pixel size at 1080-class resolution. Max 1920x1080 (no 4K). */
  width: number;
  height: number;
  backgroundColor: string;
  background?: { type: 'solid' | 'linear' | 'radial'; from: string; to: string; angle: number; opacity: number };
  /** Default opening canvas duration for a fresh blank project. Set to 0 to remove it. */
  backgroundDurationFrames?: Frames;
}

export interface Project {
  schemaVersion: 1;
  id: Id;
  name: string;
  createdAt: number;
  updatedAt: number;
  settings: ProjectSettings;
  assets: Record<Id, Asset>;
  tracks: Track[];
  /** Flat map; clip.trackId is the single source of truth for membership. */
  clips: Record<Id, Clip>;
  markers: Marker[];
  export: ExportSettings;
}

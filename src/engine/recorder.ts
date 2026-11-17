/**
 * Browser recorder: screen capture, webcam and voice-over via getDisplayMedia / getUserMedia
 * + MediaRecorder. Pure helpers (mime negotiation, file naming, formatting) are exported
 * separately so they can be unit-tested without a browser.
 */

export type RecordKind = 'screen' | 'webcam' | 'voice';

const VIDEO_MIMES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=h264,opus', 'video/mp4', 'video/webm'];
const AUDIO_MIMES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'];

/** First mime type the browser can record, or undefined to let it choose. */
export function pickMimeType(kind: RecordKind, isSupported: (mime: string) => boolean): string | undefined {
  const list = kind === 'voice' ? AUDIO_MIMES : VIDEO_MIMES;
  return list.find((m) => isSupported(m));
}

export function extensionForMime(mime: string, kind: RecordKind): string {
  const m = mime.toLowerCase();
  if (m.includes('mp4')) return kind === 'voice' ? 'm4a' : 'mp4';
  if (m.includes('ogg')) return 'ogg';
  return 'webm';
}

export function recordingFileName(kind: RecordKind, mime: string, at: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}.${pad(at.getMinutes())}.${pad(at.getSeconds())}`;
  const label = kind === 'screen' ? 'Screen recording' : kind === 'webcam' ? 'Webcam recording' : 'Voice-over';
  return `${label} ${stamp}.${extensionForMime(mime, kind)}`;
}

export function formatElapsed(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export interface RecordOptions {
  kind: RecordKind;
  /** Capture the microphone (screen: narrate; webcam: always on unless false; voice: required). */
  mic?: boolean;
  /** Screen only: request system / tab audio in the share picker. */
  systemAudio?: boolean;
  micDeviceId?: string;
  cameraDeviceId?: string;
  /** Webcam height hint, default 720. */
  cameraHeight?: number;
}

export interface RecordingResult {
  blob: Blob;
  mimeType: string;
  fileName: string;
  durationSec: number;
  kind: RecordKind;
}

export function recordingSupport(): { screen: boolean; media: boolean; recorder: boolean } {
  const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
  return {
    screen: Boolean(md && typeof md.getDisplayMedia === 'function'),
    media: Boolean(md && typeof md.getUserMedia === 'function'),
    recorder: typeof MediaRecorder !== 'undefined',
  };
}

export function describeMediaError(error: unknown): string {
  const name = error instanceof DOMException || (error && typeof error === 'object' && 'name' in error) ? String((error as { name: unknown }).name) : '';
  switch (name) {
    case 'NotAllowedError': return 'Permission was denied. Allow access in the browser prompt or the address-bar site settings and try again.';
    case 'NotFoundError': return 'No matching camera or microphone was found.';
    case 'NotReadableError': return 'The device is busy or blocked by another app.';
    case 'OverconstrainedError': return 'That device cannot satisfy the requested settings.';
    case 'AbortError': return 'The capture was cancelled.';
    case 'SecurityError': return 'Recording needs a secure page (https or localhost).';
    default: return error instanceof Error ? error.message : 'Recording failed.';
  }
}

// Helper keeps the buffer type valid across TypeScript 5.6 (plain Uint8Array) and 5.7+ (Uint8Array<ArrayBuffer>).
const newLevelBuffer = (size: number) => new Uint8Array(size);

export class Recorder {
  readonly stream: MediaStream;
  readonly kind: RecordKind;
  private readonly recorder: MediaRecorder;
  private readonly chunks: Blob[] = [];
  private readonly mime: string;
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private levelBuf: ReturnType<typeof newLevelBuffer> | null = null;
  private startedAt = 0;
  private pausedAt = 0;
  private pausedTotal = 0;
  private stopping: Promise<RecordingResult> | null = null;
  private readonly owned: MediaStream[];
  /** Fires when the user ends capture from the browser's own "Stop sharing" bar. */
  onEnded: (() => void) | null = null;

  private constructor(kind: RecordKind, stream: MediaStream, owned: MediaStream[], audioCtx: AudioContext | null, analyser: AnalyserNode | null) {
    this.kind = kind;
    this.stream = stream;
    this.owned = owned;
    this.audioCtx = audioCtx;
    this.analyser = analyser;
    if (analyser) this.levelBuf = newLevelBuffer(analyser.fftSize);
    this.mime = pickMimeType(kind, (m) => MediaRecorder.isTypeSupported(m)) ?? '';
    this.recorder = new MediaRecorder(stream, this.mime ? { mimeType: this.mime, videoBitsPerSecond: 6_000_000 } : undefined);
    this.recorder.ondataavailable = (e) => { if (e.data.size > 0) this.chunks.push(e.data); };
    const firstVideo = stream.getVideoTracks()[0];
    if (firstVideo) firstVideo.addEventListener('ended', () => { if (this.recorder.state !== 'inactive') this.onEnded?.(); });
  }

  static async start(options: RecordOptions): Promise<Recorder> {
    const support = recordingSupport();
    if (!support.recorder) throw new Error('This browser does not support recording (MediaRecorder is missing).');
    const owned: MediaStream[] = [];
    try {
      let video: MediaStream | null = null;
      let mic: MediaStream | null = null;
      if (options.kind === 'screen') {
        if (!support.screen) throw new Error('Screen capture is not available in this browser.');
        video = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: options.systemAudio ?? false });
        owned.push(video);
        if (options.mic) mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, ...(options.micDeviceId ? { deviceId: { exact: options.micDeviceId } } : {}) } });
      } else if (options.kind === 'webcam') {
        if (!support.media) throw new Error('Camera access is not available in this browser.');
        const wantMic = options.mic !== false;
        video = await navigator.mediaDevices.getUserMedia({
          video: { height: { ideal: options.cameraHeight ?? 720 }, frameRate: { ideal: 30 }, ...(options.cameraDeviceId ? { deviceId: { exact: options.cameraDeviceId } } : {}) },
          audio: wantMic ? { echoCancellation: true, noiseSuppression: true, ...(options.micDeviceId ? { deviceId: { exact: options.micDeviceId } } : {}) } : false,
        });
        owned.push(video);
      } else {
        if (!support.media) throw new Error('Microphone access is not available in this browser.');
        mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, ...(options.micDeviceId ? { deviceId: { exact: options.micDeviceId } } : {}) } });
      }
      if (mic) owned.push(mic);

      // Mix every audio source (system audio + mic, or webcam mic) into one track + level meter.
      const sources = [...(video?.getAudioTracks() ?? []), ...(mic?.getAudioTracks() ?? [])];
      let audioCtx: AudioContext | null = null;
      let analyser: AnalyserNode | null = null;
      let mixedTrack: MediaStreamTrack | null = null;
      if (sources.length) {
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        audioCtx = new Ctx();
        const dest = audioCtx.createMediaStreamDestination();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        for (const track of sources) audioCtx.createMediaStreamSource(new MediaStream([track])).connect(dest);
        dest.stream.getAudioTracks().forEach((t) => { mixedTrack = t; });
        if (mixedTrack) audioCtx.createMediaStreamSource(new MediaStream([mixedTrack])).connect(analyser);
      }
      const tracks: MediaStreamTrack[] = [...(video?.getVideoTracks() ?? [])];
      if (mixedTrack) tracks.push(mixedTrack);
      if (!tracks.length) throw new Error('No audio or video was captured. Make sure the share picker included audio.');
      return new Recorder(options.kind, new MediaStream(tracks), owned, audioCtx, analyser);
    } catch (error) {
      owned.forEach((s) => s.getTracks().forEach((t) => t.stop()));
      throw error;
    }
  }

  begin(): void {
    this.startedAt = performance.now();
    this.recorder.start(1000);
  }

  get state(): RecordingState {
    return this.recorder.state;
  }

  elapsedSec(): number {
    if (!this.startedAt) return 0;
    const now = this.recorder.state === 'paused' ? this.pausedAt : performance.now();
    return Math.max(0, (now - this.startedAt - this.pausedTotal) / 1000);
  }

  /** 0..1 input level for a live meter. */
  level(): number {
    if (!this.analyser || !this.levelBuf) return 0;
    this.analyser.getByteTimeDomainData(this.levelBuf);
    let peak = 0;
    for (const v of this.levelBuf) peak = Math.max(peak, Math.abs(v - 128) / 128);
    return Math.min(1, peak * 1.6);
  }

  pause(): void {
    if (this.recorder.state !== 'recording') return;
    this.recorder.pause();
    this.pausedAt = performance.now();
  }

  resume(): void {
    if (this.recorder.state !== 'paused') return;
    this.pausedTotal += performance.now() - this.pausedAt;
    this.recorder.resume();
  }

  stop(): Promise<RecordingResult> {
    if (this.stopping) return this.stopping;
    const durationSec = this.elapsedSec();
    this.stopping = new Promise<RecordingResult>((resolve, reject) => {
      const finish = () => {
        this.release();
        const type = this.recorder.mimeType || this.mime || (this.kind === 'voice' ? 'audio/webm' : 'video/webm');
        const blob = new Blob(this.chunks, { type });
        if (!blob.size) return reject(new Error('The recording was empty.'));
        resolve({ blob, mimeType: type, fileName: recordingFileName(this.kind, type), durationSec, kind: this.kind });
      };
      this.recorder.onstop = finish;
      this.recorder.onerror = () => { this.release(); reject(new Error('The recorder failed.')); };
      if (this.recorder.state === 'inactive') finish();
      else this.recorder.stop();
    });
    return this.stopping;
  }

  /** Abandon the capture without producing a file. */
  cancel(): void {
    this.recorder.ondataavailable = null;
    this.recorder.onstop = null;
    try { if (this.recorder.state !== 'inactive') this.recorder.stop(); } catch { /* ignore */ }
    this.release();
  }

  private release(): void {
    this.owned.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    this.stream.getTracks().forEach((t) => t.stop());
    if (this.audioCtx) void this.audioCtx.close().catch(() => undefined);
    this.audioCtx = null;
    this.analyser = null;
  }
}

export async function listDevices(): Promise<{ mics: MediaDeviceInfo[]; cameras: MediaDeviceInfo[] }> {
  if (!navigator.mediaDevices?.enumerateDevices) return { mics: [], cameras: [] };
  const all = await navigator.mediaDevices.enumerateDevices();
  return { mics: all.filter((d) => d.kind === 'audioinput'), cameras: all.filter((d) => d.kind === 'videoinput') };
}

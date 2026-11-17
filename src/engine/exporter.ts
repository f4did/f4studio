/**
 * Native export pipeline: frames come from the same canvas renderer as the preview
 * (so effects, transitions, animations and visualizers match exactly), audio is mixed
 * offline with the same effect chain, and both are encoded with the browser's own
 * WebCodecs encoders (hardware accelerated where available) into MP4 or WebM.
 * Falls back to a real-time MediaRecorder capture when WebCodecs is unavailable.
 */
import { avcCodecString, isProgressVisualizer, normalizedExport, outputSize, projectDuration, targetVideoBitrate, type Project } from '../core';
import { FrameAnalyser } from './audioAnalysis';
import { hasAudibleAudio, MIX_RATE, mixProject } from './audioMix';
import { getBlob } from './db';
import { Mp4Muxer, WebmMuxer, type AudioTrackInfo, type Sample, type VideoTrackInfo } from './muxers';
import { PlaybackEngine } from './playback';

export { outputSize };

export interface ExportProgress {
  phase: 'loading' | 'rendering' | 'complete';
  ratio: number;
  label?: string;
  framesDone?: number;
  framesTotal?: number;
}

export interface ExportResult {
  blob: Blob;
  container: 'mp4' | 'webm';
  mime: string;
  /** Plain-language note when the result differs from what was requested. */
  note?: string;
  seconds: number;
  engine: 'webcodecs' | 'recorder';
}

export function canRenderProject(project: Project): { ok: true } | { ok: false; reason: string } {
  const clips = Object.values(project.clips);
  if (!clips.length) return { ok: false, reason: 'Add at least one video, image, audio or text clip to export.' };
  if (clips.some((c) => ['video', 'image', 'audio'].includes(c.kind) && (!c.assetId || !project.assets[c.assetId]))) return { ok: false, reason: 'A media clip is missing its source file. Re-import it and try again.' };
  return { ok: true };
}

export function webCodecsSupported(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

const abortError = () => new DOMException('Export cancelled', 'AbortError');
const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

interface VideoPlan { config: VideoEncoderConfig; codec: VideoTrackInfo['codec'] }
interface AudioPlan { config: AudioEncoderConfig; codec: AudioTrackInfo['codec'] }

async function pickVideo(container: 'mp4' | 'webm', width: number, height: number, fps: number, project: Project): Promise<VideoPlan | null> {
  if (!webCodecsSupported()) return null;
  const s = normalizedExport(project.export);
  const base = { width, height, bitrate: targetVideoBitrate(project.export), framerate: fps, latencyMode: s.speed === 'fast' ? 'realtime' as const : 'quality' as const, bitrateMode: s.rateControl === 'bitrate' ? 'constant' as const : 'variable' as const };
  const candidates: VideoPlan[] = container === 'mp4'
    ? (['64', '4d', '42'] as const).map((p) => ({ codec: 'avc' as const, config: { ...base, codec: avcCodecString(width, height, fps, p), avc: { format: 'avc' as const } } }))
    : [{ codec: 'vp9', config: { ...base, codec: 'vp09.00.10.08' } }, { codec: 'vp8', config: { ...base, codec: 'vp8' } }];
  for (const c of candidates) {
    try { if ((await VideoEncoder.isConfigSupported(c.config)).supported) return c; } catch { /* try next */ }
  }
  return null;
}

async function pickAudio(container: 'mp4' | 'webm', bitrateKbps: number): Promise<AudioPlan | null> {
  if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') return null;
  const config: AudioEncoderConfig = container === 'mp4'
    ? { codec: 'mp4a.40.2', sampleRate: MIX_RATE, numberOfChannels: 2, bitrate: bitrateKbps * 1000 }
    : { codec: 'opus', sampleRate: MIX_RATE, numberOfChannels: 2, bitrate: bitrateKbps * 1000 };
  try { if ((await AudioEncoder.isConfigSupported(config)).supported) return { config, codec: container === 'mp4' ? 'aac' : 'opus' }; } catch { /* unsupported */ }
  return null;
}

/** Render the project, audio first (so visualizers can follow the final mix), then frame by frame. */
export async function exportProject(project: Project, onProgress?: (p: ExportProgress) => void, signal?: AbortSignal): Promise<ExportResult> {
  const supported = canRenderProject(project);
  if (!supported.ok) throw new Error(supported.reason);
  const startedAt = performance.now();
  const settings = normalizedExport(project.export);
  const fps = settings.fps;
  const projectFps = project.settings.fps;
  const totalProjectFrames = projectDuration(project);
  const durationSec = totalProjectFrames / projectFps;
  const totalFrames = Math.max(1, Math.round(durationSec * fps));
  const size = outputSize(project);

  onProgress?.({ phase: 'loading', ratio: 0, label: 'Checking your media…' });
  for (const clip of Object.values(project.clips)) {
    if (!clip.assetId) continue;
    const asset = project.assets[clip.assetId];
    if (asset && !(await getBlob(asset.blobKey))) throw new Error(`The source file for “${clip.name}” is no longer stored in this browser. Re-import it and export again.`);
  }
  if (signal?.aborted) throw abortError();
  onProgress?.({ phase: 'loading', ratio: 0, label: 'Mixing audio…' });
  const mix = hasAudibleAudio(project) ? await mixProject(project, signal) : null;
  if (signal?.aborted) throw abortError();
  const wantsAnalysis = Object.values(project.clips).some((c) => c.kind === 'visualizer' && c.visualizer && !isProgressVisualizer(c.visualizer.type));
  const analyser = mix && wantsAnalysis ? new FrameAnalyser(mix.buffer, fps) : null;

  let container: 'mp4' | 'webm' = settings.container;
  let note: string | undefined;
  let video = await pickVideo(container, size.width, size.height, fps, project);
  let audio = mix ? await pickAudio(container, settings.audioBitrateKbps) : null;
  if (container === 'mp4' && (!video || (mix && !audio))) {
    // H.264/AAC encoders are not present in every browser build (e.g. Linux Chromium). WebM always is.
    const webmVideo = await pickVideo('webm', size.width, size.height, fps, project);
    const webmAudio = mix ? await pickAudio('webm', settings.audioBitrateKbps) : null;
    if (webmVideo && (!mix || webmAudio)) {
      container = 'webm'; video = webmVideo; audio = webmAudio;
      note = 'This browser cannot encode MP4 (H.264/AAC), so the video was saved as WebM instead. Use Chrome, Edge or the desktop app for MP4.';
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = project.settings.width; canvas.height = project.settings.height;
  const outCanvas = size.width === canvas.width && size.height === canvas.height ? canvas : Object.assign(document.createElement('canvas'), { width: size.width, height: size.height });
  const outCtx = outCanvas === canvas ? null : outCanvas.getContext('2d');
  if (outCtx) { outCtx.imageSmoothingEnabled = true; outCtx.imageSmoothingQuality = 'high'; }
  const renderer = new PlaybackEngine();
  const frameFor = (i: number) => Math.min(totalProjectFrames - 1, Math.floor((i / fps) * projectFps + 1e-6));
  const draw = async (i: number) => {
    await renderer.renderOffline(canvas, project, frameFor(i), analyser ? analyser.at(i / fps) : null, { fast: settings.speed === 'fast' });
    if (outCtx) outCtx.drawImage(canvas, 0, 0, size.width, size.height);
  };

  try {
    if (!video || (mix && !audio)) {
      const result = await recordInRealTime(project, mix?.buffer ?? null, outCanvas, draw, totalFrames, fps, onProgress, signal);
      note = 'Your browser has no fast video encoder, so the video was recorded in real time (it took as long as the video). Use Chrome or Edge for much faster exports.';
      return { ...result, note, seconds: (performance.now() - startedAt) / 1000, engine: 'recorder' };
    }

    const videoSamples: Sample[] = [];
    const audioSamples: Sample[] = [];
    let avcC: Uint8Array | undefined; let audioDesc: Uint8Array | undefined; let failure: Error | null = null;
    const copy = (chunk: EncodedVideoChunk | EncodedAudioChunk) => { const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data); return data; };
    const venc = new VideoEncoder({
      output: (chunk, meta) => {
        const d = meta?.decoderConfig?.description;
        if (d && !avcC) avcC = new Uint8Array(d instanceof ArrayBuffer ? d : (d as ArrayBufferView).buffer.slice((d as ArrayBufferView).byteOffset, (d as ArrayBufferView).byteOffset + (d as ArrayBufferView).byteLength));
        videoSamples.push({ timestampUs: chunk.timestamp, durationUs: chunk.duration ?? Math.round(1e6 / fps), data: copy(chunk), key: chunk.type === 'key' });
      },
      error: (e) => { failure = e; },
    });
    venc.configure(video.config);
    const keyEvery = Math.max(1, Math.round(fps * 2));
    for (let i = 0; i < totalFrames; i += 1) {
      if (signal?.aborted) throw abortError();
      if (failure) throw failure;
      await draw(i);
      const frame = new VideoFrame(outCanvas, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
      venc.encode(frame, { keyFrame: i % keyEvery === 0 });
      frame.close();
      while (venc.encodeQueueSize > 8) { if (signal?.aborted) throw abortError(); await sleep(1); }
      onProgress?.({ phase: 'rendering', ratio: ((i + 1) / totalFrames) * (mix ? 0.93 : 0.98), framesDone: i + 1, framesTotal: totalFrames, label: 'Rendering frames' });
    }
    await venc.flush();
    venc.close();
    if (failure) throw failure;

    if (mix && audio) {
      onProgress?.({ phase: 'rendering', ratio: 0.94, framesDone: totalFrames, framesTotal: totalFrames, label: 'Encoding audio' });
      const aenc = new AudioEncoder({
        output: (chunk, meta) => {
          const d = meta?.decoderConfig?.description;
          if (d && !audioDesc) audioDesc = new Uint8Array(d instanceof ArrayBuffer ? d.slice(0) : (d as ArrayBufferView).buffer.slice((d as ArrayBufferView).byteOffset, (d as ArrayBufferView).byteOffset + (d as ArrayBufferView).byteLength));
          audioSamples.push({ timestampUs: chunk.timestamp, durationUs: chunk.duration ?? Math.round((1024 * 1e6) / MIX_RATE), data: copy(chunk), key: true });
        },
        error: (e) => { failure = e; },
      });
      aenc.configure(audio.config);
      const left = mix.buffer.getChannelData(0); const right = mix.buffer.numberOfChannels > 1 ? mix.buffer.getChannelData(1) : left;
      const step = 4800;
      for (let off = 0; off < left.length; off += step) {
        if (signal?.aborted) throw abortError();
        const len = Math.min(step, left.length - off);
        const planar = new Float32Array(len * 2);
        planar.set(left.subarray(off, off + len), 0); planar.set(right.subarray(off, off + len), len);
        const data = new AudioData({ format: 'f32-planar', sampleRate: MIX_RATE, numberOfFrames: len, numberOfChannels: 2, timestamp: Math.round((off * 1e6) / MIX_RATE), data: planar });
        aenc.encode(data); data.close();
        while (aenc.encodeQueueSize > 16) await sleep(1);
      }
      await aenc.flush(); aenc.close();
      if (failure) throw failure;
    }

    onProgress?.({ phase: 'rendering', ratio: 0.99, framesDone: totalFrames, framesTotal: totalFrames, label: 'Finishing file' });
    const vInfo: VideoTrackInfo = { codec: video.codec, width: size.width, height: size.height, description: avcC };
    const aInfo: AudioTrackInfo | undefined = audio && audioSamples.length ? { codec: audio.codec, sampleRate: MIX_RATE, channels: 2, description: audioDesc } : undefined;
    const muxer = container === 'mp4' ? new Mp4Muxer(vInfo, aInfo) : new WebmMuxer(vInfo, aInfo);
    videoSamples.sort((a, b) => a.timestampUs - b.timestampUs).forEach((s) => muxer.addVideo(s));
    audioSamples.sort((a, b) => a.timestampUs - b.timestampUs).forEach((s) => muxer.addAudio(s));
    const bytes = muxer.finalize();
    const mime = container === 'mp4' ? 'video/mp4' : 'video/webm';
    onProgress?.({ phase: 'complete', ratio: 1, framesDone: totalFrames, framesTotal: totalFrames });
    return { blob: new Blob([bytes as BlobPart], { type: mime }), container, mime, note, seconds: (performance.now() - startedAt) / 1000, engine: 'webcodecs' };
  } finally {
    renderer.dispose();
  }
}

/** Last-resort path: capture the canvas and the mixed audio with MediaRecorder at real-time speed. */
async function recordInRealTime(
  project: Project, audioBuffer: AudioBuffer | null, canvas: HTMLCanvasElement, draw: (i: number) => Promise<void>,
  totalFrames: number, fps: number, onProgress?: (p: ExportProgress) => void, signal?: AbortSignal,
): Promise<Pick<ExportResult, 'blob' | 'container' | 'mime'>> {
  if (typeof MediaRecorder === 'undefined' || !canvas.captureStream) throw new Error('This browser cannot export video. Please use a recent Chrome, Edge or Firefox.');
  const stream = canvas.captureStream(fps);
  let audioContext: AudioContext | null = null;
  let source: AudioBufferSourceNode | null = null;
  if (audioBuffer) {
    audioContext = new AudioContext({ sampleRate: MIX_RATE });
    const dest = audioContext.createMediaStreamDestination();
    source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(dest);
    dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
  }
  const mimes = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  const mimeType = mimes.find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
  const recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: targetVideoBitrate(project.export), audioBitsPerSecond: 192000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });
  recorder.start(250);
  source?.start();
  const t0 = performance.now();
  try {
    for (let i = 0; i < totalFrames; i += 1) {
      if (signal?.aborted) throw abortError();
      await draw(i);
      const wait = t0 + ((i + 1) / fps) * 1000 - performance.now();
      if (wait > 0) await sleep(wait);
      onProgress?.({ phase: 'rendering', ratio: ((i + 1) / totalFrames) * 0.99, framesDone: i + 1, framesTotal: totalFrames, label: 'Recording in real time' });
    }
  } finally {
    if (recorder.state !== 'inactive') recorder.stop();
    await stopped;
    source?.stop?.(); void audioContext?.close();
    stream.getTracks().forEach((t) => t.stop());
  }
  onProgress?.({ phase: 'complete', ratio: 1 });
  return { blob: new Blob(chunks, { type: 'video/webm' }), container: 'webm', mime: 'video/webm' };
}

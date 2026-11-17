/**
 * Offline audio mixdown for export. Every audible clip is cut from its source,
 * time-scaled (tape resample), pitch-corrected, run through the same FxChain as the
 * live preview, and summed in an OfflineAudioContext.
 */
import { clipEnd, effectivePitchSemitones, evaluateKeyframes, projectDuration, sourceSpan, type Clip, type Project } from '../core';
import { createFxChain } from './audioFx';
import { getBlob } from './db';

export const MIX_RATE = 48000;

/** Catmull-Rom resample so slowed/sped audio keeps its top end. `rate` > 1 plays faster. */
export function resampleTape(input: Float32Array, rate: number): Float32Array {
  if (Math.abs(rate - 1) < 1e-6) return input;
  const n = Math.max(1, Math.round(input.length / rate));
  const out = new Float32Array(n);
  const last = input.length - 1;
  const at = (i: number) => input[Math.min(last, Math.max(0, i))] ?? 0;
  for (let i = 0; i < n; i += 1) {
    const pos = i * rate;
    const i0 = Math.floor(pos); const f = pos - i0;
    const p0 = at(i0 - 1); const p1 = at(i0); const p2 = at(i0 + 1); const p3 = at(i0 + 2);
    out[i] = p1 + 0.5 * f * (p2 - p0 + f * (2 * p0 - 5 * p1 + 4 * p2 - p3 + f * (3 * (p1 - p2) + p3 - p0)));
  }
  return out;
}

/** Granular pitch shift that keeps duration. ratio 2 = one octave up. Two cross-faded taps, zero latency. */
export function pitchShift(input: Float32Array, ratio: number, grain = 2048): Float32Array {
  if (Math.abs(ratio - 1) < 1e-4) return input;
  const n = input.length;
  const out = new Float32Array(n);
  const inc = (ratio - 1) / grain;
  let phase = 0;
  const last = n - 1;
  const read = (pos: number) => {
    if (pos < 0 || pos > last) return 0;
    const i = Math.floor(pos); const f = pos - i;
    return (input[i] ?? 0) * (1 - f) + (input[Math.min(last, i + 1)] ?? 0) * f;
  };
  for (let i = 0; i < n; i += 1) {
    const w1 = Math.sin(Math.PI * phase) ** 2;
    const q2 = (phase + 0.5) % 1;
    out[i] = read(i + (phase - 0.5) * grain) * w1 + read(i + (q2 - 0.5) * grain) * (1 - w1);
    phase = (((phase + inc) % 1) + 1) % 1;
  }
  return out;
}

export interface MixResult { buffer: AudioBuffer }

interface Decoded { channels: Float32Array[]; sampleRate: number }

async function decode(blob: Blob): Promise<Decoded | null> {
  try {
    const ctx = new OfflineAudioContext(2, 1, MIX_RATE);
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    return { channels: [buf.getChannelData(0), buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0)], sampleRate: buf.sampleRate };
  } catch {
    return null; // e.g. a video without an audio track
  }
}

function audibleClips(project: Project): Clip[] {
  const soloed = project.tracks.some((t) => t.solo);
  return Object.values(project.clips).filter((c) => {
    if (c.kind !== 'audio' && c.kind !== 'video') return false;
    if (!c.assetId || c.freezeFrame !== undefined || c.audio.muted) return false;
    const asset = project.assets[c.assetId];
    if (!asset || (asset.kind === 'video' && asset.hasAudio === false)) return false;
    const track = project.tracks.find((t) => t.id === c.trackId);
    return Boolean(track && !track.muted && (!soloed || track.solo));
  });
}

export function hasAudibleAudio(project: Project): boolean { return audibleClips(project).length > 0; }

export function segmentFor(clip: Clip, fps: number, decoded: Decoded): Float32Array[] {
  const sr = decoded.sampleRate;
  const start = Math.round((clip.sourceIn / fps) * sr);
  const len = Math.round((sourceSpan(clip) / fps) * sr);
  return decoded.channels.map((ch) => {
    const seg = new Float32Array(len);
    seg.set(ch.subarray(Math.min(ch.length, start), Math.min(ch.length, start + len)));
    if (clip.reverse) seg.reverse();
    return seg;
  });
}

/** Everything up to (not including) the effect chain: cut, tape-resample, pitch-correct. Exported for tests. */
export function prepareClipSamples(clip: Clip, fps: number, decoded: Decoded): Float32Array[] {
  const speed = Math.max(0.1, clip.speed);
  const semis = effectivePitchSemitones(clip.audio);
  const ratio = (clip.audio.preservePitch !== false ? 1 / speed : 1) * Math.pow(2, semis / 12);
  return segmentFor(clip, fps, decoded).map((seg) => {
    const tape = resampleTape(seg, speed);
    const fixed = pitchShift(tape, ratio);
    const want = Math.max(1, Math.round((clip.duration / fps) * decoded.sampleRate));
    if (fixed.length === want) return fixed;
    const exact = new Float32Array(want); exact.set(fixed.subarray(0, want)); return exact;
  });
}

export async function mixProject(project: Project, signal?: AbortSignal): Promise<MixResult | null> {
  const clips = audibleClips(project);
  if (!clips.length) return null;
  const fps = project.settings.fps;
  const totalFrames = projectDuration(project);
  const seconds = Math.max(0.05, totalFrames / fps);
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * MIX_RATE), MIX_RATE);
  const decodedByAsset = new Map<string, Decoded | null>();
  let any = false;
  for (const clip of clips) {
    if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
    const asset = project.assets[clip.assetId!]!;
    if (!decodedByAsset.has(asset.id)) {
      const blob = await getBlob(asset.blobKey);
      decodedByAsset.set(asset.id, blob ? await decode(blob) : null);
    }
    const decoded = decodedByAsset.get(asset.id);
    if (!decoded) continue;
    any = true;
    const samples = prepareClipSamples(clip, fps, decoded);
    const buffer = ctx.createBuffer(2, samples[0]!.length, MIX_RATE);
    buffer.copyToChannel(samples[0] as Float32Array<ArrayBuffer>, 0);
    buffer.copyToChannel(samples[1] as Float32Array<ArrayBuffer>, 1);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const chain = createFxChain(ctx, ctx.destination);
    source.connect(chain.input);
    chain.apply(clip.audio.processing ?? { eqLow: 0, eqMid: 0, eqHigh: 0, compressor: 0, limiter: 0, reverb: 0, echo: 0 }, 0);
    if (chain.pan) chain.pan.pan.setValueAtTime(Math.max(-1, Math.min(1, clip.audio.pan)), 0);
    scheduleGain(chain.gain.gain, clip, project, fps);
    const when = clip.start / fps;
    const until = when + clip.duration / fps;
    chain.start(when);
    chain.stop(until);
    source.start(when);
    source.stop(until);
  }
  if (!any) return null;
  const rendered = await ctx.startRendering();
  // Safety clip so encoders never see values beyond full scale.
  for (let c = 0; c < rendered.numberOfChannels; c += 1) {
    const d = rendered.getChannelData(c);
    for (let i = 0; i < d.length; i += 1) { const v = d[i] ?? 0; if (v > 1) d[i] = 1; else if (v < -1) d[i] = -1; }
  }
  return { buffer: rendered };
}

/** Same gain law as the live preview: clip gain keyframes x track volume x fades x ducking. */
function scheduleGain(param: AudioParam, clip: Clip, project: Project, fps: number): void {
  const track = project.tracks.find((t) => t.id === clip.trackId);
  const trackVol = track?.volume ?? 1;
  const ducking = clip.audio.ducking;
  const sidechain = ducking?.enabled && ducking.sidechainTrackId
    ? Object.values(project.clips).filter((o) => o.id !== clip.id && o.trackId === ducking.sidechainTrackId && (o.kind === 'audio' || o.kind === 'video') && !o.audio.muted)
    : [];
  const hasKeys = Boolean(clip.keyframes['audio.volume']?.length);
  const simple = !hasKeys && !sidechain.length && !clip.audio.fadeInFrames && !clip.audio.fadeOutFrames;
  const t0 = clip.start / fps;
  if (simple) { param.setValueAtTime(Math.max(0, clip.audio.volume * trackVol), t0); return; }
  let smooth = 1;
  const attack = Math.max(1, ducking?.attackFrames ?? 6);
  const release = Math.max(1, ducking?.releaseFrames ?? 15);
  for (let f = 0; f <= clip.duration; f += 1) {
    const frame = clip.start + f;
    const vol = Math.max(0, evaluateKeyframes(clip.keyframes['audio.volume'], f, clip.audio.volume));
    const fadeIn = clip.audio.fadeInFrames > 0 ? Math.min(1, f / clip.audio.fadeInFrames) : 1;
    const fadeOut = clip.audio.fadeOutFrames > 0 ? Math.min(1, (clip.duration - f) / clip.audio.fadeOutFrames) : 1;
    const ducked = sidechain.some((o) => frame >= o.start && frame < clipEnd(o));
    const target = ducked ? 1 - Math.max(0, Math.min(1, ducking?.amount ?? 0)) : 1;
    smooth += (target - smooth) * (1 - Math.exp(-1 / (target < smooth ? attack : release)));
    param.setValueAtTime(Math.max(0, vol * trackVol * smooth * Math.min(fadeIn, fadeOut)), t0 + f / fps);
  }
}

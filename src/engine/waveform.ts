import type { Asset } from '../core';
import { getBlob, getWaveform, putWaveform } from './db';

const memoryCache = new Map<string, number[]>();
const silenceCache = new Map<string, SilenceRegion[]>();
const beatCache = new Map<string, number[]>();

function cacheKey(asset: Asset, samples: number): string {
  return `${asset.blobKey}:${samples}`;
}

/** Decode real audio samples and reduce them to peak amplitudes for timeline drawing. */
export async function waveformFor(asset: Asset, samples = 512): Promise<number[] | null> {
  if (asset.kind !== 'audio') return null;
  const count = Math.max(32, Math.min(2048, Math.round(samples)));
  const key = cacheKey(asset, count);
  const memory = memoryCache.get(key);
  if (memory) return memory;
  const stored = await getWaveform(key);
  if (stored?.length) {
    memoryCache.set(key, stored);
    return stored;
  }

  const blob = await getBlob(asset.blobKey);
  if (!blob) return null;
  let context: AudioContext | undefined;
  try {
    context = new AudioContext();
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    const peaks = new Array<number>(count).fill(0);
    const stride = Math.max(1, Math.ceil(buffer.length / count));
    for (let i = 0; i < count; i += 1) {
      const start = i * stride;
      const end = Math.min(buffer.length, start + stride);
      let peak = 0;
      for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
        const data = buffer.getChannelData(channel);
        for (let sample = start; sample < end; sample += 1) peak = Math.max(peak, Math.abs(data[sample] ?? 0));
      }
      peaks[i] = peak;
    }
    memoryCache.set(key, peaks);
    await putWaveform(key, peaks);
    return peaks;
  } catch {
    return null;
  } finally {
    await context?.close().catch(() => undefined);
  }
}

export interface SilenceRegion {
  startSec: number;
  endSec: number;
  rms: number;
}

export interface SilenceOptions {
  thresholdDb?: number;
  minDurationSec?: number;
  windowSec?: number;
}

/** Find sustained low-energy sections in an imported audio asset. */
export async function silenceRegionsFor(asset: Asset, options: SilenceOptions = {}): Promise<SilenceRegion[]> {
  if (asset.kind === 'image') return []; // video files are decoded for their audio track too
  const thresholdDb = options.thresholdDb ?? -42;
  const minDurationSec = options.minDurationSec ?? 0.25;
  const windowSec = options.windowSec ?? 0.1;
  const key = `${asset.blobKey}:silence:${thresholdDb}:${minDurationSec}:${windowSec}`;
  const cached = silenceCache.get(key);
  if (cached) return cached;
  const blob = await getBlob(asset.blobKey);
  if (!blob) return [];
  let context: AudioContext | undefined;
  try {
    context = new AudioContext();
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    const windowSamples = Math.max(1, Math.round(buffer.sampleRate * windowSec));
    const threshold = Math.pow(10, thresholdDb / 20);
    const regions: SilenceRegion[] = [];
    let startSample: number | null = null;
    let rmsSum = 0;
    let windows = 0;
    for (let start = 0; start < buffer.length; start += windowSamples) {
      const end = Math.min(buffer.length, start + windowSamples);
      let sum = 0;
      let count = 0;
      for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
        const data = buffer.getChannelData(channel);
        for (let sample = start; sample < end; sample += 1) { const value = data[sample] ?? 0; sum += value * value; count += 1; }
      }
      const rms = count ? Math.sqrt(sum / count) : 0;
      if (rms <= threshold) {
        if (startSample === null) { startSample = start; rmsSum = 0; windows = 0; }
        rmsSum += rms;
        windows += 1;
      } else if (startSample !== null) {
        const endSample = start;
        if ((endSample - startSample) / buffer.sampleRate >= minDurationSec) regions.push({ startSec: startSample / buffer.sampleRate, endSec: endSample / buffer.sampleRate, rms: rmsSum / Math.max(1, windows) });
        startSample = null;
      }
    }
    if (startSample !== null && (buffer.length - startSample) / buffer.sampleRate >= minDurationSec) regions.push({ startSec: startSample / buffer.sampleRate, endSec: buffer.length / buffer.sampleRate, rms: rmsSum / Math.max(1, windows) });
    silenceCache.set(key, regions);
    return regions;
  } catch {
    return [];
  } finally {
    await context?.close().catch(() => undefined);
  }
}

export interface BeatOptions {
  sensitivity?: number;
  minIntervalSec?: number;
  windowSec?: number;
}

/** Detect prominent energy onsets and return their source times in seconds. */
export async function beatTimesFor(asset: Asset, options: BeatOptions = {}): Promise<number[]> {
  if (asset.kind !== 'audio') return [];
  const sensitivity = options.sensitivity ?? 0.8;
  const minIntervalSec = options.minIntervalSec ?? 0.25;
  const windowSec = options.windowSec ?? 0.05;
  const key = `${asset.blobKey}:beats:${sensitivity}:${minIntervalSec}:${windowSec}`;
  const cached = beatCache.get(key);
  if (cached) return cached;
  const blob = await getBlob(asset.blobKey);
  if (!blob) return [];
  let context: AudioContext | undefined;
  try {
    context = new AudioContext();
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    const windowSamples = Math.max(1, Math.round(buffer.sampleRate * windowSec));
    const energy: number[] = [];
    for (let start = 0; start < buffer.length; start += windowSamples) {
      const end = Math.min(buffer.length, start + windowSamples);
      let sum = 0;
      let count = 0;
      for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
        const data = buffer.getChannelData(channel);
        for (let sample = start; sample < end; sample += 1) { const value = data[sample] ?? 0; sum += value * value; count += 1; }
      }
      energy.push(count ? Math.sqrt(sum / count) : 0);
    }
    const flux = energy.map((value, index) => Math.max(0, value - (energy[index - 1] ?? value)));
    const mean = flux.reduce((sum, value) => sum + value, 0) / Math.max(1, flux.length);
    const variance = flux.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, flux.length);
    const threshold = mean + Math.sqrt(variance) * Math.max(0.1, sensitivity);
    const minGap = Math.max(1, Math.round(minIntervalSec / windowSec));
    const result: number[] = [];
    for (let index = 1; index < flux.length - 1; index += 1) {
      if (flux[index]! < threshold || flux[index]! < flux[index - 1]! || flux[index]! < flux[index + 1]!) continue;
      if (result.length && index - Math.round(result[result.length - 1]! / windowSec) < minGap) continue;
      result.push(index * windowSec);
    }
    beatCache.set(key, result);
    return result;
  } catch {
    return [];
  } finally {
    await context?.close().catch(() => undefined);
  }
}

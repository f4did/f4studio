import type { Asset } from '../core';
import { assetUrl } from './media';

const sceneCache = new Map<string, number[]>();

export interface SceneOptions {
  sampleEverySec?: number;
  threshold?: number;
}

/** Sample real video frames and return source times where the visual signature changes sharply. */
export async function sceneCutsFor(asset: Asset, options: SceneOptions = {}): Promise<number[]> {
  if (asset.kind !== 'video') return [];
  const sampleEverySec = options.sampleEverySec ?? 0.5;
  const threshold = options.threshold ?? 0.2;
  const key = `${asset.blobKey}:scenes:${sampleEverySec}:${threshold}`;
  const cached = sceneCache.get(key);
  if (cached) return cached;
  const url = await assetUrl(asset);
  if (!url) return [];
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.muted = true;
  video.playsInline = true;
  video.src = url;
  try {
    await waitFor(video, 'loadedmetadata');
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 36;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx || !Number.isFinite(video.duration) || video.duration <= 0) return [];
    const cuts: number[] = [];
    let previous: number[] | null = null;
    for (let time = 0; time <= video.duration; time += sampleEverySec) {
      video.currentTime = Math.min(time, Math.max(0, video.duration - 0.01));
      await waitFor(video, 'seeked');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const signature = frameSignature(pixels);
      if (previous && signatureDistance(previous, signature) >= threshold && time >= sampleEverySec) cuts.push(Number(time.toFixed(3)));
      previous = signature;
    }
    sceneCache.set(key, cuts);
    return cuts;
  } catch {
    return [];
  } finally {
    video.removeAttribute('src');
    video.load();
  }
}

function waitFor(target: HTMLMediaElement, event: 'loadedmetadata' | 'seeked'): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => { target.removeEventListener(event, done); target.removeEventListener('error', failed); resolve(); };
    const failed = () => { target.removeEventListener(event, done); target.removeEventListener('error', failed); reject(new Error('Video analysis failed')); };
    target.addEventListener(event, done, { once: true });
    target.addEventListener('error', failed, { once: true });
  });
}

function frameSignature(pixels: Uint8ClampedArray): number[] {
  const bins = new Array<number>(12).fill(0);
  for (let i = 0; i < pixels.length; i += 4) {
    bins[Math.min(3, Math.floor((pixels[i] ?? 0) / 64))] = (bins[Math.min(3, Math.floor((pixels[i] ?? 0) / 64))] ?? 0) + 1;
    bins[4 + Math.min(3, Math.floor((pixels[i + 1] ?? 0) / 64))] = (bins[4 + Math.min(3, Math.floor((pixels[i + 1] ?? 0) / 64))] ?? 0) + 1;
    bins[8 + Math.min(3, Math.floor((pixels[i + 2] ?? 0) / 64))] = (bins[8 + Math.min(3, Math.floor((pixels[i + 2] ?? 0) / 64))] ?? 0) + 1;
  }
  const total = Math.max(1, pixels.length / 4);
  return bins.map((value) => value / total);
}

function signatureDistance(a: number[], b: number[]): number {
  return a.reduce((sum, value, index) => sum + Math.abs(value - (b[index] ?? 0)), 0) / a.length;
}

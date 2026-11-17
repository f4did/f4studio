/**
 * Media asset management. One object URL per asset, created lazily and revoked on release,
 * so URLs never leak across project loads.
 */
import { newId, type Asset, type AssetKind } from '../core';
import { getBlob, putBlob } from './db';

const urls = new Map<string, string>();
const thumbnails = new Map<string, Promise<string | null>>();
const IMAGE_STILL_SECONDS = 5;

export function kindFromMime(mime: string): AssetKind | null {
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  return null;
}

function kindFromFileName(name: string): AssetKind | null {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'flac', 'opus', 'aiff', 'webm'].includes(ext)) return 'audio';
  if (['mp4', 'mov', 'mkv', 'avi', 'webm'].includes(ext)) return 'video';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) return 'image';
  return null;
}

/**
 * MediaRecorder output (WebM) usually has NO duration header, so `duration` reads as Infinity.
 * Seeking far past the end forces the browser to scan the file and report the real length.
 */
async function settleDuration(el: HTMLMediaElement, hintSec?: number): Promise<number> {
  if (Number.isFinite(el.duration) && el.duration > 0) return el.duration;
  await new Promise<void>((resolve) => {
    const done = () => { el.removeEventListener('timeupdate', done); el.removeEventListener('error', done); resolve(); };
    el.addEventListener('timeupdate', done);
    el.addEventListener('error', done);
    window.setTimeout(done, 4000);
    try { el.currentTime = 1e101; } catch { done(); }
  });
  const d = el.duration;
  try { el.currentTime = 0; } catch { /* ignore */ }
  if (Number.isFinite(d) && d > 0) return d;
  return hintSec && hintSec > 0 ? hintSec : 0;
}

function probe(url: string, kind: AssetKind, hintSec?: number): Promise<{ durationSec: number; width?: number; height?: number }> {
  return new Promise((resolve, reject) => {
    if (kind === 'image') {
      const img = new Image();
      img.onload = () => resolve({ durationSec: IMAGE_STILL_SECONDS, width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error('The image could not be decoded by this browser.'));
      img.src = url;
      return;
    }
    const el = document.createElement(kind === 'video' ? 'video' : 'audio');
    el.preload = 'metadata';
    el.onloadedmetadata = () => {
      void settleDuration(el, hintSec).then((durationSec) => {
        const v = el as HTMLVideoElement;
        resolve({
          durationSec,
          width: kind === 'video' ? v.videoWidth : undefined,
          height: kind === 'video' ? v.videoHeight : undefined,
        });
        el.removeAttribute('src');
        el.load();
      });
    };
    el.onerror = () => reject(new Error('This file format or codec is not supported by this browser.'));
    el.src = url;
  });
}

export interface ImportOutcome {
  asset?: Asset;
  error?: string;
  fileName: string;
}

export interface ImportOptions {
  /** Known duration (e.g. from a live recording) used when the container carries none. */
  durationHintSec?: number;
}

export async function importFile(file: File, options: ImportOptions = {}): Promise<ImportOutcome> {
  const kind = kindFromMime(file.type) ?? kindFromFileName(file.name);
  if (!kind) return { fileName: file.name, error: `Unsupported file type "${file.type || 'unknown'}".` };
  const url = URL.createObjectURL(file);
  try {
    const meta = await probe(url, kind, options.durationHintSec);
    if (meta.durationSec <= 0) throw new Error('The file has no readable duration.');
    const key = newId('blob');
    await putBlob(key, file);
    const asset: Asset = {
      id: newId('asset'),
      kind,
      name: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      blobKey: key,
      addedAt: Date.now(),
      ...meta,
    };
    urls.set(asset.id, url);
    return { asset, fileName: file.name };
  } catch (e) {
    URL.revokeObjectURL(url);
    return { fileName: file.name, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Resolve (and cache) a playable URL for an asset, loading its blob from IndexedDB if needed. */
export async function assetUrl(asset: Asset): Promise<string | null> {
  const cached = urls.get(asset.id);
  if (cached) return cached;
  const blob = await getBlob(asset.blobKey);
  if (!blob) return null; // missing media: caller reports it
  const url = URL.createObjectURL(blob);
  urls.set(asset.id, url);
  return url;
}

export const cachedAssetUrl = (assetId: string) => urls.get(assetId);

/**
 * Decode a small visual preview for a media asset. The result is a data URL so
 * it remains valid independently of the asset object URL and can be reused by
 * both the media bin and timeline without repeatedly seeking the source.
 */
export function thumbnailFor(asset: Asset): Promise<string | null> {
  const cached = thumbnails.get(asset.id);
  if (cached) return cached;
  const pending = (async () => {
    const url = await assetUrl(asset);
    if (!url || asset.kind === 'audio') return null;
    const width = 240;
    const height = Math.max(54, Math.round(width * ((asset.height ?? 9) / (asset.width ?? 16))));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = Math.min(160, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#181621';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (asset.kind === 'image') {
      const image = new Image();
      image.src = url;
      await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('Image preview failed')); });
      drawContain(ctx, image, canvas.width, canvas.height);
    } else {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.src = url;
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => {
          const target = Number.isFinite(video.duration) ? Math.min(Math.max(video.duration * 0.5, 0), Math.max(0, video.duration - 0.05)) : 0;
          const done = () => { video.removeEventListener('seeked', done); resolve(); };
          video.addEventListener('seeked', done, { once: true });
          video.currentTime = target;
          if (target === 0) resolve();
        };
        video.onerror = () => reject(new Error('Video preview failed'));
      });
      drawContain(ctx, video, canvas.width, canvas.height);
      video.removeAttribute('src');
      video.load();
    }
    return canvas.toDataURL('image/jpeg', 0.78);
  })().catch(() => null);
  thumbnails.set(asset.id, pending);
  return pending;
}

function drawContain(ctx: CanvasRenderingContext2D, source: CanvasImageSource, width: number, height: number): void {
  const dimensions = source as unknown as { videoWidth?: number; videoHeight?: number; naturalWidth?: number; naturalHeight?: number; width?: number; height?: number };
  const sourceWidth = dimensions.videoWidth || dimensions.naturalWidth || dimensions.width || 0;
  const sourceHeight = dimensions.videoHeight || dimensions.naturalHeight || dimensions.height || 0;
  if (!sourceWidth || !sourceHeight) return;
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const w = sourceWidth * scale;
  const h = sourceHeight * scale;
  ctx.drawImage(source, (width - w) / 2, (height - h) / 2, w, h);
}

export function releaseAllUrls(): void {
  for (const u of urls.values()) URL.revokeObjectURL(u);
  urls.clear();
  thumbnails.clear();
}

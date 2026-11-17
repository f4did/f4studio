import { mixProject } from './audioMix';
import { encodeWav } from './synth';
import type { Project } from '../core';
import { Mp3Encoder } from 'lamejs';

export type AudioExportFormat = 'mp3' | 'wav';

function pcm(value: number): number {
  return Math.max(-32768, Math.min(32767, Math.round(Math.max(-1, Math.min(1, value)) * 32767)));
}

export async function exportAudioProject(project: Project, format: AudioExportFormat, onProgress?: (value: number) => void, signal?: AbortSignal): Promise<Blob> {
  const mixed = await mixProject(project, signal);
  if (!mixed) throw new Error('Add an audio track before exporting from Audio Studio.');
  const buffer = mixed.buffer;
  const rendered = { left: buffer.getChannelData(0), right: buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : buffer.getChannelData(0), sampleRate: buffer.sampleRate };
  if (format === 'wav') return new Blob([new Uint8Array(encodeWav(rendered))], { type: 'audio/wav' });
  const encoder = new Mp3Encoder(2, rendered.sampleRate, 192);
  const chunks: Int8Array[] = [];
  const block = 1152;
  for (let offset = 0; offset < rendered.left.length; offset += block) {
    if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
    const end = Math.min(rendered.left.length, offset + block);
    const left = new Int16Array(end - offset); const right = new Int16Array(end - offset);
    for (let i = 0; i < left.length; i += 1) { left[i] = pcm(rendered.left[offset + i] ?? 0); right[i] = pcm(rendered.right[offset + i] ?? 0); }
    const encoded = encoder.encodeBuffer(left, right); if (encoded.length) chunks.push(encoded);
    onProgress?.(Math.min(0.98, end / rendered.left.length));
  }
  const tail = encoder.flush(); if (tail.length) chunks.push(tail);
  onProgress?.(1);
  return new Blob(chunks.map((chunk) => new Uint8Array(chunk)), { type: 'audio/mpeg' });
}

/**
 * .f4proj — a single-file project bundle: the project JSON plus every media blob it references,
 * so a project can be backed up, moved to another computer or opened in the desktop app.
 *
 *   bytes 0-7   "F4PROJ01"
 *   bytes 8-11  header length (uint32 LE)
 *   header      UTF-8 JSON { format, version, savedAt, project, blobs: [{ key, size, type }] }
 *   rest        blob bytes, concatenated in header order
 *
 * Pure with respect to storage: callers inject how blobs are read, so this is unit-testable.
 */
import type { Project } from '../core';

export const PROJECT_FILE_EXTENSION = '.f4proj';
const MAGIC = 'F4PROJ01';
const MAX_HEADER_BYTES = 64 * 1024 * 1024;

interface BlobInfo { key: string; size: number; type: string }
interface Header { format: 'f4proj'; version: 1; savedAt: number; project: Project; blobs: BlobInfo[] }

export interface PackResult { blob: Blob; missing: string[]; mediaBytes: number }

export async function packProject(project: Project, getBlob: (key: string) => Promise<Blob | undefined>): Promise<PackResult> {
  const keys = [...new Set(Object.values(project.assets).map((a) => a.blobKey))];
  const found: Array<{ info: BlobInfo; blob: Blob }> = [];
  const missing: string[] = [];
  for (const key of keys) {
    const blob = await getBlob(key);
    if (blob) found.push({ info: { key, size: blob.size, type: blob.type }, blob });
    else missing.push(key);
  }
  const header: Header = { format: 'f4proj', version: 1, savedAt: Date.now(), project, blobs: found.map((f) => f.info) };
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, headerBytes.length, true);
  const parts: BlobPart[] = [new TextEncoder().encode(MAGIC), len, headerBytes, ...found.map((f) => f.blob)];
  return { blob: new Blob(parts, { type: 'application/x-f4-project' }), missing, mediaBytes: found.reduce((n, f) => n + f.info.size, 0) };
}

export async function unpackProject(file: Blob): Promise<{ project: Project; blobs: Array<{ key: string; blob: Blob }> }> {
  if (file.size < 12) throw new Error('This is not an F4 project file (too small).');
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (new TextDecoder().decode(head.slice(0, 8)) !== MAGIC) throw new Error('This is not an F4 project file.');
  const headerLen = new DataView(head.buffer, 8, 4).getUint32(0, true);
  if (headerLen <= 0 || headerLen > MAX_HEADER_BYTES || 12 + headerLen > file.size) throw new Error('The project file is damaged (bad header).');
  let header: Header;
  try { header = JSON.parse(new TextDecoder().decode(new Uint8Array(await file.slice(12, 12 + headerLen).arrayBuffer()))) as Header; }
  catch { throw new Error('The project file is damaged (unreadable header).'); }
  if (header.format !== 'f4proj' || header.version !== 1 || !header.project || header.project.schemaVersion !== 1 || !Array.isArray(header.blobs)) {
    throw new Error('This project file was made by an incompatible version of F4 Studio.');
  }
  let offset = 12 + headerLen;
  const blobs: Array<{ key: string; blob: Blob }> = [];
  for (const info of header.blobs) {
    if (!Number.isInteger(info.size) || info.size < 0 || offset + info.size > file.size) throw new Error('The project file is truncated — some media is missing.');
    blobs.push({ key: info.key, blob: file.slice(offset, offset + info.size, info.type) });
    offset += info.size;
  }
  return { project: header.project, blobs };
}

export function safeFileName(name: string, fallback = 'f4-project'): string {
  return name.replace(/[^a-z0-9-_ ]+/gi, '-').replace(/\s+/g, ' ').replace(/^[-\s]+|[-\s]+$/g, '') || fallback;
}

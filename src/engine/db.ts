import Dexie, { type Table } from 'dexie';
import type { Project } from '../core';

interface ProjectRow {
  id: string;
  name: string;
  updatedAt: number;
  data: Project;
}
interface BlobRow {
  key: string;
  blob: Blob;
}
export interface ProjectVersion {
  id?: number;
  projectId: string;
  savedAt: number;
  data: Project;
}
interface WaveformRow {
  key: string;
  peaks: number[];
}

class F4Database extends Dexie {
  projects!: Table<ProjectRow, string>;
  blobs!: Table<BlobRow, string>;
  waveforms!: Table<WaveformRow, string>;
  projectVersions!: Table<ProjectVersion, number>;
  constructor() {
    super('f4-clip-editor');
    this.version(1).stores({ projects: 'id, updatedAt', blobs: 'key' });
    this.version(2).stores({ projects: 'id, updatedAt', blobs: 'key', waveforms: 'key' });
    this.version(3).stores({ projects: 'id, updatedAt', blobs: 'key', waveforms: 'key', projectVersions: '++id, projectId, savedAt' });
  }
}

export const db = new F4Database();

export async function saveProject(p: Project): Promise<void> {
  await db.transaction('rw', [db.projects, db.projectVersions], async () => {
    await db.projects.put({ id: p.id, name: p.name, updatedAt: p.updatedAt, data: p });
    await db.projectVersions.add({ projectId: p.id, savedAt: p.updatedAt, data: p });
    const versions = await db.projectVersions.where('projectId').equals(p.id).sortBy('savedAt');
    const old = versions.slice(0, Math.max(0, versions.length - 30));
    await db.projectVersions.bulkDelete(old.flatMap((version) => version.id === undefined ? [] : [version.id]));
  });
}

export async function loadProject(id: string): Promise<Project | undefined> {
  return (await db.projects.get(id))?.data;
}

export async function latestProject(): Promise<Project | undefined> {
  const row = await db.projects.orderBy('updatedAt').last();
  return row?.data;
}

export async function listProjectVersions(projectId: string): Promise<ProjectVersion[]> {
  return (await db.projectVersions.where('projectId').equals(projectId).sortBy('savedAt')).reverse();
}

export async function loadProjectVersion(versionId: number): Promise<Project | undefined> {
  return (await db.projectVersions.get(versionId))?.data;
}

export const putBlob = (key: string, blob: Blob) => db.blobs.put({ key, blob });
export async function getBlob(key: string): Promise<Blob | undefined> {
  return (await db.blobs.get(key))?.blob;
}

export async function getWaveform(key: string): Promise<number[] | undefined> {
  return (await db.waveforms.get(key))?.peaks;
}

export async function putWaveform(key: string, peaks: number[]): Promise<void> {
  await db.waveforms.put({ key, peaks });
}

/** Trailing-edge debounce for autosave. */
export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number): ((...a: A) => void) & { flush: () => void } {
  let t: ReturnType<typeof setTimeout> | undefined;
  let last: A | undefined;
  const wrapped = (...a: A) => {
    last = a;
    if (t) clearTimeout(t);
    t = setTimeout(() => {
      t = undefined;
      if (last) fn(...last);
    }, ms);
  };
  wrapped.flush = () => {
    if (t) {
      clearTimeout(t);
      t = undefined;
      if (last) fn(...last);
    }
  };
  return wrapped;
}

/** Browser/IndexedDB glue around the .f4proj bundle format. */
import { newId, type Project } from '../core';
import { useEditor } from '../store/editor';
import { getBlob, putBlob, saveProject } from './db';
import { packProject, PROJECT_FILE_EXTENSION, safeFileName, unpackProject } from './projectfile';

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function saveProjectFile(project: Project): Promise<string> {
  const { blob, missing } = await packProject(project, getBlob);
  downloadBlob(blob, `${safeFileName(project.name)}${PROJECT_FILE_EXTENSION}`);
  const mb = (blob.size / 1048576).toFixed(1);
  return missing.length ? `Saved project (${mb} MB). ${missing.length} media file(s) were missing locally and are not included.` : `Saved project file (${mb} MB) with all media included.`;
}

export async function openProjectFile(file: File): Promise<string> {
  const { project, blobs } = await unpackProject(file);
  for (const b of blobs) await putBlob(b.key, b.blob);
  // A fresh id so opening a file never overwrites an existing project of the same origin.
  const opened: Project = { ...project, id: newId('prj'), updatedAt: Date.now() };
  await saveProject(opened);
  useEditor.getState().loadProject(opened);
  return `Opened “${opened.name}” (${Object.keys(opened.assets).length} media files).`;
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../src/core/index';
import { packProject, unpackProject, safeFileName } from '../src/engine/projectfile';

function projectWithAssets() {
  const p = createProject('My: cool/project', 30);
  p.assets.a = { id: 'a', kind: 'video', name: 'a.mp4', mimeType: 'video/mp4', sizeBytes: 5, durationSec: 1, blobKey: 'k1', addedAt: 0 };
  p.assets.b = { id: 'b', kind: 'audio', name: 'b.wav', mimeType: 'audio/wav', sizeBytes: 3, durationSec: 1, blobKey: 'k2', addedAt: 0 };
  p.assets.c = { id: 'c', kind: 'audio', name: 'c.wav', mimeType: 'audio/wav', sizeBytes: 3, durationSec: 1, blobKey: 'k2', addedAt: 0 }; // shared blob
  return p;
}
const store: Record<string, Blob> = { k1: new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: 'video/mp4' }), k2: new Blob([new Uint8Array([9, 8, 7])], { type: 'audio/wav' }) };

test('project bundle round-trips project JSON and every media blob byte-for-byte', async () => {
  const p = projectWithAssets();
  const packed = await packProject(p, async (k) => store[k]);
  assert.deepEqual(packed.missing, []);
  assert.equal(packed.mediaBytes, 8); // shared blob stored once
  const out = await unpackProject(packed.blob);
  assert.deepEqual(out.project, p);
  assert.deepEqual(out.blobs.map((b) => b.key), ['k1', 'k2']);
  assert.deepEqual([...new Uint8Array(await out.blobs[0]!.blob.arrayBuffer())], [1, 2, 3, 4, 5]);
  assert.equal(out.blobs[1]!.blob.type, 'audio/wav');
});

test('missing media is reported, not fatal', async () => {
  const packed = await packProject(projectWithAssets(), async (k) => (k === 'k1' ? store.k1 : undefined));
  assert.deepEqual(packed.missing, ['k2']);
  assert.equal((await unpackProject(packed.blob)).blobs.length, 1);
});

test('corrupt, truncated and foreign files are rejected with clear errors', async () => {
  await assert.rejects(unpackProject(new Blob(['hello world, definitely not a project'])), /not an F4 project/);
  await assert.rejects(unpackProject(new Blob(['x'])), /too small/);
  const packed = await packProject(projectWithAssets(), async (k) => store[k]);
  await assert.rejects(unpackProject(packed.blob.slice(0, packed.blob.size - 3)), /truncated/);
  const bad = new Blob([new TextEncoder().encode('F4PROJ01'), new Uint8Array([255, 255, 255, 127]), new Uint8Array(20)]);
  await assert.rejects(unpackProject(bad), /damaged/);
});

test('safeFileName strips path-hostile characters', () => {
  assert.equal(safeFileName('My: cool/project'), 'My- cool-project');
  assert.equal(safeFileName('???'), 'f4-project');
});

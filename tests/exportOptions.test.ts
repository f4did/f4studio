import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEncodePlan, createProject, estimateSizeBytes, exportFileName } from '../src/core';
import { outputSize } from '../src/engine/export';

const base = () => createProject('My Clip!').export;
const val = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

test('quality maps to CRF and speed maps to x264 preset', () => {
  const draft = buildEncodePlan({ ...base(), quality: 'draft', speed: 'slow' }, true).args;
  const best = buildEncodePlan({ ...base(), quality: 'best', speed: 'fast' }, true).args;
  assert.equal(val(draft, '-crf'), '28');
  assert.equal(val(draft, '-preset'), 'medium');
  assert.equal(val(best, '-crf'), '15');
  assert.equal(val(best, '-preset'), 'ultrafast');
});

test('bitrate mode uses the requested bitrate instead of CRF', () => {
  const args = buildEncodePlan({ ...base(), rateControl: 'bitrate', videoBitrateKbps: 4500, audioBitrateKbps: 128 }, true).args;
  assert.equal(val(args, '-b:v'), '4500k');
  assert.equal(val(args, '-b:a'), '128k');
  assert.ok(!args.includes('-crf'));
});

test('webm export uses libvpx + opus and a .webm output', () => {
  const plan = buildEncodePlan({ ...base(), container: 'webm' }, true);
  assert.equal(plan.extension, 'webm');
  assert.equal(plan.output, 'f4-export.webm');
  assert.equal(val(plan.args, '-c:v'), 'libvpx');
  assert.equal(val(plan.args, '-c:a'), 'libopus');
  assert.equal(plan.mime, 'video/webm');
});

test('silent projects get no audio encoder flags', () => {
  const args = buildEncodePlan(base(), false).args;
  assert.ok(!args.includes('-c:a'));
});

test('resolution and fps requests change the output size and the size estimate', () => {
  const p = createProject('x', 30, '16:9');
  assert.deepEqual(outputSize({ ...p, export: { ...p.export, resolution: 720 } }), { width: 1280, height: 720 });
  assert.deepEqual(outputSize({ ...p, export: { ...p.export, resolution: 480 } }), { width: 854, height: 480 });
  const small = estimateSizeBytes({ ...base(), resolution: 480 }, 60, true);
  const large = estimateSizeBytes({ ...base(), resolution: 1080 }, 60, true);
  assert.ok(large > small * 3);
  const fixed = estimateSizeBytes({ ...base(), rateControl: 'bitrate', videoBitrateKbps: 8000, audioBitrateKbps: 192 }, 10, true);
  assert.equal(fixed, Math.round(((8000 + 192) * 1000 / 8) * 10));
});

test('file name uses the custom name, falls back to the project name, and matches the container', () => {
  assert.equal(exportFileName('My Clip!', base()), 'My-Clip.mp4');
  assert.equal(exportFileName('My Clip!', { ...base(), fileName: 'Final Cut v2.mp4', container: 'webm' }), 'Final-Cut-v2.webm');
});

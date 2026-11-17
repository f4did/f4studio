import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTemplateProject, PROJECT_TEMPLATES } from '../src/core/templates';
import { dotLineLevels, progressBorderGeometry } from '../src/engine/playback';
import { ffmpegProgressBorderSource } from '../src/engine/export';
import { defaultVisualizer } from '../src/core/model/factory';

test('lofi template has title, subtitle, credits, dotline visualizer and progress frame on named tracks', () => {
  assert.ok(PROJECT_TEMPLATES.some((t) => t.id === 'lofi-slowed'));
  const p = createTemplateProject('lofi-slowed');
  const clips = Object.values(p.clips);
  const texts = clips.map((c) => c.text?.text).filter(Boolean);
  assert.deepEqual(texts.sort(), ['(Slowed + Reverb)', 'Artist Name', 'Song Title', 'Your Channel | Reverb Echoes'].sort());
  assert.ok(clips.some((c) => c.visualizer?.type === 'dotline'));
  assert.ok(clips.some((c) => c.visualizer?.type === 'framepulse'));
  const names = p.tracks.map((t) => t.name);
  assert.ok(names.includes('Progress bar') && names.includes('Audio visualizer'));
});

test('dotline levels spread evenly across the width and respond to silence', () => {
  const silent = dotLineLevels(new Uint8Array(512), new Uint8Array(1024).fill(128), 96, 0.5, []);
  assert.ok(silent.every((v) => v === 0));
  const loud = dotLineLevels(new Uint8Array(512).fill(220), new Uint8Array(1024).fill(128), 96, 0.5, []);
  assert.ok(loud.every((v) => v > 0.3));
  assert.ok(Math.abs(loud[48]! - loud[0]!) < 0.3 && Math.abs(loud[95]! - loud[48]!) < 0.3);
});

test('progress border perimeter and ffmpeg source are sane', () => {
  const g = progressBorderGeometry(1920, 1080);
  assert.ok(g.perimeter > 2 * (g.w + g.h) - 8 * g.r - 1 && g.perimeter < 2 * (g.w + g.h));
  const src = ffmpegProgressBorderSource(defaultVisualizer('framepulse'), { width: 1920, height: 1080 }, 30, 12);
  assert.match(src, /^color=c=black@0:s=960x540/);
  assert.match(src, /geq=r=255:g=255:b=255:a='/);
  const expr = /a='([^']*)'/.exec(src)![1]!;
  assert.ok(!/(^|[^\\]),/.test(expr), 'commas inside expression must be escaped');
});

test('progress frame head starts bottom-left, goes up the left side, then across the top', async () => {
  const { progressBorderPoint } = await import('../src/engine/playback');
  const g = progressBorderGeometry(1920, 1080);
  const start = progressBorderPoint(g, 0);
  assert.ok(start.x < 40 && start.y > 1000);
  const quarter = progressBorderPoint(g, g.perimeter * 0.25);
  assert.ok(quarter.y < 40, 'a quarter of the way round the head is on the top edge');
  const mid = progressBorderPoint(g, g.perimeter * 0.5);
  assert.ok(mid.x > 1800, 'halfway round it is down the right side');
  const full = progressBorderPoint(g, g.perimeter - 1);
  assert.ok(full.x < 120 && full.y > 1000, 'the loop closes at the start');
});

test('new visualizer and progress styles have sensible defaults and export sources', async () => {
  const { isProgressVisualizer, defaultVisualizer: dv } = await import('../src/core');
  const { bandLevels } = await import('../src/engine/playback');
  const { ffmpegProgressStyleSource } = await import('../src/engine/export');
  for (const type of ['progressline', 'progresssegments', 'progressring', 'framepulse'] as const) assert.ok(isProgressVisualizer(type), type);
  for (const type of ['dotline', 'roundbars', 'dotmatrix', 'ripple', 'spectrum'] as const) assert.ok(!isProgressVisualizer(type), type);
  assert.ok((dv('progressline')!.waveformY ?? 0) > 0.9 && (dv('progressring')!.waveformY ?? 0) === 0.5 && (dv('progresssegments')!.bars ?? 0) === 28);
  const loud = new Uint8Array(512).fill(200);
  const levels = bandLevels(loud, 24, 0.5, []);
  assert.equal(levels.length, 24);
  assert.ok(levels.every((v) => v > 0.7 && v <= 1));
  assert.ok(bandLevels(new Uint8Array(512), 24, 0.5, []).every((v) => v === 0));
  for (const type of ['progressline', 'progresssegments', 'progressring'] as const) {
    const src = ffmpegProgressStyleSource(dv(type), { width: 1280, height: 720 }, 30, 10);
    assert.match(src, /^color=c=black@0:s=960x540/, type);
    const expr = /a='([^']*)'/.exec(src)![1]!;
    assert.ok(!/(^|[^\\]),/.test(expr), `${type}: commas must be escaped`);
    assert.match(expr, /T\//, `${type}: depends on time`);
  }
});

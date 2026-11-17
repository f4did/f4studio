import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectsForFilter, evaluateKeyframes, evaluateTextAnimation, evaluateTransition, FILTER_PRESETS, setKeyframe, TEXT_ANIMATION_PRESETS, TRANSITION_PRESETS } from '../src/core';

test('text animation registry contains 50 selectable presets', () => {
  assert.equal(TEXT_ANIMATION_PRESETS.length, 50);
  assert.equal(new Set(TEXT_ANIMATION_PRESETS.map((preset) => preset.id)).size, 50);
});

test('text animation evaluation is deterministic and bounded', () => {
  for (const preset of TEXT_ANIMATION_PRESETS) {
    const frame = evaluateTextAnimation({ presetId: preset.id, durationFrames: 30, speed: 1 }, 0.5);
    for (const value of Object.values(frame)) assert.ok(Number.isFinite(value));
    assert.ok(frame.opacity >= 0 && frame.opacity <= 1.5);
    assert.ok(frame.scale > 0);
  }
});

test('transition registry contains 30 previewable presets', () => {
  assert.equal(TRANSITION_PRESETS.length, 30);
  for (const preset of TRANSITION_PRESETS) {
    const frame = evaluateTransition({ id: preset.id, type: preset.id, durationFrames: 15, direction: preset.direction, intensity: 1, params: {} }, 0.5);
    assert.ok(Number.isFinite(frame.alpha));
    assert.ok(frame.alpha >= 0 && frame.alpha <= 1.5);
  }
});

test('filter registry contains at least 40 presets with renderable effect stacks', () => {
  assert.ok(FILTER_PRESETS.length >= 40);
  assert.equal(new Set(FILTER_PRESETS.map((preset) => preset.id)).size, FILTER_PRESETS.length);
  for (const preset of FILTER_PRESETS) assert.ok(effectsForFilter(preset.id).length > 0);
});

test('keyframes interpolate on the frame timeline and support holds', () => {
  let map = setKeyframe({}, 'transform.x', 0, 0);
  map = setKeyframe(map, 'transform.x', 10, 1);
  assert.equal(evaluateKeyframes(map['transform.x'], 5, 0), 0.5);
  map = setKeyframe(map, 'transform.x', 0, 0, 'hold');
  assert.equal(evaluateKeyframes(map['transform.x'], 5, 0), 0);
});

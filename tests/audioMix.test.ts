import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pitchShift, resampleTape, prepareClipSamples } from '../src/engine/audioMix';
import { createClip, defaultAudio } from '../src/core';

function sine(freq: number, seconds: number, sr = 48000): Float32Array {
  const out = new Float32Array(Math.round(seconds * sr));
  for (let i = 0; i < out.length; i += 1) out[i] = Math.sin((2 * Math.PI * freq * i) / sr) * 0.5;
  return out;
}
function frequencyOf(data: Float32Array, sr = 48000): number {
  let crossings = 0;
  for (let i = sr / 4; i < data.length - sr / 4; i += 1) if (data[i - 1]! < 0 && data[i]! >= 0) crossings += 1;
  return crossings / ((data.length - sr / 2) / sr);
}

test('tape resample changes length and pitch together (slower = longer and lower)', () => {
  const slowed = resampleTape(sine(440, 2), 0.5);
  assert.equal(slowed.length, 192000);
  assert.ok(Math.abs(frequencyOf(slowed) - 220) < 3);
});

test('pitch shift keeps duration and moves frequency by the ratio', () => {
  const input = sine(440, 2);
  const up = pitchShift(input, 2);
  assert.equal(up.length, input.length);
  assert.ok(Math.abs(frequencyOf(up) - 880) < 20, `got ${frequencyOf(up)}`);
  const down = pitchShift(input, 0.75);
  assert.ok(Math.abs(frequencyOf(down) - 330) < 12, `got ${frequencyOf(down)}`);
});

test('keep-pitch slowdown lengthens audio but keeps the note; tape mode lowers it', () => {
  const decoded = { channels: [sine(440, 4), sine(440, 4)], sampleRate: 48000 };
  const clip = createClip({ kind: 'audio', trackId: 't', assetId: 'a', name: 'a', start: 0, duration: 240 });
  const slowKeep = { ...clip, speed: 0.5, duration: 240, audio: { ...defaultAudio(), preservePitch: true } };
  const keep = prepareClipSamples(slowKeep, 30, decoded)[0]!;
  assert.equal(keep.length, 240 * 1600);
  assert.ok(Math.abs(frequencyOf(keep) - 440) < 25, `keep ${frequencyOf(keep)}`);
  const tape = prepareClipSamples({ ...slowKeep, audio: { ...slowKeep.audio, preservePitch: false } }, 30, decoded)[0]!;
  assert.ok(Math.abs(frequencyOf(tape) - 220) < 6, `tape ${frequencyOf(tape)}`);
});

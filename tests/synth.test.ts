import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SFX, SONGS, SAMPLE_RATE, encodeWav } from '../src/engine/synth';
import { pickMimeType, recordingFileName, formatElapsed, extensionForMime } from '../src/engine/recorder';

const stats = (a: Float32Array) => { let peak = 0, sum = 0; for (const v of a) { peak = Math.max(peak, Math.abs(v)); sum += v * v; } return { peak, rms: Math.sqrt(sum / a.length), finite: a.every(Number.isFinite) }; };

test('every sound effect renders finite, audible, normalised audio of the advertised length', () => {
  for (const s of SFX) {
    const r = s.render(SAMPLE_RATE);
    assert.equal(r.left.length, Math.round(s.durationSec * SAMPLE_RATE), s.id);
    const st = stats(r.left);
    assert.ok(st.finite, `${s.id} has NaN`);
    assert.ok(st.peak > 0.5 && st.peak <= 0.9, `${s.id} peak ${st.peak}`);
    assert.ok(st.rms > 0.005, `${s.id} too quiet`);
  }
});

test('every song renders ~8 bars of finite, audible stereo audio', () => {
  for (const s of SONGS) {
    const r = s.render(SAMPLE_RATE);
    const expected = s.bars * 4 * (60 / s.bpm);
    assert.ok(r.left.length / SAMPLE_RATE >= expected && r.left.length / SAMPLE_RATE < expected + 2, s.id);
    const l = stats(r.left), rr = stats(r.right);
    assert.ok(l.finite && rr.finite, `${s.id} NaN`);
    assert.ok(l.peak <= 0.9 && l.rms > 0.02, `${s.id} levels ${l.peak} ${l.rms}`);
    assert.ok(Math.abs(l.rms - rr.rms) / l.rms < 0.6, `${s.id} wildly unbalanced`);
  }
});

test('rendering is deterministic', () => {
  const a = SONGS[0]!.render(8000), b = SONGS[0]!.render(8000);
  assert.deepEqual(a.left.slice(0, 2000), b.left.slice(0, 2000));
});

test('WAV encoder writes a valid 16-bit stereo PCM header', () => {
  const r = SFX[4]!.render(SAMPLE_RATE); const w = encodeWav(r); const dv = new DataView(w.buffer);
  assert.equal(String.fromCharCode(...w.slice(0, 4)), 'RIFF'); assert.equal(String.fromCharCode(...w.slice(8, 12)), 'WAVE');
  assert.equal(dv.getUint16(22, true), 2); assert.equal(dv.getUint32(24, true), SAMPLE_RATE); assert.equal(dv.getUint16(34, true), 16);
  assert.equal(dv.getUint32(40, true), r.left.length * 4); assert.equal(w.length, 44 + r.left.length * 4);
});

test('recorder helpers: mime negotiation, names, timer', () => {
  assert.equal(pickMimeType('screen', (m) => m.startsWith('video/webm;codecs=vp8')), 'video/webm;codecs=vp8,opus');
  assert.equal(pickMimeType('voice', (m) => m === 'audio/webm'), 'audio/webm');
  assert.equal(pickMimeType('webcam', () => false), undefined);
  assert.equal(extensionForMime('video/mp4;codecs=avc1', 'webcam'), 'mp4'); assert.equal(extensionForMime('audio/mp4', 'voice'), 'm4a'); assert.equal(extensionForMime('audio/webm;codecs=opus', 'voice'), 'webm');
  assert.equal(recordingFileName('screen', 'video/webm', new Date(2026, 10, 5, 9, 4, 7)), 'Screen recording 2026-11-05 09.04.07.webm');
  assert.equal(formatElapsed(75.9), '01:15'); assert.equal(formatElapsed(-3), '00:00');
});

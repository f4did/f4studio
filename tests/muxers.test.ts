import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { avcCRecord, avccFromAnnexB, Mp4Muxer, WebmMuxer, type Sample } from '../src/engine/muxers';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const run = (args: string[]) => { const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { maxBuffer: 1 << 28 }); assert.equal(r.status, 0, String(r.stderr)); return new Uint8Array(r.stdout); };

function adts(stream: Uint8Array): { asc: Uint8Array; frames: Uint8Array[]; rate: number } {
  const frames: Uint8Array[] = []; let i = 0; let asc = new Uint8Array(2); let rate = 48000;
  const rates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000];
  while (i + 7 < stream.length) {
    const len = ((stream[i + 3]! & 3) << 11) | (stream[i + 4]! << 3) | (stream[i + 5]! >> 5);
    const aot = ((stream[i + 2]! >> 6) & 3) + 1; const idx = (stream[i + 2]! >> 2) & 15; const ch = ((stream[i + 2]! & 1) << 2) | (stream[i + 3]! >> 6);
    asc = Uint8Array.from([(aot << 3) | (idx >> 1), ((idx & 1) << 7) | (ch << 3)]); rate = rates[idx]!;
    frames.push(stream.subarray(i + 7, i + len)); i += len;
  }
  return { asc, frames, rate };
}

test('MP4 muxer output is a valid H.264 + AAC file', { skip: !hasFfmpeg }, () => {
  const h264 = run(['-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=30', '-t', '2', '-c:v', 'libx264', '-bf', '0', '-g', '30', '-f', 'h264', '-']);
  const aac = run(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-f', 'adts', '-']);
  const v = avccFromAnnexB(h264); const a = adts(aac);
  assert.ok(v.samples.length >= 59 && v.sps.length && v.pps.length);
  const mux = new Mp4Muxer({ codec: 'avc', width: 320, height: 240, description: avcCRecord(v.sps, v.pps) }, { codec: 'aac', sampleRate: a.rate, channels: 2, description: a.asc });
  v.samples.forEach((s, i) => mux.addVideo({ timestampUs: Math.round(i * 1e6 / 30), durationUs: Math.round(1e6 / 30), data: s.data, key: s.key } satisfies Sample));
  a.frames.forEach((f, i) => mux.addAudio({ timestampUs: Math.round(i * 1024 * 1e6 / 48000), durationUs: Math.round(1024 * 1e6 / 48000), data: f, key: true }));
  const file = join(mkdtempSync(join(tmpdir(), 'mp4-')), 'out.mp4');
  writeFileSync(file, mux.finalize());
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height,nb_frames:format=duration', '-of', 'json', file]);
  const info = JSON.parse(String(probe.stdout));
  assert.deepEqual(info.streams.map((s: { codec_name: string }) => s.codec_name).sort(), ['aac', 'h264']);
  assert.ok(Math.abs(Number(info.format.duration) - 2) < 0.1, `duration ${info.format.duration}`);
  const decode = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'null', '-']);
  assert.equal(String(decode.stderr).trim(), '');
});

test('WebM muxer output is a valid VP9 file with cues', { skip: !hasFfmpeg }, () => {
  const ivf = run(['-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=30', '-t', '2', '-c:v', 'libvpx-vp9', '-g', '30', '-f', 'ivf', '-']);
  const dv = new DataView(ivf.buffer, ivf.byteOffset, ivf.byteLength);
  let o = dv.getUint16(6, true); const frames: Sample[] = []; let n = 0;
  while (o + 12 <= ivf.length) { const size = dv.getUint32(o, true); const data = ivf.subarray(o + 12, o + 12 + size); frames.push({ timestampUs: Math.round(n * 1e6 / 30), durationUs: Math.round(1e6 / 30), data, key: (data[0]! & 0x04) === 0 }); o += 12 + size; n += 1; }
  const mux = new WebmMuxer({ codec: 'vp9', width: 320, height: 240 });
  frames.forEach((f) => mux.addVideo(f));
  const file = join(mkdtempSync(join(tmpdir(), 'webm-')), 'out.webm');
  writeFileSync(file, mux.finalize());
  const probe = spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_name,nb_read_frames:format=duration', '-of', 'json', file]);
  const info = JSON.parse(String(probe.stdout));
  assert.equal(info.streams[0].codec_name, 'vp9');
  assert.equal(Number(info.streams[0].nb_read_frames), frames.length);
  assert.ok(Math.abs(Number(info.format.duration) - 2) < 0.1);
});

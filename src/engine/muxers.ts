/**
 * Tiny in-memory MP4 and WebM muxers for WebCodecs output. Pure byte building (no DOM),
 * so they can be unit tested in Node. All samples are buffered, which lets us write
 * "fast start" MP4s (moov before mdat) and WebM files with Cues and an exact Duration.
 */
export interface Sample { timestampUs: number; durationUs: number; data: Uint8Array; key: boolean }

export interface VideoTrackInfo { codec: 'avc' | 'vp8' | 'vp9'; width: number; height: number; /** avcC record for H.264 */ description?: Uint8Array }
export interface AudioTrackInfo { codec: 'aac' | 'opus'; sampleRate: number; channels: number; /** AudioSpecificConfig (AAC) or OpusHead */ description?: Uint8Array }

// ---------------------------------------------------------------- byte helpers
class Bytes {
  private parts: Uint8Array[] = [];
  length = 0;
  push(...chunks: Array<Uint8Array | number[]>): this { for (const c of chunks) { const u = c instanceof Uint8Array ? c : Uint8Array.from(c); this.parts.push(u); this.length += u.length; } return this; }
  bytes(): Uint8Array { const out = new Uint8Array(this.length); let o = 0; for (const p of this.parts) { out.set(p, o); o += p.length; } return out; }
}
const u8 = (...v: number[]) => Uint8Array.from(v);
const u16 = (v: number) => u8((v >> 8) & 255, v & 255);
const u32 = (v: number) => u8((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
const str = (s: string) => Uint8Array.from(Array.from(s, (c) => c.charCodeAt(0)));
const zeros = (n: number) => new Uint8Array(n);
const cat = (...items: Array<Uint8Array | number[]>) => new Bytes().push(...items).bytes();

// ---------------------------------------------------------------- MP4
const box = (type: string, ...children: Array<Uint8Array | number[]>): Uint8Array => {
  const body = cat(...children);
  return cat(u32(body.length + 8), str(type), body);
};
const fullBox = (type: string, version: number, flags: number, ...children: Array<Uint8Array | number[]>) => box(type, u8(version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255), ...children);

const MATRIX = cat(u32(0x00010000), u32(0), u32(0), u32(0), u32(0x00010000), u32(0), u32(0), u32(0), u32(0x40000000));

interface Mp4Track { id: number; timescale: number; samples: Sample[]; kind: 'video' | 'audio'; sampleEntry: Uint8Array; width: number; height: number; offsets: number[] }

function esds(asc: Uint8Array): Uint8Array {
  // DecoderConfigDescriptor: objectType 0x40 (MPEG-4 audio), streamType audio (0x15), buffer size, bitrates, then the ASC.
  const decoderConfig = cat([0x04, 13 + 2 + asc.length], [0x40, 0x15], [0, 0, 0], u32(0), u32(0), [0x05, asc.length], asc);
  const es = cat([0x03, 3 + decoderConfig.length + 3], u16(0), [0], decoderConfig, [0x06, 0x01, 0x02]);
  return fullBox('esds', 0, 0, es);
}

export class Mp4Muxer {
  private video: Sample[] = [];
  private audio: Sample[] = [];
  constructor(private readonly v: VideoTrackInfo, private readonly a?: AudioTrackInfo) {
    if (v.codec !== 'avc' || !v.description) throw new Error('MP4 output needs H.264 with an avcC description.');
    if (a && (a.codec !== 'aac' || !a.description)) throw new Error('MP4 output needs AAC audio with a decoder config.');
  }
  addVideo(s: Sample) { this.video.push(s); }
  addAudio(s: Sample) { this.audio.push(s); }

  finalize(): Uint8Array {
    const tracks: Mp4Track[] = [];
    const vEntry = box('avc1', zeros(6), u16(1), zeros(16), u16(this.v.width), u16(this.v.height), u32(0x00480000), u32(0x00480000), u32(0), u16(1), zeros(32), u16(0x0018), u16(0xffff), box('avcC', this.v.description!));
    tracks.push({ id: 1, timescale: 90000, samples: this.video, kind: 'video', sampleEntry: vEntry, width: this.v.width, height: this.v.height, offsets: [] });
    if (this.a) {
      const aEntry = box('mp4a', zeros(6), u16(1), u16(0), u16(0), u32(0), u16(this.a.channels), u16(16), u16(0), u16(0), u32(this.a.sampleRate * 65536), esds(this.a.description!));
      tracks.push({ id: 2, timescale: this.a.sampleRate, samples: this.audio, kind: 'audio', sampleEntry: aEntry, width: 0, height: 0, offsets: [] });
    }
    const ftyp = box('ftyp', str('isom'), u32(0x200), str('isom'), str('iso2'), str('avc1'), str('mp41'));
    // Interleave by time so players can stream.
    const order: Array<{ track: Mp4Track; index: number; t: number }> = [];
    for (const track of tracks) track.samples.forEach((s, index) => order.push({ track, index, t: s.timestampUs }));
    order.sort((x, y) => x.t - y.t || x.track.id - y.track.id);

    const build = (mdatStart: number): Uint8Array => {
      let cursor = mdatStart + 8;
      for (const t of tracks) t.offsets = new Array<number>(t.samples.length);
      for (const o of order) { o.track.offsets[o.index] = cursor; cursor += o.track.samples[o.index]!.data.length; }
      const movieTimescale = 1000;
      const durations = tracks.map((t) => { const last = t.samples[t.samples.length - 1]; return last ? (last.timestampUs + last.durationUs) / 1e6 : 0; });
      const movieDuration = Math.round(Math.max(...durations) * movieTimescale);
      const traks = tracks.map((t, i) => trak(t, Math.round(durations[i]! * movieTimescale)));
      return box('moov', fullBox('mvhd', 0, 0, u32(0), u32(0), u32(movieTimescale), u32(movieDuration), u32(0x00010000), u16(0x0100), zeros(10), MATRIX, zeros(24), u32(tracks.length + 1)), ...traks);
    };
    const moov0 = build(0);
    const moov = build(ftyp.length + moov0.length);
    const mdatSize = order.reduce((n, o) => n + o.track.samples[o.index]!.data.length, 0);
    const out = new Bytes().push(ftyp, moov, cat(u32(mdatSize + 8), str('mdat')));
    for (const o of order) out.push(o.track.samples[o.index]!.data);
    return out.bytes();
  }
}

function trak(t: Mp4Track, movieDuration: number): Uint8Array {
  const ticks = t.samples.map((s) => Math.round((s.timestampUs * t.timescale) / 1e6));
  const deltas = t.samples.map((s, i) => (i + 1 < t.samples.length ? Math.max(1, ticks[i + 1]! - ticks[i]!) : Math.max(1, Math.round((s.durationUs * t.timescale) / 1e6))));
  const mediaDuration = deltas.reduce((n, d) => n + d, 0);
  // run-length encode stts
  const stts: number[][] = [];
  for (const d of deltas) { const last = stts[stts.length - 1]; if (last && last[1] === d) last[0]! += 1; else stts.push([1, d]); }
  const keys = t.samples.map((s, i) => (s.key ? i + 1 : 0)).filter(Boolean);
  const isVideo = t.kind === 'video';
  const tkhd = fullBox('tkhd', 0, 3, u32(0), u32(0), u32(t.id), u32(0), u32(movieDuration), zeros(8), u16(0), u16(0), u16(isVideo ? 0 : 0x0100), u16(0), MATRIX, u32(t.width * 65536), u32(t.height * 65536));
  const mdhd = fullBox('mdhd', 0, 0, u32(0), u32(0), u32(t.timescale), u32(mediaDuration), u16(0x55c4), u16(0));
  const hdlr = fullBox('hdlr', 0, 0, u32(0), str(isVideo ? 'vide' : 'soun'), zeros(12), str(isVideo ? 'VideoHandler' : 'SoundHandler'), [0]);
  const media = isVideo ? fullBox('vmhd', 0, 1, zeros(8)) : fullBox('smhd', 0, 0, zeros(4));
  const dinf = box('dinf', fullBox('dref', 0, 0, u32(1), fullBox('url ', 0, 1)));
  const stsd = fullBox('stsd', 0, 0, u32(1), t.sampleEntry);
  const sttsBox = fullBox('stts', 0, 0, u32(stts.length), ...stts.map(([c, d]) => cat(u32(c!), u32(d!))));
  const stss = isVideo ? [fullBox('stss', 0, 0, u32(keys.length), ...keys.map((k) => u32(k)))] : [];
  const stsc = fullBox('stsc', 0, 0, u32(1), u32(1), u32(1), u32(1));
  const stsz = fullBox('stsz', 0, 0, u32(0), u32(t.samples.length), ...t.samples.map((s) => u32(s.data.length)));
  const stco = fullBox('stco', 0, 0, u32(t.offsets.length), ...t.offsets.map((o) => u32(o)));
  return box('trak', tkhd, box('mdia', mdhd, hdlr, box('minf', media, dinf, box('stbl', stsd, sttsBox, ...stss, stsc, stsz, stco))));
}

/** Split an Annex-B H.264 byte stream into NAL units (used by tests and as a fallback converter). */
export function avccFromAnnexB(stream: Uint8Array): { sps: Uint8Array; pps: Uint8Array; samples: Array<{ data: Uint8Array; key: boolean }> } {
  const nals: Uint8Array[] = [];
  let i = 0; let start = -1;
  while (i + 3 <= stream.length) {
    if (stream[i] === 0 && stream[i + 1] === 0 && (stream[i + 2] === 1 || (stream[i + 2] === 0 && stream[i + 3] === 1))) {
      const code = stream[i + 2] === 1 ? 3 : 4;
      if (start >= 0) nals.push(stream.subarray(start, i));
      start = i + code; i += code;
    } else i += 1;
  }
  if (start >= 0) nals.push(stream.subarray(start));
  let sps: Uint8Array = new Uint8Array(0); let pps: Uint8Array = new Uint8Array(0);
  const samples: Array<{ data: Uint8Array; key: boolean }> = [];
  let current: Uint8Array[] = []; let key = false;
  const flush = () => { if (current.length) { samples.push({ data: cat(...current), key }); current = []; key = false; } };
  for (const nal of nals) {
    const type = nal[0]! & 31;
    if (type === 7) { sps = nal; continue; }
    if (type === 8) { pps = nal; continue; }
    if (type === 9) { flush(); continue; }
    if (type === 6) continue;
    if (type === 1 || type === 5) {
      if ((nal[1]! & 0x80) !== 0) flush(); // first_mb_in_slice == 0 starts a new access unit
      if (type === 5) key = true;
      current.push(cat(u32(nal.length), nal));
    }
  }
  flush();
  return { sps, pps, samples };
}

export function avcCRecord(sps: Uint8Array, pps: Uint8Array): Uint8Array {
  return cat([1, sps[1]!, sps[2]!, sps[3]!, 0xff, 0xe1], u16(sps.length), sps, [1], u16(pps.length), pps);
}

// ---------------------------------------------------------------- WebM
const vint = (n: number): Uint8Array => { // EBML data size
  for (let len = 1; len <= 8; len += 1) if (n < 2 ** (7 * len) - 1) { const out = new Uint8Array(len); let v = n; for (let k = len - 1; k >= 0; k -= 1) { out[k] = v % 256; v = Math.floor(v / 256); } out[0]! |= 1 << (8 - len); return out; }
  throw new Error('EBML size too large');
};
const uint = (n: number): Uint8Array => { const bytes: number[] = []; let v = n; do { bytes.unshift(v % 256); v = Math.floor(v / 256); } while (v > 0); return Uint8Array.from(bytes); };
const f64 = (n: number) => { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, n); return b; };
const el = (id: number[], ...data: Array<Uint8Array | number[]>) => { const body = cat(...data); return cat(id, vint(body.length), body); };
const elUint = (id: number[], n: number) => el(id, uint(n));

export class WebmMuxer {
  private video: Sample[] = [];
  private audio: Sample[] = [];
  constructor(private readonly v: VideoTrackInfo, private readonly a?: AudioTrackInfo) {
    if (v.codec === 'avc') throw new Error('WebM cannot hold H.264.');
  }
  addVideo(s: Sample) { this.video.push(s); }
  addAudio(s: Sample) { this.audio.push(s); }

  finalize(): Uint8Array {
    const ms = (us: number) => Math.round(us / 1000);
    const ends = [this.video, this.audio].map((l) => { const s = l[l.length - 1]; return s ? ms(s.timestampUs + s.durationUs) : 0; });
    const durationMs = Math.max(...ends);
    const header = el([0x1a, 0x45, 0xdf, 0xa3], elUint([0x42, 0x86], 1), elUint([0x42, 0xf7], 1), elUint([0x42, 0xf2], 4), elUint([0x42, 0xf3], 8), el([0x42, 0x82], str('webm')), elUint([0x42, 0x87], 4), elUint([0x42, 0x85], 2));
    const info = el([0x15, 0x49, 0xa9, 0x66], elUint([0x2a, 0xd7, 0xb1], 1000000), el([0x4d, 0x80], str('F4 Studio')), el([0x57, 0x41], str('F4 Studio')), el([0x44, 0x89], f64(durationMs)));
    const videoEntry = el([0xae], elUint([0xd7], 1), elUint([0x73, 0xc5], 1), elUint([0x83], 1), elUint([0x9c], 0), el([0x86], str(this.v.codec === 'vp9' ? 'V_VP9' : 'V_VP8')), el([0xe0], elUint([0xb0], this.v.width), elUint([0xba], this.v.height)));
    const opusHead = this.a?.description ?? (this.a ? cat(str('OpusHead'), [1, this.a.channels], u8(312 & 255, 312 >> 8), u8(this.a.sampleRate & 255, (this.a.sampleRate >> 8) & 255, (this.a.sampleRate >> 16) & 255, (this.a.sampleRate >> 24) & 255), [0, 0, 0]) : undefined);
    const audioEntry = this.a ? el([0xae], elUint([0xd7], 2), elUint([0x73, 0xc5], 2), elUint([0x83], 2), elUint([0x9c], 0), el([0x86], str('A_OPUS')), el([0x63, 0xa2], opusHead!), el([0xe1], el([0xb5], new Uint8Array(new Float64Array([this.a.sampleRate]).buffer).reverse()), elUint([0x9f], this.a.channels))) : new Uint8Array(0);
    const tracks = el([0x16, 0x54, 0xae, 0x6b], videoEntry, audioEntry);

    type Item = { track: 1 | 2; s: Sample };
    const items: Item[] = [...this.video.map((s) => ({ track: 1 as const, s })), ...this.audio.map((s) => ({ track: 2 as const, s }))].sort((x, y) => x.s.timestampUs - y.s.timestampUs || x.track - y.track);
    const clusters: Array<{ time: number; bytes: Uint8Array }> = [];
    let cur: Item[] = []; let curStart = 0;
    const closeCluster = () => {
      if (!cur.length) return;
      const blocks = cur.map(({ track, s }) => { const rel = ms(s.timestampUs) - curStart; return el([0xa3], [0x80 | track], u16(rel & 0xffff), [s.key ? 0x80 : 0], s.data); });
      clusters.push({ time: curStart, bytes: el([0x1f, 0x43, 0xb6, 0x75], elUint([0xe7], curStart), ...blocks) });
      cur = [];
    };
    for (const it of items) {
      const t = ms(it.s.timestampUs);
      if (!cur.length) curStart = t;
      else if (t - curStart > 2000 || (it.track === 1 && it.s.key && t - curStart > 800)) { closeCluster(); curStart = t; }
      cur.push(it);
    }
    closeCluster();
    const segHead = cat(info, tracks);
    // Cue positions are relative to the start of the Segment data.
    let pos = segHead.length;
    const cuePoints = clusters.map((c) => { const p = pos; pos += c.bytes.length; return el([0xbb], elUint([0xb3], c.time), el([0xb7], elUint([0xf7], 1), elUint([0xf1], p))); });
    const cues = el([0x1c, 0x53, 0xbb, 0x6b], ...cuePoints);
    const segBody = cat(segHead, ...clusters.map((c) => c.bytes), cues);
    return cat(header, el([0x18, 0x53, 0x80, 0x67], segBody));
  }
}

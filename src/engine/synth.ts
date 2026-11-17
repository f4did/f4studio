/**
 * Offline sound design: royalty-free sound effects and short music beds generated
 * sample-by-sample (no network, no bundled audio, no licensing). Everything here is
 * pure and deterministic (seeded noise) so it can be unit-tested in Node.
 */

export const SAMPLE_RATE = 44100;
type Rng = () => number;

const mulberry32 = (seed: number): Rng => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const TAU = Math.PI * 2;
const mtof = (m: number) => 440 * 2 ** ((m - 69) / 12);

class Buf {
  readonly L: Float32Array;
  readonly R: Float32Array;
  constructor(readonly n: number, readonly sr: number) { this.L = new Float32Array(n); this.R = new Float32Array(n); }
  add(i: number, v: number, pan = 0): void {
    if (i < 0 || i >= this.n) return;
    const a = (pan + 1) * Math.PI / 4;
    this.L[i]! += v * Math.cos(a);
    this.R[i]! += v * Math.sin(a);
  }
}

// ---------- voices ----------
function kick(b: Buf, t0: number, g: number): void {
  const s0 = Math.round(t0 * b.sr); let ph = 0;
  for (let i = 0; i < 0.4 * b.sr; i++) { const t = i / b.sr; ph += TAU * (42 + 110 * Math.exp(-t * 30)) / b.sr; b.add(s0 + i, Math.sin(ph) * Math.exp(-t * 8) * g, 0); }
}
function snare(b: Buf, t0: number, g: number, rng: Rng, clap = false): void {
  const s0 = Math.round(t0 * b.sr); const len = 0.3 * b.sr;
  for (let i = 0; i < len; i++) {
    const t = i / b.sr;
    let n = (rng() * 2 - 1) * Math.exp(-t * (clap ? 16 : 20));
    if (clap) n *= 0.6 + 0.4 * Math.sin(t * 1500) ** 2;
    b.add(s0 + i, (n * 0.55 + (clap ? 0 : Math.sin(TAU * 188 * t) * Math.exp(-t * 28) * 0.5)) * g, clap ? 0.1 : 0);
  }
}
function hat(b: Buf, t0: number, g: number, rng: Rng, open = false, pan = 0.25): void {
  const s0 = Math.round(t0 * b.sr); const len = (open ? 0.22 : 0.06) * b.sr; let prev = 0;
  for (let i = 0; i < len; i++) { const t = i / b.sr; const x = rng() * 2 - 1; const hp = x - prev; prev = x; b.add(s0 + i, hp * Math.exp(-t * (open ? 16 : 75)) * g * 0.7, pan); }
}
function pluck(b: Buf, t0: number, f: number, dur: number, g: number, pan: number, decay = 6, bright = 1): void {
  const s0 = Math.round(t0 * b.sr); const len = dur * b.sr;
  for (let i = 0; i < len; i++) {
    const t = i / b.sr; const ph = TAU * f * t;
    const v = Math.sin(ph) + 0.5 * bright * Math.sin(2 * ph) * Math.exp(-t * decay * 1.6) + 0.25 * bright * Math.sin(3 * ph) * Math.exp(-t * decay * 2.4);
    b.add(s0 + i, v * Math.min(1, t * 400) * Math.exp(-t * decay) * g, pan);
  }
}
function bass(b: Buf, t0: number, f: number, dur: number, g: number, decay = 3): void {
  const s0 = Math.round(t0 * b.sr); const len = dur * b.sr;
  for (let i = 0; i < len; i++) {
    const t = i / b.sr; const ph = TAU * f * t;
    b.add(s0 + i, (Math.sin(ph) + 0.3 * Math.sin(2 * ph) + 0.1 * Math.sin(3 * ph)) * Math.min(1, t * 300) * Math.min(1, (dur - t) * 40) * Math.exp(-t * decay) * g, 0);
  }
}
/** Soft detuned-saw pad, one-pole low-passed, with slow attack/release. */
function pad(b: Buf, t0: number, notes: number[], dur: number, g: number, att = 0.5, rel = 0.8, bright = 0.1): void {
  const s0 = Math.round(t0 * b.sr); const len = Math.round((dur + rel) * b.sr);
  notes.forEach((m, ni) => {
    const f = mtof(m); const pan = ni % 2 ? 0.4 : -0.4; let lpL = 0; let lpR = 0;
    for (let i = 0; i < len; i++) {
      const t = i / b.sr;
      const env = Math.min(1, t / att) * Math.min(1, Math.max(0, (dur + rel - t) / rel));
      const sawL = 2 * ((f * 0.997 * t) % 1) - 1; const sawR = 2 * ((f * 1.003 * t) % 1) - 1;
      lpL += bright * (sawL - lpL); lpR += bright * (sawR - lpR);
      const k = g * env / notes.length;
      b.L[s0 + i] !== undefined && (b.L[s0 + i]! += lpL * k * (pan < 0 ? 1 : 0.7));
      b.R[s0 + i] !== undefined && (b.R[s0 + i]! += lpR * k * (pan > 0 ? 1 : 0.7));
    }
  });
}
function sweep(b: Buf, t0: number, dur: number, f0: number, f1: number, g: number, rng: Rng, q = 0.18, rise = true): void {
  const s0 = Math.round(t0 * b.sr); const len = dur * b.sr; let low = 0; let band = 0;
  for (let i = 0; i < len; i++) {
    const u = i / len; const f = f0 * (f1 / f0) ** u; const fc = 2 * Math.sin(Math.PI * Math.min(0.45, f / b.sr));
    const x = rng() * 2 - 1; low += fc * band; const high = x - low - q * band; band += fc * high;
    const env = rise ? u ** 2 : Math.sin(Math.PI * u) ** 1.5;
    b.add(s0 + i, band * env * g, Math.sin(u * 6) * 0.4);
  }
}

// ---------- finishing ----------
export function finish(b: Buf, peak = 0.89, fadeSec = 0.012): { left: Float32Array; right: Float32Array; sampleRate: number } {
  const fade = Math.max(1, Math.min(b.n >> 1, Math.round(fadeSec * b.sr)));
  let max = 1e-9;
  for (let i = 0; i < b.n; i++) {
    const f = Math.min(1, i / fade, (b.n - 1 - i) / fade);
    b.L[i] = Math.tanh(b.L[i]! * 0.9) * f; b.R[i] = Math.tanh(b.R[i]! * 0.9) * f;
    max = Math.max(max, Math.abs(b.L[i]!), Math.abs(b.R[i]!));
  }
  const g = peak / max;
  for (let i = 0; i < b.n; i++) { b.L[i] = b.L[i]! * g; b.R[i] = b.R[i]! * g; }
  return { left: b.L, right: b.R, sampleRate: b.sr };
}

export interface Rendered { left: Float32Array; right: Float32Array; sampleRate: number }

// ---------- sound effects ----------
export interface SfxDef { id: string; name: string; hint: string; durationSec: number; render: (sr: number) => Rendered }

function sfx(id: string, name: string, hint: string, durationSec: number, fn: (b: Buf, rng: Rng) => void, seed: number): SfxDef {
  return { id, name, hint, durationSec, render: (sr) => { const b = new Buf(Math.round(durationSec * sr), sr); fn(b, mulberry32(seed)); return finish(b, 0.89, 0.002); } };
}

export const SFX: SfxDef[] = [
  sfx('whoosh', 'Whoosh', 'Fast swipe transition', 0.9, (b, r) => sweep(b, 0, 0.9, 250, 3800, 1.1, r, 0.3, false), 11),
  sfx('swoosh-down', 'Swoosh down', 'Falling pass-by', 0.8, (b, r) => sweep(b, 0, 0.8, 4200, 200, 1.1, r, 0.3, false), 12),
  sfx('boom', 'Boom', 'Cinematic impact', 2.2, (b, r) => { kick(b, 0, 1.3); sweep(b, 0, 1.6, 900, 60, 0.7, r, 0.5, false); }, 13),
  sfx('riser', 'Riser', 'Tension build, 3 s', 3, (b, r) => { sweep(b, 0, 3, 120, 5000, 1.1, r, 0.25, true); pluck(b, 0, 110, 3, 0.2, 0, 0.3, 0.2); }, 14),
  sfx('click', 'Click', 'UI tap', 0.15, (b) => { const n = Math.round(0.08 * b.sr); for (let i = 0; i < n; i++) b.add(i, Math.sign(Math.sin(TAU * 1500 * i / b.sr)) * Math.exp(-i / b.sr * 90) * 0.6); }, 15),
  sfx('pop', 'Pop', 'Bubble pop', 0.25, (b) => { let ph = 0; const n = Math.round(0.18 * b.sr); for (let i = 0; i < n; i++) { const t = i / b.sr; ph += TAU * (900 - 650 * Math.min(1, t * 18)) / b.sr; b.add(i, Math.sin(ph) * Math.exp(-t * 26) * 0.9); } }, 16),
  sfx('laser', 'Laser', 'Sci-fi zap', 0.5, (b) => { let ph = 0; const n = Math.round(0.4 * b.sr); for (let i = 0; i < n; i++) { const t = i / b.sr; ph += TAU * (1800 * Math.exp(-t * 9) + 140) / b.sr; b.add(i, (2 * ((ph / TAU) % 1) - 1) * Math.exp(-t * 6) * 0.5); } }, 17),
  sfx('ding', 'Ding', 'Notification bell', 1.8, (b) => { for (const [m, a] of [[1, 1], [2.76, 0.5], [5.4, 0.25], [8.93, 0.12]] as const) pluck(b, 0, 988 * m, 1.7, a * 0.5, 0, 2.6 + m, 0); }, 18),
  sfx('shutter', 'Camera shutter', 'Photo capture', 0.3, (b, r) => { for (const t0 of [0, 0.075]) { const s0 = Math.round(t0 * b.sr); for (let i = 0; i < 0.05 * b.sr; i++) b.add(s0 + i, (r() * 2 - 1) * Math.exp(-i / b.sr * 90) * 0.8); } }, 19),
  sfx('success', 'Success chime', 'Positive confirmation', 1.2, (b) => { [72, 76, 79, 84].forEach((m, i) => pluck(b, i * 0.09, mtof(m), 1, 0.45, (i - 1.5) * 0.3, 4.5, 0.6)); }, 20),
];

// ---------- music ----------
export interface SongDef { id: string; name: string; mood: string; bpm: number; bars: number; render: (sr: number) => Rendered }

const chord = (root: number, kind: 'm7' | 'maj7' | 'm' | 'maj' | '6' | '7'): number[] => {
  const shape = { m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11], m: [0, 3, 7], maj: [0, 4, 7], '6': [0, 4, 7, 9], '7': [0, 4, 7, 10] }[kind];
  return shape.map((s) => root + s);
};

function song(id: string, name: string, mood: string, bpm: number, bars: number, seed: number, fn: (b: Buf, beat: number, rng: Rng) => void): SongDef {
  return { id, name, mood, bpm, bars, render: (sr) => { const beat = 60 / bpm; const b = new Buf(Math.round((bars * 4 * beat + 1.2) * sr), sr); fn(b, beat, mulberry32(seed)); return finish(b); } };
}

export const SONGS: SongDef[] = [
  song('lofi', 'Lo-Fi Chill', 'Relaxed · study · vlog', 78, 8, 101, (b, beat, r) => {
    const prog: Array<[number, 'm7' | 'maj7' | '6']> = [[57, 'm7'], [53, 'maj7'], [60, 'maj7'], [55, '6']];
    for (let bar = 0; bar < 8; bar++) {
      const [root, kind] = prog[bar % 4]!; const t = bar * 4 * beat; const notes = chord(root + 12, kind);
      pad(b, t, notes, 4 * beat, 0.5, 0.25, 0.5, 0.06);
      bass(b, t, mtof(root - 12), 1.8 * beat, 0.5); bass(b, t + 2.5 * beat, mtof(root - 12 + 7), 1.2 * beat, 0.4);
      for (let q = 0; q < 4; q++) { if (q === 0 || q === 2) kick(b, t + q * beat + (q === 2 ? beat * 0.5 : 0), 0.7); }
      snare(b, t + beat, 0.45, r); snare(b, t + 3 * beat, 0.45, r);
      for (let e = 0; e < 8; e++) hat(b, t + e * beat / 2 + (e % 2 ? beat * 0.06 : 0), e % 2 ? 0.16 : 0.24, r);
      [0, 1.5, 2.5, 3].forEach((q, i) => pluck(b, t + q * beat, mtof(notes[(i + bar) % notes.length]! + 12), 0.9 * beat, 0.22, i % 2 ? 0.35 : -0.35, 5, 0.5));
      for (let i = 0; i < 20; i++) { const s = Math.round((t + r() * 4 * beat) * b.sr); for (let k = 0; k < 40; k++) b.add(s + k, (r() * 2 - 1) * 0.04); }
    }
  }),
  song('pop', 'Upbeat Pop', 'Energetic · promo · social', 118, 8, 102, (b, beat, r) => {
    const prog: Array<[number, 'maj' | 'm']> = [[60, 'maj'], [55, 'maj'], [57, 'm'], [53, 'maj']];
    for (let bar = 0; bar < 8; bar++) {
      const [root, kind] = prog[bar % 4]!; const t = bar * 4 * beat; const notes = chord(root + 12, kind);
      pad(b, t, notes, 4 * beat, 0.3, 0.05, 0.2, 0.12);
      for (let q = 0; q < 4; q++) { kick(b, t + q * beat, 0.8); hat(b, t + q * beat + beat / 2, 0.3, r, true); }
      snare(b, t + beat, 0.5, r, true); snare(b, t + 3 * beat, 0.5, r, true);
      for (let e = 0; e < 8; e++) bass(b, t + e * beat / 2, mtof(root - 12 + (e % 4 === 3 ? 7 : 0)), 0.45 * beat, 0.5, 6);
      for (let s = 0; s < 16; s++) pluck(b, t + s * beat / 4, mtof(notes[[0, 1, 2, 1][s % 4]!]! + 12 + (s % 8 > 3 ? 12 : 0)), 0.3 * beat, 0.16, (s % 4 - 1.5) * 0.3, 11, 1);
    }
  }),
  song('cinematic', 'Cinematic Rise', 'Trailers · reveals · drama', 70, 8, 103, (b, beat, r) => {
    const prog: Array<[number, 'm' | 'maj']> = [[50, 'm'], [58, 'maj'], [53, 'maj'], [60, 'maj']];
    for (let bar = 0; bar < 8; bar++) {
      const [root, kind] = prog[bar % 4]!; const t = bar * 4 * beat; const lift = 0.5 + 0.5 * (bar / 7);
      pad(b, t, chord(root, kind).concat(chord(root + 12, kind)), 4 * beat, 0.55 * lift + 0.2, 1.4, 1.6, 0.05);
      bass(b, t, mtof(root - 24), 4 * beat, 0.6 * lift, 0.6);
      if (bar % 2 === 0) kick(b, t, 0.7 * lift + 0.2);
      if (bar >= 4) for (let q = 0; q < 4; q++) kick(b, t + q * beat, 0.35 * lift);
      if (bar === 3 || bar === 7) sweep(b, t, 4 * beat, 200, 6000, 0.8, r, 0.22, true);
    }
    kick(b, 8 * 4 * beat, 1.2);
  }),
  song('ambient', 'Calm Ambient', 'Meditation · b-roll · landscapes', 60, 8, 104, (b, beat, r) => {
    const prog: Array<[number, 'maj7' | 'm7']> = [[48, 'maj7'], [45, 'm7'], [53, 'maj7'], [55, '7' as never]];
    for (let bar = 0; bar < 8; bar++) {
      const [root, kind] = prog[bar % 4]!; const t = bar * 4 * beat;
      pad(b, t, chord(root + 12, kind === ('7' as never) ? 'maj7' : kind).concat([root]), 4 * beat, 0.6, 1.8, 2, 0.04);
      for (let n = 0; n < 3; n++) pluck(b, t + (n * 1.3 + r()) * beat, mtof(root + 24 + [0, 4, 7, 11][Math.floor(r() * 4)]!), 2.4 * beat, 0.16, r() * 1.2 - 0.6, 1.4, 0.2);
    }
  }),
  song('synthwave', 'Neon Drive', 'Retro · gaming · night city', 100, 8, 105, (b, beat, r) => {
    const prog: Array<[number, 'm' | 'maj']> = [[57, 'm'], [53, 'maj'], [60, 'maj'], [55, 'maj']];
    for (let bar = 0; bar < 8; bar++) {
      const [root, kind] = prog[bar % 4]!; const t = bar * 4 * beat; const notes = chord(root + 12, kind);
      pad(b, t, notes, 4 * beat, 0.35, 0.1, 0.4, 0.1);
      for (let e = 0; e < 8; e++) bass(b, t + e * beat / 2, mtof(root - 24), 0.48 * beat, 0.55, 5);
      for (let q = 0; q < 4; q++) kick(b, t + q * beat, 0.75);
      snare(b, t + beat, 0.5, r); snare(b, t + 3 * beat, 0.5, r);
      for (let s = 0; s < 16; s++) hat(b, t + s * beat / 4, s % 2 ? 0.1 : 0.17, r, false, s % 3 ? 0.3 : -0.3);
      for (let s = 0; s < 16; s++) pluck(b, t + s * beat / 4, mtof(notes[[0, 2, 1, 2][s % 4]!]! + 12 + (bar % 2) * 0), 0.22 * beat, 0.2, Math.sin(s) * 0.5, 7, 1.4);
    }
  }),
];

// ---------- WAV ----------
export function encodeWav(r: Rendered): Uint8Array {
  const n = r.left.length; const bytes = n * 4; const out = new Uint8Array(44 + bytes); const v = new DataView(out.buffer);
  const wr = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i); };
  wr(0, 'RIFF'); v.setUint32(4, 36 + bytes, true); wr(8, 'WAVE'); wr(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true); v.setUint32(24, r.sampleRate, true);
  v.setUint32(28, r.sampleRate * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); wr(36, 'data'); v.setUint32(40, bytes, true);
  for (let i = 0; i < n; i++) {
    v.setInt16(44 + i * 4, Math.max(-1, Math.min(1, r.left[i]!)) * 32767, true);
    v.setInt16(46 + i * 4, Math.max(-1, Math.min(1, r.right[i]!)) * 32767, true);
  }
  return out;
}

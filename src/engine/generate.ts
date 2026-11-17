/**
 * Generated media (browser only): backdrops and stickers rendered with canvas, audio via the
 * pure synth engine, all turned into ordinary Files so they flow through importFile like any
 * upload (stored in IndexedDB, exportable, no special cases downstream).
 */
import { encodeWav, SAMPLE_RATE, type Rendered } from './synth';

export interface BackdropSpec {
  id: string;
  name: string;
  kind: 'solid' | 'linear' | 'radial' | 'mesh' | 'stripes' | 'grid';
  colors: string[];
  angle?: number;
}

export const BACKDROPS: BackdropSpec[] = [
  { id: 'solid-black', name: 'Pure black', kind: 'solid', colors: ['#000000'] },
  { id: 'solid-white', name: 'Clean white', kind: 'solid', colors: ['#ffffff'] },
  { id: 'solid-green', name: 'Chroma green', kind: 'solid', colors: ['#00b140'] },
  { id: 'sunset', name: 'Sunset', kind: 'linear', colors: ['#ff512f', '#dd2476', '#4a1d96'], angle: 160 },
  { id: 'ocean', name: 'Deep ocean', kind: 'linear', colors: ['#0f2027', '#2c5364', '#38bdf8'], angle: 135 },
  { id: 'aurora', name: 'Aurora', kind: 'mesh', colors: ['#0b1026', '#22d3ee', '#8b5cf6', '#34d399'] },
  { id: 'candy', name: 'Candy pop', kind: 'mesh', colors: ['#2b1055', '#f472b6', '#fbbf24', '#60a5fa'] },
  { id: 'ember', name: 'Ember', kind: 'radial', colors: ['#fde68a', '#f97316', '#7f1d1d', '#0c0a09'] },
  { id: 'mint', name: 'Mint cream', kind: 'linear', colors: ['#d1fae5', '#a7f3d0', '#6ee7b7'], angle: 120 },
  { id: 'lavender', name: 'Lavender haze', kind: 'linear', colors: ['#ede9fe', '#c4b5fd', '#f0abfc'], angle: 45 },
  { id: 'neon-grid', name: 'Neon grid', kind: 'grid', colors: ['#0a0014', '#d946ef', '#22d3ee'] },
  { id: 'brutal-stripes', name: 'Hazard stripes', kind: 'stripes', colors: ['#facc15', '#0a0a0a'], angle: 45 },
  { id: 'midnight', name: 'Midnight', kind: 'radial', colors: ['#312e81', '#1e1b4b', '#020617'] },
  { id: 'peach', name: 'Peach fuzz', kind: 'mesh', colors: ['#fff1e6', '#ffb4a2', '#ffcdb2', '#e5989b'] },
];

export function paintBackdrop(ctx: CanvasRenderingContext2D, spec: BackdropSpec, w: number, h: number): void {
  const c = spec.colors;
  const stops = (g: CanvasGradient) => c.forEach((col, i) => g.addColorStop(c.length === 1 ? 0 : i / (c.length - 1), col));
  if (spec.kind === 'solid') { ctx.fillStyle = c[0]!; ctx.fillRect(0, 0, w, h); return; }
  if (spec.kind === 'linear') {
    const a = ((spec.angle ?? 135) - 90) * Math.PI / 180; const r = Math.hypot(w, h) / 2;
    const g = ctx.createLinearGradient(w / 2 - Math.cos(a) * r, h / 2 - Math.sin(a) * r, w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r);
    stops(g); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); return;
  }
  if (spec.kind === 'radial') { const g = ctx.createRadialGradient(w / 2, h * 0.55, 0, w / 2, h * 0.55, Math.hypot(w, h) * 0.6); stops(g); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); return; }
  if (spec.kind === 'mesh') {
    ctx.fillStyle = c[0]!; ctx.fillRect(0, 0, w, h);
    const spots: Array<[number, number, number]> = [[0.15, 0.2, 0.7], [0.85, 0.15, 0.6], [0.7, 0.9, 0.75], [0.1, 0.85, 0.55]];
    c.slice(1).forEach((col, i) => {
      const [x, y, rr] = spots[i % spots.length]!; const R = rr * Math.max(w, h) * 0.75;
      const g = ctx.createRadialGradient(x * w, y * h, 0, x * w, y * h, R); g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = 0.9; ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    });
    ctx.globalAlpha = 1; return;
  }
  if (spec.kind === 'stripes') {
    ctx.fillStyle = c[0]!; ctx.fillRect(0, 0, w, h); ctx.fillStyle = c[1]!;
    ctx.save(); ctx.translate(w / 2, h / 2); ctx.rotate(((spec.angle ?? 45) * Math.PI) / 180);
    const band = Math.max(w, h) / 14; const span = Math.hypot(w, h);
    for (let x = -span; x < span; x += band * 2) ctx.fillRect(x, -span, band, span * 2);
    ctx.restore(); return;
  }
  // grid: synthwave floor
  const sky = ctx.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, c[0]!); sky.addColorStop(0.55, '#2a0a45'); sky.addColorStop(1, c[0]!);
  ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
  const horizon = h * 0.55; ctx.strokeStyle = c[1]!; ctx.lineWidth = Math.max(1, w / 900); ctx.shadowColor = c[1]!; ctx.shadowBlur = 12;
  for (let i = -20; i <= 20; i++) { ctx.beginPath(); ctx.moveTo(w / 2 + i * w * 0.02, horizon); ctx.lineTo(w / 2 + i * w * 0.2, h); ctx.stroke(); }
  for (let i = 0; i < 12; i++) { const y = horizon + (h - horizon) * (i / 12) ** 2; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  ctx.shadowBlur = 0; const sun = ctx.createRadialGradient(w / 2, horizon, 0, w / 2, horizon, h * 0.3); sun.addColorStop(0, c[2]!); sun.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = 0.55; ctx.fillStyle = sun; ctx.fillRect(0, 0, w, horizon); ctx.globalAlpha = 1;
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Canvas export failed.'))), type, quality));

export async function renderBackdropFile(spec: BackdropSpec, width: number, height: number): Promise<File> {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Canvas is not available.');
  paintBackdrop(ctx, spec, width, height);
  return new File([await toBlob(canvas, 'image/jpeg', 0.92)], `Backdrop · ${spec.name}.jpg`, { type: 'image/jpeg' });
}

export const STICKERS: Array<{ glyph: string; name: string }> = [
  { glyph: '🔥', name: 'Fire' }, { glyph: '⭐', name: 'Star' }, { glyph: '❤️', name: 'Heart' }, { glyph: '😂', name: 'Laugh' },
  { glyph: '😎', name: 'Cool' }, { glyph: '🎉', name: 'Party' }, { glyph: '👍', name: 'Thumbs up' }, { glyph: '👏', name: 'Clap' },
  { glyph: '💯', name: '100' }, { glyph: '✨', name: 'Sparkles' }, { glyph: '🚀', name: 'Rocket' }, { glyph: '💥', name: 'Boom' },
  { glyph: '👀', name: 'Eyes' }, { glyph: '🙌', name: 'Hooray' }, { glyph: '⚡', name: 'Bolt' }, { glyph: '🎬', name: 'Clapper' },
  { glyph: '🎵', name: 'Note' }, { glyph: '📍', name: 'Pin' }, { glyph: '➡️', name: 'Arrow' }, { glyph: '❗', name: 'Alert' },
  { glyph: '🔔', name: 'Bell' }, { glyph: '💬', name: 'Speech' }, { glyph: '🏆', name: 'Trophy' }, { glyph: '🌈', name: 'Rainbow' },
];

/** Transparent square PNG with the glyph centred at about 40% of the frame. */
export async function renderStickerFile(glyph: string, name: string, size = 1024): Promise<File> {
  const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Canvas is not available.');
  ctx.clearRect(0, 0, size, size);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `${Math.round(size * 0.4)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  ctx.fillText(glyph, size / 2, size / 2 + size * 0.03);
  return new File([await toBlob(canvas, 'image/png')], `Sticker · ${name}.png`, { type: 'image/png' });
}

export function renderedToFile(r: Rendered, name: string): File {
  return new File([encodeWav(r) as BlobPart], `${name}.wav`, { type: 'audio/wav' });
}

// ---------- shared preview player ----------
let ctx: AudioContext | null = null;
let current: { source: AudioBufferSourceNode; id: string } | null = null;
let onChange: ((id: string | null) => void) | null = null;

export function subscribePreview(fn: (id: string | null) => void): () => void { onChange = fn; return () => { if (onChange === fn) onChange = null; }; }

export function stopPreview(): void {
  if (current) { try { current.source.onended = null; current.source.stop(); } catch { /* already stopped */ } current = null; onChange?.(null); }
}

export function togglePreview(id: string, r: Rendered): void {
  if (current?.id === id) return stopPreview();
  stopPreview();
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  ctx ??= new Ctx();
  void ctx.resume();
  const buf = ctx.createBuffer(2, r.left.length, r.sampleRate || SAMPLE_RATE);
  buf.getChannelData(0).set(r.left); buf.getChannelData(1).set(r.right);
  const source = ctx.createBufferSource(); source.buffer = buf; source.connect(ctx.destination);
  source.onended = () => { if (current?.source === source) { current = null; onChange?.(null); } };
  source.start(); current = { source, id }; onChange?.(id);
}

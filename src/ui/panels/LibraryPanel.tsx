import { useEffect, useRef, useState } from 'react';
import { Disc3, Image as ImageIcon, Loader2, Music2, Pause, Play, Plus, Smile, Volume2 } from 'lucide-react';
import { useEditor } from '../../store/editor';
import { importFile } from '../../engine/media';
import { BACKDROPS, renderBackdropFile, renderedToFile, renderStickerFile, STICKERS, stopPreview, subscribePreview, togglePreview, type BackdropSpec } from '../../engine/generate';
import { SAMPLE_RATE, SFX, SONGS, type Rendered } from '../../engine/synth';

type Tab = 'music' | 'sfx' | 'backdrops' | 'stickers';
const TABS: Array<{ id: Tab; label: string; icon: typeof Music2 }> = [
  { id: 'music', label: 'Music', icon: Music2 }, { id: 'sfx', label: 'SFX', icon: Volume2 },
  { id: 'backdrops', label: 'Backdrops', icon: ImageIcon }, { id: 'stickers', label: 'Stickers', icon: Smile },
];

const cache = new Map<string, Rendered>();
/** Render on the next frame so the "busy" state paints before the synchronous synth work starts. */
const render = (id: string, fn: () => Rendered): Promise<Rendered> => new Promise((resolve) => {
  const hit = cache.get(id); if (hit) return resolve(hit);
  window.setTimeout(() => { const r = fn(); cache.set(id, r); resolve(r); }, 16);
});

function cssFor(spec: BackdropSpec): string {
  const c = spec.colors;
  if (spec.kind === 'solid') return c[0]!;
  if (spec.kind === 'linear') return `linear-gradient(${spec.angle ?? 135}deg, ${c.join(', ')})`;
  if (spec.kind === 'radial') return `radial-gradient(circle at 50% 55%, ${c.join(', ')})`;
  if (spec.kind === 'mesh') return `radial-gradient(circle at 15% 20%, ${c[1]}, transparent 60%), radial-gradient(circle at 85% 15%, ${c[2] ?? c[1]}, transparent 55%), radial-gradient(circle at 70% 90%, ${c[3] ?? c[1]}, transparent 60%), ${c[0]}`;
  if (spec.kind === 'stripes') return `repeating-linear-gradient(45deg, ${c[0]} 0 10px, ${c[1]} 10px 20px)`;
  return `linear-gradient(transparent 55%, ${c[1]}55 56%, transparent 58%), linear-gradient(${c[0]}, #2a0a45 55%, ${c[0]})`;
}

export function LibraryPanel({ initialTab = 'music' }: { initialTab?: Tab }) {
  const registerAsset = useEditor((s) => s.registerAsset);
  const addToTimeline = useEditor((s) => s.addAssetToTimeline);
  const notify = useEditor((s) => s.notify);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [busy, setBusy] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; const off = subscribePreview(setPlaying); return () => { alive.current = false; off(); stopPreview(); }; }, []);

  /** Import a generated File once (re-use if an asset with that name exists), then optionally place it. */
  const addFile = async (make: () => Promise<File> | File, name: string, options?: Parameters<typeof addToTimeline>[2]) => {
    const existing = Object.values(useEditor.getState().project().assets).find((a) => a.name === name);
    if (existing) { addToTimeline(existing.id, useEditor.getState().playhead, options); return; }
    const file = await make();
    const out = await importFile(file);
    if (!out.asset) { notify(out.error ?? `Could not add ${name}.`); return; }
    registerAsset(out.asset);
    addToTimeline(out.asset.id, useEditor.getState().playhead, options);
  };
  const run = async (key: string, job: () => Promise<void>) => {
    setBusy(key);
    try { await job(); } catch (e) { notify(e instanceof Error ? e.message : 'Could not generate that item.'); } finally { if (alive.current) setBusy(null); }
  };

  const preview = (key: string, fn: () => Rendered) => { if (playing === key) return stopPreview(); setBusy(key); void render(key, fn).then((r) => { if (alive.current) { setBusy(null); togglePreview(key, r); } }); };
  const settings = () => useEditor.getState().project().settings;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-ink-600/70 p-3">
        <span className="label">Content library</span>
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">Royalty-free music, sound effects, backdrops and stickers — generated on your device, no licences needed.</p>
        <div className="mt-2 grid grid-cols-4 gap-1" role="tablist">
          {TABS.map(({ id, label, icon: Icon }) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`flex flex-col items-center gap-1 rounded-lg border py-1.5 text-[10px] font-semibold ${tab === id ? 'border-violet-400 bg-violet-500/15 text-white' : 'border-ink-500 text-zinc-400 hover:text-zinc-100'}`}><Icon size={14} />{label}</button>)}
        </div>
        <div className="mt-2 flex gap-1.5 text-[11px]">
          <button className="flex-1 rounded-lg border border-ink-600 px-2 py-1.5 font-semibold text-zinc-300 hover:border-violet-400" onClick={() => window.dispatchEvent(new CustomEvent('f4-open-tool', { detail: 'shapes' }))}>Shapes & icons →</button>
          <button className="flex-1 rounded-lg border border-ink-600 px-2 py-1.5 font-semibold text-zinc-300 hover:border-violet-400" onClick={() => window.dispatchEvent(new CustomEvent('f4-open-tool', { detail: 'backgrounds' }))}>Gradient backdrops →</button>
        </div>
      </div>
      <div className="flex-1 space-y-1.5 overflow-y-auto p-2">
        {tab === 'music' && SONGS.map((s) => (
          <div key={s.id} className="flex items-center gap-2 rounded-lg border border-ink-600/70 p-2 hover:border-ink-400">
            <button className="btn-icon !h-9 !w-9 shrink-0" aria-label={`${playing === s.id ? 'Stop' : 'Preview'} ${s.name}`} onClick={() => preview(s.id, () => s.render(SAMPLE_RATE))}>{busy === s.id ? <Loader2 size={14} className="animate-spin" /> : playing === s.id ? <Pause size={14} /> : <Play size={14} />}</button>
            <div className="min-w-0 flex-1"><div className="truncate text-xs font-semibold text-zinc-100">{s.name}</div><div className="truncate text-[10px] text-zinc-500">{s.mood} · {s.bpm} BPM · {Math.round(s.bars * 4 * 60 / s.bpm)}s</div></div>
            <button className="btn-icon !h-9 !w-9 shrink-0" aria-label={`Add ${s.name} to timeline`} title="Add to timeline" disabled={busy === `add:${s.id}`} onClick={() => void run(`add:${s.id}`, async () => { const r = await render(s.id, () => s.render(SAMPLE_RATE)); await addFile(() => renderedToFile(r, s.name), `${s.name}.wav`); })}>{busy === `add:${s.id}` ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}</button>
          </div>
        ))}
        {tab === 'sfx' && SFX.map((s) => (
          <div key={s.id} className="flex items-center gap-2 rounded-lg border border-ink-600/70 p-2 hover:border-ink-400">
            <button className="btn-icon !h-8 !w-8 shrink-0" aria-label={`${playing === s.id ? 'Stop' : 'Preview'} ${s.name}`} onClick={() => preview(s.id, () => s.render(SAMPLE_RATE))}>{playing === s.id ? <Pause size={13} /> : <Play size={13} />}</button>
            <div className="min-w-0 flex-1"><div className="truncate text-xs font-semibold text-zinc-100">{s.name}</div><div className="truncate text-[10px] text-zinc-500">{s.hint} · {s.durationSec.toFixed(1)}s</div></div>
            <button className="btn-icon !h-8 !w-8 shrink-0" aria-label={`Add ${s.name} to timeline`} title="Add to timeline" disabled={busy === `add:${s.id}`} onClick={() => void run(`add:${s.id}`, async () => { const r = await render(s.id, () => s.render(SAMPLE_RATE)); await addFile(() => renderedToFile(r, s.name), `${s.name}.wav`); })}>{busy === `add:${s.id}` ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}</button>
          </div>
        ))}
        {tab === 'backdrops' && <div className="grid grid-cols-2 gap-2">{BACKDROPS.map((b) => (
          <button key={b.id} className="group overflow-hidden rounded-lg border border-ink-600/70 text-left hover:border-violet-400" aria-label={`Add backdrop ${b.name}`} disabled={busy === `add:${b.id}`} onClick={() => void run(`add:${b.id}`, async () => { const { width, height } = settings(); await addFile(() => renderBackdropFile(b, width, height), `Backdrop · ${b.name}.jpg`); })}>
            <div className="aspect-video w-full" style={{ background: cssFor(b) }} />
            <div className="flex items-center justify-between px-2 py-1.5 text-[11px] font-medium text-zinc-200"><span className="truncate">{b.name}</span>{busy === `add:${b.id}` ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} className="opacity-0 group-hover:opacity-100" />}</div>
          </button>))}</div>}
        {tab === 'stickers' && <div className="grid grid-cols-4 gap-1.5">{STICKERS.map((s) => (
          <button key={s.name} className="flex aspect-square items-center justify-center rounded-lg border border-ink-600/70 text-2xl hover:border-violet-400 hover:bg-violet-500/10 disabled:opacity-50" title={`Add ${s.name} sticker`} aria-label={`Add ${s.name} sticker`} disabled={busy === `add:${s.name}`} onClick={() => void run(`add:${s.name}`, () => addFile(() => renderStickerFile(s.glyph, s.name), `Sticker · ${s.name}.png`, { trackKind: 'overlay' }))}>{busy === `add:${s.name}` ? <Loader2 size={16} className="animate-spin" /> : s.glyph}</button>))}</div>}
        {tab === 'music' && <p className="flex items-center gap-1.5 px-1 pt-2 text-[10px] text-zinc-600"><Disc3 size={11} />Tracks are synthesised fresh on your device. Use Beat detect on a track to drop markers and cut to the rhythm.</p>}
      </div>
    </div>
  );
}

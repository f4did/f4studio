import { useMemo, useState } from 'react';
import { AudioLines, Blend, Check, Circle, Droplets, Flame, Gauge, Grid3x3, Heart, Layers3, Minus, MousePointer2, Plus, Rows3, Shapes, Sparkles, Star, Timer, Triangle, WandSparkles, Waves, Zap } from 'lucide-react';
import { FILTER_PRESETS, TRANSITION_PRESETS, newId, type VisualizerType } from '../../core';
import { importFile } from '../../engine/media';
import { BUNDLED_ASSETS, type BundledAsset } from '../../assets/catalog';
import { useEditor } from '../../store/editor';

function PanelShell({ title, icon: Icon, children }: { title: string; icon: typeof Sparkles; children: React.ReactNode }) {
  return <div className="flex h-full flex-col"><div className="border-b border-ink-600/70 p-3"><div className="flex items-center gap-2 text-sm font-semibold text-zinc-100"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-500/15 text-violet-300"><Icon size={15} /></span>{title}</div></div><div className="min-h-0 flex-1 overflow-y-auto p-3">{children}</div></div>;
}

function PresetGrid({ items, active, onPick }: { items: Array<{ id: string; name: string; category?: string }>; active?: string; onPick: (id: string) => void }) {
  const previewColors = ['#4f46e5,#06b6d4', '#ec4899,#8b5cf6', '#f59e0b,#ef4444', '#22c55e,#14b8a6', '#64748b,#e2e8f0', '#7c3aed,#db2777'];
  return <div className="creative-preset-grid grid grid-cols-2 gap-2">{items.map((item, index) => <button key={item.id} className={`creative-preset group rounded-xl border p-2 text-left transition-all ${active === item.id ? 'is-active border-violet-400 bg-violet-500/15 shadow-lg shadow-violet-950/30' : 'border-ink-600 bg-ink-800 hover:border-violet-500/70 hover:bg-ink-700'}`} onClick={() => onPick(item.id)}><div className="creative-preset-preview mb-2 h-12 rounded-lg opacity-85 transition-opacity group-hover:opacity-100" style={{ background: `linear-gradient(135deg,${previewColors[index % previewColors.length]})` }}><span /></div><div className="flex items-center gap-1 text-[11px] font-semibold text-zinc-200">{active === item.id && <Check size={11} className="text-violet-300" />}{item.name}</div>{item.category && <div className="mt-1 text-[9px] uppercase tracking-wider text-zinc-600">{item.category}</div>}</button>)}</div>;
}

export function TransitionsPanel() {
  const selected = useEditor((s) => s.selection.length === 1 ? s.history.present.clips[s.selection[0]!] : undefined);
  const patch = useEditor((s) => s.patchClip);
  const [mode, setMode] = useState<'intro' | 'outro' | 'both'>('intro');
  const grouped = useMemo(() => TRANSITION_PRESETS.reduce<Record<string, typeof TRANSITION_PRESETS>>((acc, item) => { (acc[item.category] ??= []).push(item); return acc; }, {}), []);
  const applyTransition = (id: string) => {
    if (!selected) return;
    const preset = TRANSITION_PRESETS.find((item) => item.id === id);
    if (!preset) return;
    patch(selected.id, { transitionIn: { id: selected.transitionIn?.id ?? newId('trn'), type: id, durationFrames: selected.transitionIn?.durationFrames ?? 18, direction: preset.direction, intensity: selected.transitionIn?.intensity ?? 1, params: { mode } } });
  };
  return <PanelShell title="Transitions" icon={WandSparkles}><div className="mb-3"><div className="label mb-2">Flow</div><div className="flex rounded-2xl border border-ink-600 bg-ink-900 p-1">{(['intro', 'outro', 'both'] as const).map((item) => <button key={item} className={`flex-1 rounded-xl px-2 py-2 text-[11px] font-semibold capitalize ${mode === item ? 'bg-ink-700 text-zinc-100 shadow' : 'text-zinc-500 hover:text-zinc-200'}`} onClick={() => setMode(item)}>{item}</button>)}</div></div><label className="mb-4 block text-[10px] font-medium uppercase tracking-wider text-zinc-500">Duration <span className="float-right font-mono text-zinc-300">{((selected?.transitionIn?.durationFrames ?? 18) / 30).toFixed(1)}s</span><input className="mt-2 w-full accent-violet-500" type="range" min="3" max="90" value={selected?.transitionIn?.durationFrames ?? 18} onChange={(event) => selected && patch(selected.id, { transitionIn: { ...(selected.transitionIn ?? { id: newId('trn'), type: 'cross-dissolve', direction: 'none', intensity: 1, params: {} }), durationFrames: Number(event.target.value) } })} /></label>{Object.entries(grouped).map(([category, items]) => <section key={category} className="mb-5"><div className="label mb-2">{category}</div><div className="transition-grid grid w-full grid-cols-2 gap-3">{items.map((item) => <button key={item.id} disabled={!selected} className={`creative-preset transition-tile group rounded-xl border p-2 text-left transition-all ${selected?.transitionIn?.type === item.id ? 'is-active border-violet-400 bg-violet-500/15 shadow-lg shadow-violet-950/30' : 'border-ink-600 bg-ink-800 hover:border-violet-500/70 hover:bg-ink-700'}`} onClick={() => applyTransition(item.id)}><span className={`transition-preview transition-${item.id}`}><i /></span><span className="transition-card-copy"><span className="transition-card-title">{item.name.replace('Fade through ', 'Fade ').replace('Cross dissolve', 'None')}</span></span></button>)}</div></section>)}{!selected && <div className="mt-6 text-center text-[11px] text-zinc-600"><MousePointer2 size={18} className="mx-auto mb-2" />Select a clip to apply a transition.</div>}</PanelShell>;
}

export function EffectsPanel() {
  const selected = useEditor((s) => s.selection.length === 1 ? s.history.present.clips[s.selection[0]!] : undefined);
  const patch = useEditor((s) => s.patchClip);
  const pick = (id: string) => {
    if (!selected) return;
    const preset = FILTER_PRESETS.find((item) => item.id === id);
    if (!preset) return;
    patch(selected.id, { effects: Object.entries(preset.params).map(([type, value]) => ({ id: newId('fx'), type, enabled: true, intensity: 1, params: { value } })) });
  };
  return <PanelShell title="Effects" icon={Sparkles}><div className="effect-tool-strip mb-4 grid grid-cols-3 gap-2"><div className="effect-tool-card"><Zap size={16} /><span>Glitch</span><small>Digital</small></div><div className="effect-tool-card"><Droplets size={16} /><span>Blur</span><small>Focus</small></div><div className="effect-tool-card"><Flame size={16} /><span>Light</span><small>Glow</small></div></div><div className="mb-3 flex items-end justify-between"><div><div className="label">Looks & filters</div><p className="mt-1 text-[10px] text-zinc-500">Apply a stack to the selected visual clip.</p></div><span className="rounded-full border border-ink-600 px-2 py-1 text-[9px] uppercase tracking-wider text-zinc-500">{FILTER_PRESETS.length} presets</span></div><PresetGrid items={FILTER_PRESETS} onPick={pick} />{!selected && <div className="mt-6 rounded-xl border border-dashed border-ink-600 p-4 text-center text-[11px] text-zinc-600">Select a video or image clip to apply effects.</div>}</PanelShell>;
}

export function BackgroundsPanel() {
  const settings = useEditor((s) => s.history.present.settings);
  const apply = useEditor((s) => s.apply);
  const registerAsset = useEditor((s) => s.registerAsset);
  const addAssetToTimeline = useEditor((s) => s.addAssetToTimeline);
  const notify = useEditor((s) => s.notify);
  const [libraryBusy, setLibraryBusy] = useState<string | null>(null);
  const setBackground = (patch: Partial<NonNullable<typeof settings.background>>) => apply((p) => ({ ok: true, project: { ...p, settings: { ...p.settings, background: { ...(p.settings.background ?? { type: 'solid', from: '#000000', to: '#160b2b', angle: 135, opacity: 1 }), ...patch }, backgroundColor: patch.from ?? p.settings.backgroundColor }, updatedAt: Date.now() } }));
  const bg = settings.background ?? { type: 'solid' as const, from: settings.backgroundColor, to: '#160b2b', angle: 135, opacity: 1 };
  const library = BUNDLED_ASSETS.filter((item) => item.kind === 'image' || item.kind === 'video');
  const addLibraryBackground = async (item: BundledAsset) => {
    const current = useEditor.getState().project();
    const existing = Object.values(current.assets).find((asset) => asset.name === `Backdrop · ${item.name.replace(/\.[^.]+$/, '')}`);
    if (existing) { addAssetToTimeline(existing.id); return; }
    setLibraryBusy(item.id);
    try {
      const response = await fetch(item.url);
      if (!response.ok) throw new Error(`Could not load ${item.name}.`);
      const file = new File([await response.blob()], item.name, { type: item.mimeType });
      const result = await importFile(file);
      if (!result.asset) { notify(result.error ?? `Could not import ${item.name}.`); return; }
      const asset = { ...result.asset, name: `Backdrop · ${item.name.replace(/\.[^.]+$/, '')}` };
      registerAsset(asset);
      addAssetToTimeline(asset.id);
      notify(`${asset.name} added to a new lower layer.`);
    } catch (error) { notify(error instanceof Error ? error.message : `Could not load ${item.name}.`); }
    finally { setLibraryBusy(null); }
  };
  const backgrounds = [{ name: 'Aurora', type: 'linear' as const, from: '#7c3aed', to: '#22d3ee', style: 'linear-gradient(135deg,#7c3aed,#ec4899 52%,#22d3ee)' }, { name: 'Flow gradient', type: 'linear' as const, from: '#f97316', to: '#8b5cf6', style: 'linear-gradient(135deg,#f97316,#ec4899,#8b5cf6)' }, { name: 'Plasma', type: 'radial' as const, from: '#2563eb', to: '#facc15', style: 'radial-gradient(circle at 25% 20%,#2563eb,#ec4899 55%,#facc15)' }, { name: 'Starfield', type: 'radial' as const, from: '#0b1026', to: '#312e81', style: 'radial-gradient(circle at 70% 25%,#6366f1 0 1px,transparent 2px),linear-gradient(135deg,#050816,#312e81)' }, { name: 'Synthwave grid', type: 'linear' as const, from: '#1e1b4b', to: '#22d3ee', style: 'linear-gradient(135deg,#1e1b4b,#be185d 55%,#22d3ee)' }];
  const addGeneratedBackground = async (name: string, from: string, to: string, type: 'solid' | 'linear' | 'radial') => {
    try {
      // Rasterize generated backgrounds before importing them. FFmpeg's browser
      // build handles PNG/JPEG inputs consistently; SVG inputs are not reliable
      // across browsers and were the reason generated colors disappeared on export.
      const canvas = document.createElement('canvas');
      canvas.width = 1920;
      canvas.height = 1080;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas rendering is unavailable in this browser.');
      if (type === 'solid') context.fillStyle = from;
      else if (type === 'radial') {
        const gradient = context.createRadialGradient(580, 280, 0, 1120, 760, 1550);
        gradient.addColorStop(0, from);
        gradient.addColorStop(1, to);
        context.fillStyle = gradient;
      } else {
        const gradient = context.createLinearGradient(0, 0, 1920, 1080);
        gradient.addColorStop(0, from);
        gradient.addColorStop(1, to);
        context.fillStyle = gradient;
      }
      context.fillRect(0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Could not rasterize background.')), 'image/png'));
      const result = await importFile(new File([blob], `background-${name}.png`, { type: 'image/png' }));
      if (!result.asset) return notify(result.error ?? 'Could not create background layer.');
      const asset = { ...result.asset, name: `Backdrop · ${name}` };
      registerAsset(asset);
      addAssetToTimeline(asset.id);
      notify(`${asset.name} added to the timeline.`);
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not create background layer.'); }
  };
  const chooseGenerated = (preset: { name: string; type: 'linear' | 'radial'; from: string; to: string }) => { setBackground({ type: preset.type, from: preset.from, to: preset.to }); void addGeneratedBackground(preset.name, preset.from, preset.to, preset.type); };
  const chooseSolid = (color: string) => { setBackground({ type: 'solid', from: color, to: color }); void addGeneratedBackground(`Color ${color}`, color, color, 'solid'); };
  return <PanelShell title="Backdrops" icon={Layers3}><div className="background-hero mb-5 rounded-2xl border p-4"><div className="flex items-center gap-2 text-sm font-semibold text-zinc-100"><Blend size={17} className="text-cyan-300" />Canvas atmosphere</div><p className="mt-2 max-w-[230px] text-[10px] leading-relaxed text-zinc-500">Build the layer behind every clip, overlay and text element.</p><div className="background-hero-glow mt-4 h-12 rounded-lg" /></div><div className="mb-3 flex items-center justify-between"><div className="label">Backdrop library</div><span className="text-[9px] uppercase tracking-wider text-zinc-600">Click + to add a layer</span></div><div className="grid grid-cols-2 gap-2">{library.map((item) => <div key={item.id} className="background-preset group rounded-xl border border-ink-600 p-2 text-left"><div className="relative background-preset-art h-16 rounded-lg" style={{ backgroundImage: `url(${item.url})`, backgroundSize: 'cover', backgroundPosition: 'center' }}><button type="button" aria-label={`Add ${item.name} to timeline`} title="Add to timeline as a new backdrop layer" className="background-add absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/70 text-white shadow-lg backdrop-blur hover:bg-violet-600 disabled:opacity-60" disabled={libraryBusy === item.id} onClick={() => void addLibraryBackground(item)}>{libraryBusy === item.id ? <span className="text-[10px]">…</span> : <Plus size={16} />}</button></div><span className="mt-2 block truncate text-[11px] font-semibold text-zinc-200">{item.name.replace(/\.[^.]+$/, '')}</span><span className="text-[9px] uppercase tracking-wider text-zinc-600">{item.kind}</span></div>)}</div><div className="mb-3 mt-6 flex items-center justify-between"><div className="label">Generated canvas</div><span className="text-[9px] uppercase tracking-wider text-zinc-600">Live + timeline</span></div><div className="grid grid-cols-2 gap-2">{backgrounds.map((preset) => <button key={preset.name} className="background-preset group rounded-xl border border-ink-600 p-2 text-left hover:border-violet-400" onClick={() => chooseGenerated(preset)}><div className="background-preset-art h-16 rounded-lg" style={{ background: preset.style }} /><span className="mt-2 block text-[11px] font-semibold text-zinc-200">{preset.name}</span></button>)}</div><div className="label mb-2 mt-6">Mode</div><div className="mb-4 grid grid-cols-3 gap-2">{(['solid', 'linear', 'radial'] as const).map((type) => <button key={type} className={`rounded-lg border p-2 text-[10px] capitalize ${bg.type === type ? 'border-violet-400 bg-violet-500/15 text-violet-200' : 'border-ink-600 bg-ink-800 text-zinc-500 hover:border-violet-500'}`} onClick={() => setBackground({ type })}>{type}</button>)}</div><div className="grid grid-cols-2 gap-3"><label className="label">From<input className="field mt-1 h-9 p-1" type="color" value={bg.from} onChange={(e) => setBackground({ from: e.target.value })} /></label><label className="label">To<input className="field mt-1 h-9 p-1" type="color" value={bg.to} onChange={(e) => setBackground({ to: e.target.value })} /></label></div><label className="label mt-4 block">Angle <span className="font-mono text-zinc-400">{bg.angle}°</span><input className="mt-2 w-full accent-violet-500" type="range" min="0" max="360" value={bg.angle} onChange={(e) => setBackground({ angle: Number(e.target.value) })} /></label><label className="label mt-4 block">Opacity <span className="font-mono text-zinc-400">{Math.round(bg.opacity * 100)}%</span><input className="mt-2 w-full accent-violet-500" type="range" min="0" max="1" step="0.01" value={bg.opacity} onChange={(e) => setBackground({ opacity: Number(e.target.value) })} /></label><div className="label mb-2 mt-6">Solid colors · add to timeline</div><div className="grid grid-cols-6 gap-2">{['#000000', '#ffffff', '#0f172a', '#7c3aed', '#ec4899', '#22d3ee', '#f97316', '#22c55e', '#facc15', '#ef4444', '#3b82f6', '#111827'].map((color) => <button key={color} className="aspect-square rounded-lg border border-ink-600 shadow-inner transition-transform hover:scale-110" style={{ background: color }} title={`Add ${color} backdrop to timeline`} onClick={() => chooseSolid(color)} />)}</div><p className="mt-5 text-[10px] leading-relaxed text-zinc-600">Every library, gradient, and color backdrop is added as an editable timeline layer.</p></PanelShell>;
}

const SHAPES = [
  { label: 'Rectangle', value: '▰', icon: SquareIcon, color: '#22d3ee' },
  { label: 'Circle', value: '●', icon: Circle, color: '#22d3ee' },
  { label: 'Triangle', value: '▲', icon: Triangle, color: '#22d3ee' },
  { label: 'Star', value: '★', icon: Star, color: '#22d3ee' },
  { label: 'Heart', value: '♥', icon: Heart, color: '#22d3ee' },
  { label: 'Line', value: '━', icon: Waves, color: '#22d3ee' },
] as const;
const STICKERS = ['🔥', '✨', '💥', '⚡', '🎬', '🎧', '🎵', '💜', '🌈', '🚀', '👑', '💎', '🌙', '☀️', '🎉', '⭐', '👀', '💯'];

function SquareIcon({ size = 18 }: { size?: number }) { return <span style={{ width: size, height: size, border: '2px solid currentColor', borderRadius: 3 }} />; }

export function ShapesPanel() {
  const addText = useEditor((s) => s.addText);
  const patch = useEditor((s) => s.patchClip);
  const shapeColor = '#22d3ee';
  const addDesign = (value: string, label: string, color = '#22d3ee') => {
    addText(value);
    const id = useEditor.getState().selection[0];
    const clip = id ? useEditor.getState().project().clips[id] : undefined;
    if (id && clip?.text) patch(id, { name: label, text: { ...clip.text, style: { ...clip.text.style, fontFamily: 'Arial Black, sans-serif', fontSize: 150, fontWeight: 900, color: shapeColor || color, outline: { color: shapeColor || color, width: 2 }, align: 'center', shadow: { color: shapeColor || color, blur: 18, offsetX: 0, offsetY: 3 } } } });
  };
  return <PanelShell title="Shapes & stickers" icon={Shapes}><div className="label mb-3">Shapes</div><div className="grid grid-cols-3 gap-2">{SHAPES.map(({ label, value, icon: Icon, color }) => <button key={label} className="group flex min-h-[84px] flex-col items-center justify-between rounded-2xl border border-ink-600 bg-ink-800 p-3 text-center hover:border-cyan-300 hover:bg-cyan-500/10" onClick={() => addDesign(value, label, color)}><Icon size={22} className="text-cyan-300 transition-transform group-hover:scale-110" /><span className="text-[10px] font-semibold text-zinc-300">{label}</span></button>)}</div><div className="label mb-3 mt-6">Stickers</div><div className="grid grid-cols-3 gap-2">{STICKERS.map((sticker) => <button key={sticker} className="flex min-h-[72px] items-center justify-center rounded-2xl border border-ink-600 bg-ink-800 text-2xl transition-transform hover:-translate-y-0.5 hover:border-fuchsia-300" onClick={() => addDesign(sticker, `Sticker ${sticker}`, '#f472b6')}>{sticker}</button>)}</div><p className="mt-5 text-[10px] leading-relaxed text-zinc-500">Add an editable shape or sticker, then resize, rotate, animate, and export it like any other design.</p></PanelShell>;
}

const VISUALIZER_CARDS: Array<{ type: VisualizerType; label: string; icon: typeof Waves }> = [
  { type: 'dotline', label: 'Lofi dotted spikes', icon: Waves },
  { type: 'roundbars', label: 'Round bars + peaks', icon: AudioLines },
  { type: 'dotmatrix', label: 'LED dot matrix', icon: Grid3x3 },
  { type: 'ripple', label: 'Bass ripples', icon: Circle },
  { type: 'linewave', label: 'Minimal line wave', icon: Waves },
  { type: 'spectrum', label: 'Digital bars', icon: Gauge },
  { type: 'radial', label: 'Cardiac ring', icon: Circle },
  { type: 'heartbeat', label: 'Heartbeat', icon: Waves },
  { type: 'oscilloscope', label: 'Waveform', icon: Waves },
  { type: 'orbit', label: 'Orbit dots', icon: Sparkles },
];
const PROGRESS_CARDS: Array<{ type: VisualizerType; label: string; icon: typeof Waves }> = [
  { type: 'framepulse', label: 'Frame border', icon: Layers3 },
  { type: 'progressline', label: 'Line + knob', icon: Minus },
  { type: 'progresssegments', label: 'Segmented pill', icon: Rows3 },
  { type: 'progressring', label: 'Ring + percent', icon: Timer },
  { type: 'countdown', label: 'Progress halo', icon: Timer },
];

function VisualizerCard({ type, label, icon: Icon, onAdd }: { type: VisualizerType; label: string; icon: typeof Waves; onAdd: (type: VisualizerType) => void }) {
  return <button className="rounded-lg border border-ink-600 bg-ink-800 p-2 text-left hover:border-violet-500" onClick={() => onAdd(type)}><div className="mb-2 flex h-10 items-center justify-center rounded bg-[radial-gradient(circle,rgba(139,109,255,.28),transparent_65%),#09090b]"><Icon size={19} className="text-violet-300" /></div><div className="text-[10px] text-zinc-300">{label}</div></button>;
}

export function VisualizerTemplates({ onAdd }: { onAdd: (type: VisualizerType) => void }) {
  return (
    <div>
      <div className="label mb-2 mt-3">Audio visualizers</div>
      <div className="grid grid-cols-2 gap-2">{VISUALIZER_CARDS.map((card) => <VisualizerCard key={card.type} {...card} onAdd={onAdd} />)}</div>
      <div className="label mb-2 mt-4">Progress bars</div>
      <div className="grid grid-cols-2 gap-2">{PROGRESS_CARDS.map((card) => <VisualizerCard key={card.type} {...card} onAdd={onAdd} />)}</div>
    </div>
  );
}

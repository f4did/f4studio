import { useEffect, useRef, useState } from 'react';
import { Activity, AudioWaveform, Film, Image as ImageIcon, Music, PanelsTopLeft, Plus, ScanSearch, Upload, Waves } from 'lucide-react';
import { useEditor } from '../../store/editor';
import { importFile, thumbnailFor } from '../../engine/media';
import { formatTimecode, secondsToFrames, type Asset } from '../../core';
import { beatTimesFor, silenceRegionsFor } from '../../engine/waveform';
import { sceneCutsFor } from '../../engine/analysis';
import { VisualizerTemplates } from './CreativePanels';
import { BUNDLED_ASSETS, type BundledAsset } from '../../assets/catalog';

const KIND_ICON = { video: Film, image: ImageIcon, audio: Music } as const;

function AssetThumbnail({ asset }: { asset: Asset }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void thumbnailFor(asset).then((value) => { if (active) setSrc(value); });
    return () => { active = false; };
  }, [asset]);
  if (src) return <img src={src} alt="" className="h-10 w-16 shrink-0 rounded object-cover" />;
  const Icon = KIND_ICON[asset.kind];
  return <div className="flex h-10 w-16 shrink-0 items-center justify-center rounded bg-ink-700"><Icon size={16} className="text-violet-400" /></div>;
}

export function BundledAssetShelf({ kind }: { kind: 'audio' | 'image' }) {
  const registerAsset = useEditor((s) => s.registerAsset);
  const notify = useEditor((s) => s.notify);
  const [busy, setBusy] = useState<string | null>(null);
  const items = BUNDLED_ASSETS.filter((item) => item.kind === kind);
  const names: Record<string, string> = {
    '1.mp3': 'Midnight Drive', '2.mp3': 'Neon Pulse', '3.mp3': 'Golden Hour', '4.mp3': 'Afterglow',
    '5.mp3': 'Ocean Lights', '6.mp3': 'Slow Motion', '7.mp3': 'Dream Sequence', '8.mp3': 'City Rain',
    '9.mp3': 'Velvet Night', '10.mp3': 'Electric Heart', '11.mp3': 'Cinematic Rise', '12.mp3': 'Soft Focus', '13.mp3': 'Last Light',
  };
  const addToTimeline = useEditor((s) => s.addAssetToTimeline);
  const add = async (item: BundledAsset, place = false) => {
    const existing = Object.values(useEditor.getState().project().assets).find((asset) => asset.name === (names[item.name] ?? item.name.replace(/\.[^.]+$/, '')));
    if (existing) { if (place) addToTimeline(existing.id); else notify(`${existing.name} is already in your media bin.`); return; }
    setBusy(item.id);
    try {
      const response = await fetch(item.url);
      if (!response.ok) throw new Error(`Could not load ${item.name}.`);
      const file = new File([await response.blob()], item.name, { type: item.mimeType });
      const result = await importFile(file);
      if (result.asset) {
        const asset = { ...result.asset, name: kind === 'audio' ? (names[item.name] ?? item.name.replace(/\.[^.]+$/, '')) : `Backdrop · ${item.name.replace(/\.[^.]+$/, '')}` };
        registerAsset(asset);
        if (place) addToTimeline(asset.id);
      }
      else notify(result.error ?? `Could not import ${item.name}.`);
    } catch (error) { notify(error instanceof Error ? error.message : `Could not import ${item.name}.`); }
    finally { setBusy(null); }
  };
  return <section className="mb-3 rounded-xl border border-violet-400/20 bg-violet-500/[0.06] p-3"><div className="mb-2 flex items-center justify-between"><div><div className="text-xs font-semibold text-zinc-100">{kind === 'audio' ? 'Starter audio' : 'Backdrop library'}</div><div className="text-[10px] text-zinc-500">{kind === 'audio' ? 'Ready-to-edit music beds' : 'Photo backdrops included with F4'}</div></div><span className="rounded-full bg-violet-500/15 px-2 py-1 text-[9px] text-violet-200">{items.length}</span></div><div className="grid grid-cols-2 gap-1.5">{items.map((item) => <div key={item.id} className="group relative min-w-0 overflow-hidden rounded border border-ink-600 bg-ink-900/80 text-left hover:border-violet-400/70"><button type="button" className="block w-full text-left" onClick={() => void add(item)} disabled={busy === item.id} title={`Import ${item.name}`}><span className={`relative flex h-16 w-full items-center justify-center overflow-hidden ${kind === 'audio' ? 'bg-[linear-gradient(135deg,rgba(34,211,238,.2),rgba(124,58,237,.18)),#09090b] text-cyan-300' : 'bg-ink-700'}`}>{kind === 'audio' ? <><Music size={16} /><span className="absolute inset-x-2 bottom-2 flex items-end gap-0.5 opacity-60">{Array.from({ length: 16 }, (_, index) => <i key={index} className="h-2 flex-1 rounded-full bg-cyan-300" style={{ height: `${4 + ((index * 7) % 13)}px` }} />)}</span></> : <img src={item.url} alt={item.name} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />}</span><span className="block truncate px-1.5 py-1.5 text-[10px] text-zinc-300">{busy === item.id ? 'Adding…' : kind === 'audio' ? (names[item.name] ?? item.name) : `Backdrop ${item.name.replace(/\.[^.]+$/, '')}`}</span></button>{kind === 'audio' && <button type="button" className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-violet-600 text-white shadow-lg hover:bg-violet-500 disabled:opacity-60" aria-label={`Add ${item.name} to timeline`} title="Add directly to timeline" disabled={busy === item.id} onClick={(event) => { event.stopPropagation(); void add(item, true); }}><Plus size={14} /></button>}</div>)}</div></section>;
}

export function MediaPanel({ showVisualizer = false, bundledKind }: { showVisualizer?: boolean; bundledKind?: 'audio' | 'image' }) {
  const project = useEditor((s) => s.history.present);
  const registerAsset = useEditor((s) => s.registerAsset);
  const addToTimeline = useEditor((s) => s.addAssetToTimeline);
  const notify = useEditor((s) => s.notify);
  const addVisualizer = useEditor((s) => s.addVisualizer);
  const placeMarkers = useEditor((s) => s.placeMarkers);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [analysing, setAnalysing] = useState<string | null>(null);

  useEffect(() => {
    const openImport = () => input.current?.click();
    window.addEventListener('f4-open-import', openImport);
    return () => window.removeEventListener('f4-open-import', openImport);
  }, []);

  const detectSilence = async (asset: Asset) => {
    const clips = Object.values(useEditor.getState().project().clips).filter((clip) => clip.kind === 'audio' && clip.assetId === asset.id);
    if (!clips.length) return notify('Add this audio asset to the timeline before detecting silence.');
    setAnalysing(asset.id);
    try {
      const regions = await silenceRegionsFor(asset);
      const fps = useEditor.getState().project().settings.fps;
      const frames: number[] = [];
      for (const clip of clips) {
        for (const region of regions) {
          const start = Math.max(0, Math.round(region.startSec * fps));
          const end = Math.min(clip.duration, Math.round(region.endSec * fps));
          if (end > start) frames.push(clip.start + start, clip.start + end);
        }
      }
      if (frames.length) placeMarkers(frames, 'Silence');
      notify(regions.length ? `Detected ${regions.length} silent region${regions.length === 1 ? '' : 's'}.` : 'No sustained silence was detected.');
    } finally {
      setAnalysing(null);
    }
  };

  const detectBeats = async (asset: Asset) => {
    const clips = Object.values(useEditor.getState().project().clips).filter((clip) => clip.kind === 'audio' && clip.assetId === asset.id);
    if (!clips.length) return notify('Add this audio asset to the timeline before detecting beats.');
    setAnalysing(`${asset.id}:beats`);
    try {
      const beats = await beatTimesFor(asset);
      const fps = useEditor.getState().project().settings.fps;
      const frames: number[] = [];
      for (const clip of clips) for (const time of beats) {
        const frame = Math.round(time * fps);
        if (frame >= 0 && frame < clip.duration) frames.push(clip.start + frame);
      }
      if (frames.length) placeMarkers(frames, 'Beat', '#22d3ee');
      notify(beats.length ? `Detected ${beats.length} beat marker${beats.length === 1 ? '' : 's'}.` : 'No clear beats were detected.');
    } finally {
      setAnalysing(null);
    }
  };

  const detectScenes = async (asset: Asset) => {
    const clips = Object.values(useEditor.getState().project().clips).filter((clip) => clip.kind === 'video' && clip.assetId === asset.id);
    if (!clips.length) return notify('Add this video asset to the timeline before detecting scenes.');
    setAnalysing(`${asset.id}:scenes`);
    try {
      const cuts = await sceneCutsFor(asset);
      const fps = useEditor.getState().project().settings.fps;
      const frames: number[] = [];
      for (const clip of clips) for (const time of cuts) {
        const frame = Math.round(time * fps);
        if (frame >= 0 && frame < clip.duration) frames.push(clip.start + frame);
      }
      if (frames.length) placeMarkers(frames, 'Scene', '#fbbf24');
      notify(cuts.length ? `Detected ${cuts.length} scene cut${cuts.length === 1 ? '' : 's'}.` : 'No strong scene cuts were detected.');
    } finally {
      setAnalysing(null);
    }
  };

  const previewSfx = (name: string) => {
    const AudioContextCtor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return notify('This browser does not support generated sound previews.');
    const ctx = new AudioContextCtor();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    const presets: Record<string, [number, number]> = { Whoosh: [220, 880], Boom: [90, 48], Click: [1100, 780], Riser: [180, 1400], Laser: [900, 140], Pop: [420, 720] };
    const [from, to] = presets[name] ?? [440, 660];
    osc.type = name === 'Boom' ? 'sine' : name === 'Click' ? 'square' : 'sawtooth';
    osc.frequency.setValueAtTime(from, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), now + (name === 'Click' ? .08 : .42));
    gain.gain.setValueAtTime(.0001, now);
    gain.gain.exponentialRampToValueAtTime(.18, now + .015);
    gain.gain.exponentialRampToValueAtTime(.0001, now + (name === 'Click' ? .12 : .5));
    osc.connect(gain).connect(ctx.destination); osc.start(now); osc.stop(now + (name === 'Click' ? .14 : .52));
    window.setTimeout(() => void ctx.close().catch(() => undefined), 700);
    notify(`Previewing ${name} SFX.`);
  };

  const handleFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    setBusy((n) => n + list.length);
    const errs: string[] = [];
    for (const f of list) {
      const r = await importFile(f);
      if (r.asset) registerAsset(r.asset);
      else errs.push(`${r.fileName}: ${r.error}`);
      setBusy((n) => n - 1);
    }
    setErrors(errs);
    if (errs.length) notify(`${errs.length} file(s) could not be imported.`);
  };

  const assets = Object.values(project.assets).sort((a, b) => b.addedAt - a.addedAt);

  return (
    <div className="flex h-full flex-col" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void handleFiles(e.dataTransfer.files); }}>
      <div className="flex flex-col gap-3 border-b border-ink-600/70 p-3">
        <span className="label">Your media</span>
        <button className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-3 text-xs font-semibold text-white hover:bg-violet-500" onClick={() => input.current?.click()}>
          <Upload size={14} /> Import media
        </button>
        {showVisualizer && <button className="btn-icon" aria-label="Add audio visualizer" title="Add audio visualizer" onClick={() => addVisualizer('spectrum')}><AudioWaveform size={14} /></button>}
        <input ref={input} type="file" multiple accept="video/*,image/*,audio/*" className="hidden" onChange={(e) => { if (e.target.files) void handleFiles(e.target.files); e.target.value = ''; }} />
      </div>
      {busy > 0 && <div className="px-3 py-2 text-xs text-violet-300" role="status">Importing {busy} file(s)…</div>}
      {errors.length > 0 && (
        <ul className="m-2 space-y-1 rounded border border-red-500/30 bg-red-500/10 p-2 text-[11px] text-red-300" role="alert">
          {errors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}
      <div className="flex-1 overflow-y-auto p-2">
        {showVisualizer && <section className="mb-3 rounded-xl border border-cyan-400/20 bg-[linear-gradient(135deg,rgba(34,211,238,0.1),rgba(124,58,237,0.1))] p-3"><div className="mb-1 text-xs font-semibold text-zinc-100">Audio visualizer lab</div><p className="text-[10px] leading-relaxed text-zinc-500">Add a reactive layer over photos or video. It stays on the timeline until the project end and uses the imported song’s analyser.</p><VisualizerTemplates onAdd={addVisualizer} /></section>}
        {showVisualizer && <section className="mb-3 rounded-xl border border-fuchsia-400/20 bg-fuchsia-500/[0.05] p-3"><div className="mb-2 flex items-center gap-2 text-xs font-semibold text-zinc-100"><Waves size={14} className="text-fuchsia-300" />SFX lab · generated live</div><div className="grid grid-cols-3 gap-1.5">{['Whoosh', 'Boom', 'Click', 'Riser', 'Laser', 'Pop'].map((name) => <button key={name} className="rounded-xl border border-ink-600 bg-ink-800 px-1 py-3 text-[10px] text-zinc-300 hover:border-fuchsia-300 hover:text-white" onClick={() => previewSfx(name)}><AudioWaveform size={14} className="mx-auto mb-1 text-fuchsia-300" />{name}</button>)}</div></section>}
        {bundledKind && <BundledAssetShelf kind={bundledKind} />}
        {assets.length === 0 ? (
          <div className="m-2 mt-6 flex flex-col items-center gap-2 rounded-xl border border-dashed border-ink-500 px-4 py-10 text-center text-zinc-500">
            <Upload size={22} />
            <p className="text-xs">Drop video, image or audio files here, or use Import.</p>
          </div>
        ) : (
          <ul className="space-y-1">
            {assets.map((a) => {
              return (
                <li key={a.id} className="group flex items-center gap-2 rounded border border-transparent p-2 hover:border-ink-500 hover:bg-ink-700">
                  <AssetThumbnail asset={a} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs text-zinc-100" title={a.name}>{a.name}</div>
                    <div className="text-[10px] text-zinc-500">
                      {a.kind === 'image' ? 'Image' : formatTimecode(secondsToFrames(a.durationSec, project.settings.fps), project.settings.fps)}
                      {a.width ? ` · ${a.width}×${a.height}` : ''}
                    </div>
                  </div>
                  {a.kind === 'audio' && <button className="btn-icon opacity-0 group-hover:opacity-100 focus:opacity-100" aria-label={`Detect silence in ${a.name}`} title="Detect silence and place timeline markers" disabled={analysing === a.id} onClick={() => void detectSilence(a)}>
                    {analysing === a.id ? <span className="text-[10px]">…</span> : <ScanSearch size={14} />}
                  </button>}
                  {a.kind === 'audio' && <button className="btn-icon opacity-0 group-hover:opacity-100 focus:opacity-100" aria-label={`Detect beats in ${a.name}`} title="Detect beats and place timeline markers" disabled={analysing === `${a.id}:beats`} onClick={() => void detectBeats(a)}>
                    {analysing === `${a.id}:beats` ? <span className="text-[10px]">…</span> : <Activity size={14} />}
                  </button>}
                  {a.kind === 'video' && <button className="btn-icon opacity-0 group-hover:opacity-100 focus:opacity-100" aria-label={`Detect scenes in ${a.name}`} title="Detect scene cuts and place timeline markers" disabled={analysing === `${a.id}:scenes`} onClick={() => void detectScenes(a)}>
                    {analysing === `${a.id}:scenes` ? <span className="text-[10px]">…</span> : <PanelsTopLeft size={14} />}
                  </button>}
                  <button className="btn-icon opacity-0 group-hover:opacity-100 focus:opacity-100" aria-label={`Add ${a.name} to timeline`} title="Add to timeline" onClick={() => addToTimeline(a.id)}>
                    <Plus size={14} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

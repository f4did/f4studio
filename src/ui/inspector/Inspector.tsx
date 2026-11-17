import { useRef, useState } from 'react';
import { AudioLines, GripVertical, Loader2, Scissors, SlidersHorizontal, Volume2, VolumeX } from 'lucide-react';
import { autoCutSilence, DEFAULT_AUTOCUT } from '../../engine/smart';
import { animationRef, clipEnd, isProgressVisualizer, effectsForFilter, FILTER_PRESETS, formatTimecode, newId, setKeyframe, TEXT_ANIMATION_PRESETS, TRANSITION_PRESETS, type Clip, type EffectInstance, type TransitionRef } from '../../core';
import { cssFontFamily, FONT_CATALOG, loadFontFile } from '../../core/fonts';
import { useEditor } from '../../store/editor';

import { Slider } from '../common/Slider';
import { AudioLab, MotionSection, TimingSection } from './ClipTools';

const pct = (v: number) => `${Math.round(v * 100)}%`;
const db = (v: number) => (v <= 0.0001 ? '-∞ dB' : `${(20 * Math.log10(v)).toFixed(1)} dB`);
let effectClipboard: EffectInstance[] = [];

function AutoCutSection({ clipId }: { clipId: string }) {
  const notify = useEditor((s) => s.notify);
  const [busy, setBusy] = useState(false);
  const [thresholdDb, setThresholdDb] = useState(DEFAULT_AUTOCUT.thresholdDb);
  const [minSilenceSec, setMinSilenceSec] = useState(DEFAULT_AUTOCUT.minSilenceSec);
  return (
    <section className="rounded-xl border border-ink-500 bg-ink-800/60 p-3" aria-label="Auto-cut silences">
      <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold text-zinc-200"><Scissors size={13} className="text-violet-300" />Auto-cut silences</div>
      <p className="mb-2 text-[10px] leading-relaxed text-zinc-500">Finds quiet gaps in this clip and removes them, closing the gaps. One undo step restores everything.</p>
      <label className="mb-1 flex items-center justify-between text-[10px] text-zinc-400">Silence threshold<span className="font-mono">{thresholdDb} dB</span></label>
      <input type="range" min={-60} max={-20} step={1} value={thresholdDb} onChange={(e) => setThresholdDb(Number(e.target.value))} className="mb-2 w-full accent-violet-500" aria-label="Silence threshold in decibels" />
      <label className="mb-1 flex items-center justify-between text-[10px] text-zinc-400">Shortest gap to cut<span className="font-mono">{minSilenceSec.toFixed(2)} s</span></label>
      <input type="range" min={0.15} max={2} step={0.05} value={minSilenceSec} onChange={(e) => setMinSilenceSec(Number(e.target.value))} className="mb-3 w-full accent-violet-500" aria-label="Shortest silence to remove in seconds" />
      <button type="button" disabled={busy} className="inline-flex h-8 w-full items-center justify-center gap-2 rounded bg-violet-600 text-xs font-medium text-white hover:bg-violet-500 disabled:opacity-50" onClick={() => { setBusy(true); void autoCutSilence(clipId, { ...DEFAULT_AUTOCUT, thresholdDb, minSilenceSec }).then(notify).finally(() => setBusy(false)); }}>{busy ? <Loader2 size={13} className="animate-spin" /> : <Scissors size={13} />}{busy ? 'Analysing audio…' : 'Remove silences'}</button>
    </section>
  );
}

function ClipInspector({ clip, fps }: { clip: Clip; fps: number }) {
  const patch = useEditor((s) => s.patchClip);
  const playhead = useEditor((s) => s.playhead);
  const notify = useEditor((s) => s.notify);
  const [fontQuery, setFontQuery] = useState('');
  const [importedFonts, setImportedFonts] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('f4-imported-fonts') ?? '[]') as string[]; } catch { return []; }
  });
  const fontInput = useRef<HTMLInputElement>(null);
  const importFont = async (file: File) => {
    try {
      const family = await loadFontFile(file);
      setImportedFonts((current) => {
        const next = [...new Set([...current, family])];
        localStorage.setItem('f4-imported-fonts', JSON.stringify(next));
        return next;
      });
      patch(clip.id, { text: { ...clip.text!, style: { ...clip.text!.style, fontFamily: cssFontFamily(family) } } });
      notify(`${family} loaded for this browser.`);
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not load that font file.'); }
  };
  const availableFonts = [...new Set([...importedFonts, ...FONT_CATALOG])].filter((font) => font.toLowerCase().includes(fontQuery.toLowerCase())).slice(0, 240);
  const tracks = useEditor((s) => s.history.present.tracks);
  const track = tracks.find((item) => item.id === clip.trackId);
  const t = clip.transform;
  const setT = (p: Partial<Clip['transform']>) => patch(clip.id, { transform: { ...t, ...p } });
  const effectValue = (type: string, fallback: number) => {
    const effect = clip.effects.find((item) => item.type === type && item.enabled);
    return typeof effect?.params.value === 'number' ? effect.params.value : fallback;
  };
  const effectParam = (type: string, key: string, fallback: string | number) => {
    const effect = clip.effects.find((item) => item.type === type && item.enabled);
    const value = effect?.params[key];
    return typeof value === 'string' || typeof value === 'number' ? value : fallback;
  };
  const setEffect = (type: string, value: number) => {
    setEffectParam(type, 'value', value);
  };
  const setEffectParam = (type: string, key: string, value: string | number) => {
    const effects = [...clip.effects];
    const index = effects.findIndex((item) => item.type === type);
    const current = index >= 0 ? effects[index] : undefined;
    const next: EffectInstance = current
      ? { ...current, enabled: true, params: { ...current.params, [key]: value } }
      : { id: newId('fx'), type, enabled: true, intensity: 1, params: { [key]: value } };
    if (index >= 0) effects[index] = next;
    else effects.push(next);
    patch(clip.id, { effects });
  };
  const setTransition = (type: string) => {
    if (!type) return patch(clip.id, { transitionIn: undefined });
    const preset = TRANSITION_PRESETS.find((item) => item.id === type);
    if (!preset) return;
    const current: TransitionRef = clip.transitionIn ?? { id: newId('trn'), type, durationFrames: Math.max(1, Math.round(fps * 0.5)), direction: preset.direction, intensity: 1, params: {} };
    patch(clip.id, { transitionIn: { ...current, type, direction: preset.direction } });
  };
  const hasAudio = clip.kind === 'video' || clip.kind === 'audio';
  const hasVisual = clip.kind !== 'audio';
  const keyframe = (path: string, value: number) => patch(clip.id, { keyframes: setKeyframe(clip.keyframes, path, Math.max(0, playhead - clip.start), value) });
  const reorderEffect = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    const effects = [...clip.effects];
    const from = effects.findIndex((effect) => effect.id === fromId);
    const to = effects.findIndex((effect) => effect.id === toId);
    if (from < 0 || to < 0) return;
    const [moved] = effects.splice(from, 1);
    if (!moved) return;
    effects.splice(to, 0, moved);
    patch(clip.id, { effects });
  };

  return (
    <div className="inspector-clip-panel space-y-4 p-3">
      <div className="inspector-clip-heading">
        <span className="inspector-clip-kind">{clip.kind}</span>
        <div className="min-w-0"><strong title={clip.name}>{clip.name}</strong><span>{formatTimecode(clip.start, fps)} · {formatTimecode(clip.duration, fps)}</span></div>
      </div>
      {(clip.kind === 'video' || clip.kind === 'audio') && !clip.reverse && clip.freezeFrame === undefined && <AutoCutSection clipId={clip.id} />}
      {hasAudio && <section className="audio-focus rounded-xl border border-emerald-400/20 bg-[linear-gradient(135deg,rgba(16,185,129,0.12),rgba(124,58,237,0.08))] p-3 shadow-lg shadow-emerald-950/20">
        <div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2 text-xs font-semibold text-zinc-100"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-400/15 text-emerald-300"><AudioLines size={15} /></span>Audio mix</div><span className="label text-emerald-300/70">Primary</span></div>
        <Slider label="Clip gain" value={clip.audio.volume} min={0} max={1.5} step={0.01} format={(v) => `${Math.round(v * 100)}% · ${db(v)}`} onCommit={(v) => patch(clip.id, { audio: { ...clip.audio, volume: v } })} />
        <div className="mt-3 flex items-center gap-2"><button className={`flex h-8 flex-1 items-center justify-center gap-2 rounded border text-[11px] font-medium transition-colors ${clip.audio.muted ? 'border-red-400/40 bg-red-500/15 text-red-200' : 'border-emerald-400/25 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20'}`} onClick={() => patch(clip.id, { audio: { ...clip.audio, muted: !clip.audio.muted }})}>{clip.audio.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}{clip.audio.muted ? 'Unmute audio' : 'Mute audio'}</button><button className="btn-icon !h-8 !w-8 border border-ink-500" title="Keyframe clip gain" onClick={() => keyframe('audio.volume', clip.audio.volume)}><SlidersHorizontal size={13} /></button></div>
        <div className="mt-3 flex items-center gap-1 opacity-80"><span className="h-5 w-1 rounded-full bg-emerald-300/50" />{Array.from({ length: 28 }, (_, i) => <span key={i} className="audio-meter-bar flex-1 rounded-full bg-emerald-300/70" style={{ height: `${Math.max(2, 3 + ((i * 17) % 13))}px` }} />)}</div>
      </section>}
      <div>
        <div className="label mb-1">Name</div>
        <input className="field" defaultValue={clip.name} key={clip.id + clip.name} onBlur={(e) => e.target.value !== clip.name && patch(clip.id, { name: e.target.value || clip.kind })} />
        <div className="mt-2 grid grid-cols-3 gap-2 font-mono text-[11px] text-zinc-400">
          <div><div className="label">Start</div>{formatTimecode(clip.start, fps)}</div>
          <div><div className="label">End</div>{formatTimecode(clipEnd(clip), fps)}</div>
          <div><div className="label">Length</div>{formatTimecode(clip.duration, fps)}</div>
        </div>
      </div>

      {(clip.kind === 'video' || clip.kind === 'image' || clip.kind === 'audio') && <TimingSection clip={clip} />}

      {clip.kind === 'text' && clip.text && (
        <section className="space-y-3">
          <div className="label">Text</div>
          <textarea className="field !h-20 py-1" defaultValue={clip.text.text} key={clip.id} onBlur={(e) => e.target.value !== clip.text?.text && patch(clip.id, { text: { ...clip.text!, text: e.target.value } })} />
          <Slider label="Size" value={clip.text.style.fontSize} min={12} max={240} step={1} format={(v) => `${Math.round(v)} px`} onCommit={(v) => patch(clip.id, { text: { ...clip.text!, style: { ...clip.text!.style, fontSize: v } } })} />
          <Slider label="Weight" value={clip.text.style.fontWeight} min={300} max={900} step={100} format={(v) => `${Math.round(v)}`} onCommit={(v) => patch(clip.id, { text: { ...clip.text!, style: { ...clip.text!.style, fontWeight: Math.round(v) } } })} />
          <div className="grid grid-cols-3 gap-2"><button className={`field text-center font-bold ${clip.text.style.fontWeight >= 700 ? 'border-violet-400 bg-violet-500/15 text-violet-200' : ''}`} aria-label="Bold" title="Bold" aria-pressed={clip.text.style.fontWeight >= 700} onClick={() => patch(clip.id, { text: { ...clip.text!, style: { ...clip.text!.style, fontWeight: clip.text!.style.fontWeight >= 700 ? 500 : 800 } } })}>B</button><button className={`field text-center italic ${clip.text.style.italic ? 'border-violet-400 bg-violet-500/15 text-violet-200' : ''}`} aria-label="Italic" title="Italic" aria-pressed={clip.text.style.italic} onClick={() => patch(clip.id, { text: { ...clip.text!, style: { ...clip.text!.style, italic: !clip.text!.style.italic } } })}>I</button><button className={`field text-center underline ${clip.text.style.underline ? 'border-violet-400 bg-violet-500/15 text-violet-200' : ''}`} aria-label="Underline" title="Underline" aria-pressed={clip.text.style.underline} onClick={() => patch(clip.id, { text: { ...clip.text!, style: { ...clip.text!.style, underline: !clip.text!.style.underline } } })}>U</button></div>
          <Slider label="Letter spacing" value={clip.text.style.letterSpacing} min={-4} max={24} step={0.5} format={(v) => `${v.toFixed(1)} px`} onCommit={(v) => patch(clip.id, { text: { ...clip.text!, style: { ...clip.text!.style, letterSpacing: v } } })} />
          <Slider label="Line height" value={clip.text.style.lineHeight} min={0.8} max={2} step={0.05} format={(v) => `${v.toFixed(2)}`} onCommit={(v) => patch(clip.id, { text: { ...clip.text!, style: { ...clip.text!.style, lineHeight: v } } })} />
          <label className="label">Font library<div className="mt-1 flex gap-1"><input className="field min-w-0 flex-1" placeholder="Search 150+ fonts…" value={fontQuery} onChange={(e) => setFontQuery(e.target.value)} /><button type="button" className="field px-2 text-[10px]" title="Load TTF, OTF, WOFF or WOFF2" onClick={() => fontInput.current?.click()}>＋</button></div><select className="field mt-1" value={clip.text.style.fontFamily} onChange={(e) => patch(clip.id, { text: { ...clip.text!, style: { ...clip.text!.style, fontFamily: e.target.value } } })}>{availableFonts.map((font) => <option key={font} value={cssFontFamily(font)}>{font}</option>)}</select><input ref={fontInput} type="file" accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2" multiple className="hidden" onChange={(e) => { const files = [...(e.target.files ?? [])]; void Promise.all(files.map(importFont)); e.target.value = ''; }} /><span className="mt-1 block text-[9px] text-zinc-600">Install as many local font files as you want; they are available immediately in preview.</span></label>
          <label className="label">Alignment<select className="field mt-1" value={clip.text.style.align} onChange={(e) => patch(clip.id, { text: { ...clip.text!, style: { ...clip.text!.style, align: e.target.value as NonNullable<Clip['text']>['style']['align'] } } })}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label>
          <label className="flex items-center justify-between"><span className="label">Colour</span>
            <input type="color" value={clip.text.style.color} onChange={(e) => patch(clip.id, { text: { ...clip.text!, style: { ...clip.text!.style, color: e.target.value } } })} />
          </label>
          <div className="border-t border-ink-600/70 pt-3"><div className="label mb-2">Gradient fill</div><div className="grid grid-cols-2 gap-2"><label className="label">From<input className="field mt-1 h-8 p-1" type="color" value={clip.text.style.gradient?.from ?? clip.text.style.color} onChange={(e) => patch(clip.id, { text: { ...clip.text!, style: { ...clip.text!.style, gradient: { from: e.target.value, to: clip.text!.style.gradient?.to ?? '#a78bfa', angle: clip.text!.style.gradient?.angle ?? 90 } } } })} /></label><label className="label">To<input className="field mt-1 h-8 p-1" type="color" value={clip.text.style.gradient?.to ?? '#a78bfa'} onChange={(e) => patch(clip.id, { text: { ...clip.text!, style: { ...clip.text!.style, gradient: { from: clip.text!.style.gradient?.from ?? clip.text!.style.color, to: e.target.value, angle: clip.text!.style.gradient?.angle ?? 90 } } } })} /></label></div><Slider label="Gradient angle" value={clip.text.style.gradient?.angle ?? 90} min={0} max={360} step={1} format={(v) => `${Math.round(v)}°`} onCommit={(v) => patch(clip.id, { text: { ...clip.text!, style: { ...clip.text!.style, gradient: { from: clip.text!.style.gradient?.from ?? clip.text!.style.color, to: clip.text!.style.gradient?.to ?? '#a78bfa', angle: v } } } })} /></div>
          <div className="grid grid-cols-2 gap-2"><label className="label">Border<input className="field mt-1 h-8 p-1" type="color" value={clip.text.style.outline?.color ?? '#000000'} onChange={(e) => patch(clip.id, { text: { ...clip.text!, style: { ...clip.text!.style, outline: { color: e.target.value, width: clip.text!.style.outline?.width ?? 2 } } } })} /></label><Slider label="Border width" value={clip.text.style.outline?.width ?? 0} min={0} max={12} step={1} format={(v) => `${Math.round(v)} px`} onCommit={(v) => patch(clip.id, { text: { ...clip.text!, style: { ...clip.text!.style, outline: { color: clip.text!.style.outline?.color ?? '#000000', width: v } } } })} /></div>
          <div className="grid grid-cols-2 gap-2"><label className="label">Shadow<input className="field mt-1 h-8 p-1" type="color" value={clip.text.style.shadow?.color ?? '#000000'} onChange={(e) => patch(clip.id, { text: { ...clip.text!, style: { ...clip.text!.style, shadow: { color: e.target.value, blur: clip.text!.style.shadow?.blur ?? 12, offsetX: clip.text!.style.shadow?.offsetX ?? 0, offsetY: clip.text!.style.shadow?.offsetY ?? 4 } } } })} /></label><Slider label="Shadow blur" value={clip.text.style.shadow?.blur ?? 0} min={0} max={40} step={1} format={(v) => `${Math.round(v)} px`} onCommit={(v) => patch(clip.id, { text: { ...clip.text!, style: { ...clip.text!.style, shadow: { color: clip.text!.style.shadow?.color ?? '#000000', blur: v, offsetX: clip.text!.style.shadow?.offsetX ?? 0, offsetY: clip.text!.style.shadow?.offsetY ?? 4 } } } })} /></div>
          <label className="label">Text background<input className="field mt-1 h-8 p-1" type="color" value={clip.text.style.background?.color ?? '#000000'} onChange={(e) => patch(clip.id, { text: { ...clip.text!, style: { ...clip.text!.style, background: { color: e.target.value, padding: clip.text!.style.background?.padding ?? 12, radius: clip.text!.style.background?.radius ?? 8 } } } })} /></label>
          <div className="border-t border-ink-600/70 pt-3">
            <div className="label mb-2">Animation presets · {TEXT_ANIMATION_PRESETS.length}</div>
            {(['animationIn', 'animationLoop', 'animationOut'] as const).map((slot) => (
              <label key={slot} className="mb-2 block text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                {slot === 'animationIn' ? 'Entrance' : slot === 'animationOut' ? 'Exit' : 'Loop'}
                <select className="field mt-1" value={clip.text?.[slot]?.presetId ?? ''} onChange={(e) => patch(clip.id, { text: { ...clip.text!, [slot]: e.target.value ? animationRef(e.target.value, Math.max(1, Math.round(fps * 0.8))) : undefined } })}>
                  <option value="">None</option>
                  {TEXT_ANIMATION_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.category} · {preset.name}</option>)}
                </select>
              </label>
            ))}
          </div>
        </section>
      )}

      {hasVisual && (
        <section className="space-y-3">
          <div className="label">Transform</div>
          <Slider label="Opacity" value={t.opacity} min={0} max={1} step={0.01} format={pct} onCommit={(v) => setT({ opacity: v })} />
          <Slider label="Scale" value={t.scaleX} min={0.1} max={4} step={0.01} format={pct} onCommit={(v) => setT({ scaleX: v, scaleY: v })} />
          <Slider label="Rotation" value={t.rotation} min={-180} max={180} step={1} format={(v) => `${Math.round(v)}°`} onCommit={(v) => setT({ rotation: v })} />
          <Slider label="X" value={t.x} min={-1} max={1} step={0.01} onCommit={(v) => setT({ x: v })} />
          <Slider label="Y" value={t.y} min={-1} max={1} step={0.01} onCommit={(v) => setT({ y: v })} />
          <Slider label="Corner radius" value={t.cornerRadius} min={0} max={0.5} step={0.01} format={pct} onCommit={(v) => setT({ cornerRadius: v })} />
          <div className="grid grid-cols-2 gap-2">
            <Slider label="Crop left" value={t.crop.left} min={0} max={0.9} step={0.01} format={pct} onCommit={(v) => setT({ crop: { ...t.crop, left: v } })} />
            <Slider label="Crop right" value={t.crop.right} min={0} max={0.9} step={0.01} format={pct} onCommit={(v) => setT({ crop: { ...t.crop, right: v } })} />
            <Slider label="Crop top" value={t.crop.top} min={0} max={0.9} step={0.01} format={pct} onCommit={(v) => setT({ crop: { ...t.crop, top: v } })} />
            <Slider label="Crop bottom" value={t.crop.bottom} min={0} max={0.9} step={0.01} format={pct} onCommit={(v) => setT({ crop: { ...t.crop, bottom: v } })} />
          </div>
          <div className="flex gap-2">
            <button className="field flex-1 text-center hover:border-violet-500" aria-pressed={t.flipH} onClick={() => setT({ flipH: !t.flipH })}>Flip H {t.flipH ? '✓' : ''}</button>
            <button className="field flex-1 text-center hover:border-violet-500" aria-pressed={t.flipV} onClick={() => setT({ flipV: !t.flipV })}>Flip V {t.flipV ? '✓' : ''}</button>
          </div>
          <div className="border-t border-ink-600/70 pt-3"><div className="mb-2 flex items-center justify-between"><div className="label">Keyframes</div><span className="font-mono text-[10px] text-violet-300">{formatTimecode(Math.max(0, playhead - clip.start), fps)}</span></div>
            <div className="grid grid-cols-2 gap-1.5">
              <button className="field text-center hover:border-violet-500" onClick={() => keyframe('transform.x', t.x)}>X position</button>
              <button className="field text-center hover:border-violet-500" onClick={() => keyframe('transform.y', t.y)}>Y position</button>
              <button className="field text-center hover:border-violet-500" onClick={() => keyframe('transform.scaleX', t.scaleX)}>Scale</button>
              <button className="field text-center hover:border-violet-500" onClick={() => keyframe('transform.rotation', t.rotation)}>Rotation</button>
              <button className="field text-center hover:border-violet-500" onClick={() => keyframe('transform.opacity', t.opacity)}>Opacity</button>
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-zinc-600">Move the playhead, change a property, then add a keyframe. Preview interpolation uses the clip’s frame timeline.</p>
          </div>
        </section>
      )}

      {hasVisual && (
        <section className="space-y-3">
          <div className="label">Transition in · {TRANSITION_PRESETS.length} presets</div>
          <select className="field" aria-label="Transition in" value={clip.transitionIn?.type ?? ''} onChange={(e) => setTransition(e.target.value)}>
            <option value="">None</option>
            {TRANSITION_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.category} · {preset.name}</option>)}
          </select>
          {clip.transitionIn && <>
            <Slider label="Duration" value={clip.transitionIn.durationFrames / fps} min={0.1} max={3} step={0.05} format={(v) => `${v.toFixed(2)} s`} onCommit={(v) => patch(clip.id, { transitionIn: { ...clip.transitionIn!, durationFrames: Math.max(1, Math.round(v * fps)) } })} />
            <Slider label="Intensity" value={clip.transitionIn.intensity} min={0} max={2} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onCommit={(v) => patch(clip.id, { transitionIn: { ...clip.transitionIn!, intensity: v } })} />
            <label className="flex items-center justify-between"><span className="label">Colour</span><input type="color" value={clip.transitionIn.color ?? '#000000'} onChange={(e) => patch(clip.id, { transitionIn: { ...clip.transitionIn!, color: e.target.value } })} /></label>
          </>}
        </section>
      )}

      {hasAudio && <AudioLab clip={clip} trackVolume={track?.volume ?? 1} onTrackVolume={(v) => track && useEditor.getState().patchTrack(track.id, { volume: v })} tracks={tracks} />}

      {hasVisual && clip.kind !== 'text' && <MotionSection clip={clip} />}

      {clip.kind === 'visualizer' && clip.visualizer && (
        <section className="space-y-3">
          <div className="label">Visualizer</div>
          <label className="label">Mode<select className="field mt-1" value={clip.visualizer.type} onChange={(e) => patch(clip.id, { visualizer: { ...clip.visualizer!, type: e.target.value as NonNullable<Clip['visualizer']>['type'] } })}>
            <optgroup label="Audio visualizers"><option value="dotline">Lofi dotted spikes</option><option value="roundbars">Round bars + peaks</option><option value="dotmatrix">LED dot matrix</option><option value="ripple">Bass ripples</option><option value="linewave">Minimal line wave</option><option value="spectrum">Vertical spectrum</option><option value="radial">Circular radial</option><option value="oscilloscope">Oscilloscope</option><option value="mirrored">Mirrored bars</option><option value="heartbeat">Heartbeat / cardiac</option><option value="orbit">Orbit particles</option></optgroup><optgroup label="Progress bars"><option value="framepulse">Frame border</option><option value="progressline">Line + knob</option><option value="progresssegments">Segmented pill</option><option value="progressring">Ring + percent</option><option value="countdown">Progress halo</option></optgroup>
          </select></label>
          {!isProgressVisualizer(clip.visualizer.type) && <Slider label="Sensitivity" value={clip.visualizer.sensitivity} min={0.1} max={3} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onCommit={(v) => patch(clip.id, { visualizer: { ...clip.visualizer!, sensitivity: v } })} />}
          {clip.visualizer.type !== 'progressline' && clip.visualizer.type !== 'progressring' && clip.visualizer.type !== 'framepulse' && <Slider label={clip.visualizer.type === 'progresssegments' ? 'Segments' : 'Bar count'} value={clip.visualizer.bars} min={8} max={128} step={1} format={(v) => `${Math.round(v)}`} onCommit={(v) => patch(clip.id, { visualizer: { ...clip.visualizer!, bars: Math.round(v) } })} />}
          {(clip.visualizer.type === 'progressline' || clip.visualizer.type === 'progresssegments' || clip.visualizer.type === 'progressring' || clip.visualizer.type === 'ripple' || clip.visualizer.type === 'roundbars' || clip.visualizer.type === 'dotmatrix') && <Slider label="Vertical position" value={clip.visualizer.waveformY ?? 0.84} min={0.05} max={0.97} step={0.01} format={(v) => `${Math.round(v * 100)}% down`} onCommit={(v) => patch(clip.id, { visualizer: { ...clip.visualizer!, waveformY: v } })} />}
          {(clip.visualizer.type === 'progressring' || clip.visualizer.type === 'ripple') && <Slider label="Size" value={clip.visualizer.radius ?? 0.14} min={0.05} max={0.4} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onCommit={(v) => patch(clip.id, { visualizer: { ...clip.visualizer!, radius: v } })} />}
          {(clip.visualizer.type === 'progressline' || clip.visualizer.type === 'progresssegments' || clip.visualizer.type === 'progressring') && <><Slider label="Thickness" value={clip.visualizer.borderWidth ?? 8} min={2} max={30} step={1} format={(v) => `${Math.round(v)} px`} onCommit={(v) => patch(clip.id, { visualizer: { ...clip.visualizer!, borderWidth: v } })} /><Slider label="Opacity" value={clip.visualizer.borderOpacity ?? 0.9} min={0.2} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onCommit={(v) => patch(clip.id, { visualizer: { ...clip.visualizer!, borderOpacity: v } })} /></>}
          {clip.visualizer.type === 'dotline' && <Slider label="Spike height" value={clip.visualizer.radius ?? 0.28} min={0.1} max={0.7} step={0.01} format={(v) => `${Math.round((v / 0.28) * 100)}%`} onCommit={(v) => patch(clip.id, { visualizer: { ...clip.visualizer!, radius: v } })} />}
          {(clip.visualizer.type === 'linewave' || clip.visualizer.type === 'framepulse' || clip.visualizer.type === 'dotline') && <>{(clip.visualizer.type === 'linewave' || clip.visualizer.type === 'dotline') && <Slider label="Waveform height" value={clip.visualizer.waveformY ?? 0.84} min={0.55} max={0.96} step={0.01} format={(v) => `${Math.round(v * 100)}% down`} onCommit={(v) => patch(clip.id, { visualizer: { ...clip.visualizer!, waveformY: v } })} />}<Slider label="Border opacity" value={clip.visualizer.borderOpacity ?? 0.3} min={0.04} max={0.8} step={0.01} format={pct} onCommit={(v) => patch(clip.id, { visualizer: { ...clip.visualizer!, borderOpacity: v } })} /><Slider label="Border width" value={clip.visualizer.borderWidth ?? 2} min={1} max={8} step={1} format={(v) => `${Math.round(v)} px`} onCommit={(v) => patch(clip.id, { visualizer: { ...clip.visualizer!, borderWidth: v } })} /><button className="field text-center hover:border-violet-500" aria-pressed={clip.visualizer.showBorder !== false} onClick={() => patch(clip.id, { visualizer: { ...clip.visualizer!, showBorder: clip.visualizer!.showBorder === false } })}>{clip.visualizer.showBorder === false ? 'Show border' : 'Hide border'}</button></>}
          <div className="grid grid-cols-2 gap-2"><label className="label">{clip.visualizer.type === 'dotline' ? 'Centre colour' : 'Primary'}<input className="field mt-1 h-8 p-1" type="color" value={clip.visualizer.primaryColor} onChange={(e) => patch(clip.id, { visualizer: { ...clip.visualizer!, primaryColor: e.target.value } })} /></label><label className="label">{clip.visualizer.type === 'dotline' ? 'Edge colour' : 'Secondary'}<input className="field mt-1 h-8 p-1" type="color" value={clip.visualizer.secondaryColor} onChange={(e) => patch(clip.id, { visualizer: { ...clip.visualizer!, secondaryColor: e.target.value } })} /></label></div>
          <p className="text-[10px] leading-relaxed text-zinc-600">Audio visualizers react to the imported song; progress bars fill over the clip's length.</p>
        </section>
      )}

      {hasVisual && (
        <section className="space-y-3">
          <div className="flex items-center justify-between"><div className="label">Live effects</div><div className="flex gap-2"><button className="text-[10px] text-zinc-500 hover:text-zinc-200" onClick={() => { effectClipboard = clip.effects.map((effect) => ({ ...effect, params: { ...effect.params } })); }}>Copy</button><button className="text-[10px] text-zinc-500 hover:text-zinc-200 disabled:opacity-40" disabled={!effectClipboard.length} onClick={() => patch(clip.id, { effects: effectClipboard.map((effect) => ({ ...effect, id: newId('fx'), params: { ...effect.params } })) })}>Paste</button><button className="text-[10px] text-zinc-500 hover:text-zinc-200" onClick={() => patch(clip.id, { effects: [] })}>Reset</button></div></div>
          {clip.effects.length > 0 && <div className="effect-stack space-y-1.5 rounded-lg border border-ink-600/70 bg-ink-900/70 p-2"><div className="label mb-1">Stack · drag to reorder</div>{clip.effects.map((effect) => <div key={effect.id} draggable className="flex items-center gap-2 rounded border border-ink-600 bg-ink-800 px-2 py-1.5 text-[11px] text-zinc-200" onDragStart={(e) => e.dataTransfer.setData('text/effect-id', effect.id)} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const from = e.dataTransfer.getData('text/effect-id'); if (from) reorderEffect(from, effect.id); }}><GripVertical size={13} className="shrink-0 text-zinc-600" /><span className="min-w-0 flex-1 truncate">{effect.type}</span><button className="text-zinc-500 hover:text-red-300" title={`Remove ${effect.type}`} onClick={() => patch(clip.id, { effects: clip.effects.filter((item) => item.id !== effect.id) })}>×</button></div>)}</div>}
          <label className="label">Filter preset<select className="field mt-1" value="" onChange={(e) => { if (e.target.value) patch(clip.id, { effects: effectsForFilter(e.target.value) }); }}>
            <option value="">Choose a look…</option>
            {FILTER_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.category} · {preset.name}</option>)}
          </select></label>
          <Slider label="Brightness" value={effectValue('brightness', 0)} min={-1} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onCommit={(v) => setEffect('brightness', v)} />
          <Slider label="Contrast" value={effectValue('contrast', 1)} min={0} max={2} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onCommit={(v) => setEffect('contrast', v)} />
          <Slider label="Saturation" value={effectValue('saturation', 1)} min={0} max={2} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onCommit={(v) => setEffect('saturation', v)} />
          <Slider label="Blur" value={effectValue('blur', 0)} min={0} max={20} step={0.1} format={(v) => `${v.toFixed(1)} px`} onCommit={(v) => setEffect('blur', v)} />
          <Slider label="Sepia" value={effectValue('sepia', 0)} min={0} max={1} step={0.01} format={pct} onCommit={(v) => setEffect('sepia', v)} />
          <div className="border-t border-ink-600/70 pt-3">
            <div className="label mb-2">Advanced colour & texture</div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-3">
              <Slider label="Exposure" value={effectValue('exposure', 0)} min={-1} max={1} step={0.01} format={pct} onCommit={(v) => setEffect('exposure', v)} />
              <Slider label="Vibrance" value={effectValue('vibrance', 0)} min={-1} max={1} step={0.01} format={pct} onCommit={(v) => setEffect('vibrance', v)} />
              <Slider label="Gamma" value={effectValue('gamma', 1)} min={0.1} max={3} step={0.01} format={(v) => v.toFixed(2)} onCommit={(v) => setEffect('gamma', v)} />
              <Slider label="Vignette" value={effectValue('vignette', 0)} min={0} max={1} step={0.01} format={pct} onCommit={(v) => setEffect('vignette', v)} />
              <Slider label="Whites" value={effectValue('whites', 0)} min={-1} max={1} step={0.01} format={pct} onCommit={(v) => setEffect('whites', v)} />
              <Slider label="Blacks" value={effectValue('blacks', 0)} min={-1} max={1} step={0.01} format={pct} onCommit={(v) => setEffect('blacks', v)} />
              <Slider label="Sharpen" value={effectValue('sharpen', 0)} min={0} max={1} step={0.01} format={pct} onCommit={(v) => setEffect('sharpen', v)} />
              <Slider label="Glow" value={effectValue('glow', 0)} min={0} max={1} step={0.01} format={pct} onCommit={(v) => setEffect('glow', v)} />
              <Slider label="Film grain" value={effectValue('filmGrain', 0)} min={0} max={1} step={0.01} format={pct} onCommit={(v) => setEffect('filmGrain', v)} />
              <Slider label="Pixelation" value={effectValue('pixelation', 0)} min={0} max={1} step={0.01} format={pct} onCommit={(v) => setEffect('pixelation', v)} />
              <Slider label="RGB split" value={effectValue('rgbSplit', 0)} min={0} max={1} step={0.01} format={pct} onCommit={(v) => setEffect('rgbSplit', v)} />
              <Slider label="Noise" value={effectValue('noise', 0)} min={0} max={1} step={0.01} format={pct} onCommit={(v) => setEffect('noise', v)} />
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-zinc-600">Advanced effects are stored as stackable clip effects and use matching FFmpeg filters during MP4 export.</p>
          </div>
          {(clip.kind === 'video' || clip.kind === 'image') && <div className="border-t border-ink-600/70 pt-3">
            <div className="mb-2 flex items-center justify-between"><div className="label">Colour grading</div><button className="text-[10px] text-zinc-500 hover:text-zinc-200" onClick={() => patch(clip.id, { effects: clip.effects.filter((effect) => effect.type !== 'colorGrade') })}>Reset</button></div>
            <Slider label="Temperature" value={Number(effectParam('colorGrade', 'temperature', 0))} min={-1} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onCommit={(v) => setEffectParam('colorGrade', 'temperature', v)} />
            <Slider label="Tint" value={Number(effectParam('colorGrade', 'tint', 0))} min={-1} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onCommit={(v) => setEffectParam('colorGrade', 'tint', v)} />
            <Slider label="Shadows" value={Number(effectParam('colorGrade', 'shadows', 0))} min={-1} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onCommit={(v) => setEffectParam('colorGrade', 'shadows', v)} />
            <Slider label="Highlights" value={Number(effectParam('colorGrade', 'highlights', 0))} min={-1} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onCommit={(v) => setEffectParam('colorGrade', 'highlights', v)} />
            <Slider label="Vignette" value={Number(effectParam('colorGrade', 'vignette', 0))} min={0} max={1} step={0.01} format={pct} onCommit={(v) => setEffectParam('colorGrade', 'vignette', v)} />
          </div>}
          {(clip.kind === 'video' || clip.kind === 'image') && <div className="border-t border-ink-600/70 pt-3">
            <div className="mb-2 flex items-center justify-between"><div className="label">Chroma key</div><button className="text-[10px] text-zinc-500 hover:text-zinc-200" onClick={() => patch(clip.id, { effects: clip.effects.filter((effect) => effect.type !== 'chromaKey') })}>Reset</button></div>
            <label className="flex items-center justify-between"><span className="label">Key colour</span><input type="color" value={String(effectParam('chromaKey', 'color', '#00ff00'))} onChange={(e) => setEffectParam('chromaKey', 'color', e.target.value)} /></label>
            <div className="mt-3"><Slider label="Similarity" value={Number(effectParam('chromaKey', 'similarity', 0.28))} min={0.01} max={1} step={0.01} format={pct} onCommit={(v) => setEffectParam('chromaKey', 'similarity', v)} /></div>
            <Slider label="Edge softness" value={Number(effectParam('chromaKey', 'smoothness', 0.08))} min={0.001} max={0.5} step={0.005} format={pct} onCommit={(v) => setEffectParam('chromaKey', 'smoothness', v)} />
            <Slider label="Spill suppression" value={Number(effectParam('chromaKey', 'spill', 0.35))} min={0} max={1} step={0.01} format={pct} onCommit={(v) => setEffectParam('chromaKey', 'spill', v)} />
            <p className="mt-2 text-[10px] leading-relaxed text-zinc-600">Removes the selected colour in the live preview and FFmpeg export.</p>
          </div>}
          {(clip.kind === 'video' || clip.kind === 'image') && <div className="border-t border-ink-600/70 pt-3">
            <div className="mb-2 flex items-center justify-between"><div className="label">Mask</div><button className="text-[10px] text-zinc-500 hover:text-zinc-200" onClick={() => {
              const hasMask = clip.effects.some((effect) => effect.type === 'mask');
              patch(clip.id, { effects: hasMask ? clip.effects.filter((effect) => effect.type !== 'mask') : [...clip.effects, { id: newId('fx'), type: 'mask', enabled: true, intensity: 1, params: { shape: 'ellipse', width: 0.86, height: 0.86, x: 0, y: 0 } }] });
            }}>{clip.effects.some((effect) => effect.type === 'mask') ? 'Remove' : 'Add mask'}</button></div>
            {clip.effects.some((effect) => effect.type === 'mask') && <>
              <label className="label">Shape<select className="field mt-1" value={String(effectParam('mask', 'shape', 'ellipse'))} onChange={(e) => setEffectParam('mask', 'shape', e.target.value)}><option value="ellipse">Ellipse</option><option value="rectangle">Rectangle</option></select></label>
              <Slider label="Mask width" value={Number(effectParam('mask', 'width', 0.86))} min={0.05} max={1} step={0.01} format={pct} onCommit={(v) => setEffectParam('mask', 'width', v)} />
              <Slider label="Mask height" value={Number(effectParam('mask', 'height', 0.86))} min={0.05} max={1} step={0.01} format={pct} onCommit={(v) => setEffectParam('mask', 'height', v)} />
              <Slider label="Mask X" value={Number(effectParam('mask', 'x', 0))} min={-1} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onCommit={(v) => setEffectParam('mask', 'x', v)} />
              <Slider label="Mask Y" value={Number(effectParam('mask', 'y', 0))} min={-1} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onCommit={(v) => setEffectParam('mask', 'y', v)} />
              <p className="text-[10px] leading-relaxed text-zinc-600">Masks render in the live canvas preview and in supported MP4 export.</p>
            </>}
          </div>}
          <p className="text-[10px] leading-relaxed text-zinc-600">Use Copy/Paste to reuse an effect stack. Basic looks render live; advanced colour and texture effects are preserved for the FFmpeg export path.</p>
        </section>
      )}
    </div>
  );
}

export function Inspector() {
  const project = useEditor((s) => s.history.present);
  const selection = useEditor((s) => s.selection);
  const clip = selection.length === 1 ? project.clips[selection[0] as string] : undefined;

  return (
    <div className="inspector-panel flex h-full flex-col">
      <div className="inspector-header"><span className="label">Inspector</span><span className="inspector-header-dot" /></div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {clip ? (
          <ClipInspector clip={clip} fps={project.settings.fps} />
        ) : selection.length > 1 ? (
          <p className="p-4 text-xs text-zinc-500">{selection.length} clips selected. Use the timeline shortcuts to move, group, copy or delete them together.</p>
        ) : (
          <p className="p-4 text-xs leading-relaxed text-zinc-500">Select a clip on the timeline to edit its properties.</p>
        )}
      </div>
    </div>
  );
}

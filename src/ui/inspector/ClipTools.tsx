import { useEffect, useState, type ReactNode } from 'react';
import { Gauge, Music4, Scissors, Sparkles, Waves } from 'lucide-react';
import {
  animationRef, AUDIO_PRESETS, clipEnd, formatTimecode, FREQUENCY_LAB, MEDIA_ANIMATION_PRESETS, presetAudio, setClipSpeed, setSourceRange, sourceRangeOf,
  timelineToSource, tuningSemitones, type AudioPreset, type Clip,
} from '../../core';
import { useEditor } from '../../store/editor';
import { Slider } from '../common/Slider';

const pct = (v: number) => `${Math.round(v * 100)}%`;
const db = (v: number) => (v <= 0.0001 ? '-∞ dB' : `${(20 * Math.log10(v)).toFixed(1)} dB`);
const seconds = (frames: number, fps: number) => frames / fps;
const fmt = (sec: number) => { const m = Math.floor(sec / 60); const s = sec - m * 60; return `${m}:${s.toFixed(2).padStart(5, '0')}`; };

function Btn({ children, active, onClick, title, disabled }: { children: ReactNode; active?: boolean; onClick: () => void; title?: string; disabled?: boolean }) {
  return <button type="button" title={title} disabled={disabled} aria-pressed={active} className={`field text-center transition-colors hover:border-violet-500 disabled:opacity-40 ${active ? 'border-violet-400 bg-violet-500/15 text-violet-200' : ''}`} onClick={onClick}>{children}</button>;
}

/** Speed (which changes clip length) and source trimming. */
export function TimingSection({ clip }: { clip: Clip }) {
  const { apply, notify, patchClip } = useEditor.getState();
  const project = useEditor((s) => s.history.present);
  const playhead = useEditor((s) => s.playhead);
  const fps = project.settings.fps;
  const isMedia = clip.kind === 'video' || clip.kind === 'audio';
  const range = sourceRangeOf(project, clip);
  const [inText, setInText] = useState('');
  const [outText, setOutText] = useState('');
  useEffect(() => { setInText(seconds(range.in, fps).toFixed(2)); setOutText(seconds(range.out, fps).toFixed(2)); }, [range.in, range.out, fps, clip.id]);

  const changeSpeed = (v: number) => {
    const before = clip.duration;
    if (apply((p) => setClipSpeed(p, clip.id, v))) {
      const after = useEditor.getState().project().clips[clip.id]?.duration ?? before;
      if (after !== before && isMedia) notify(`${v.toFixed(2).replace(/0$/, '')}× → clip is now ${fmt(seconds(after, fps))} long (was ${fmt(seconds(before, fps))}).`);
    }
  };
  const commitRange = (nextIn: number, nextOut: number) => {
    const ok = apply((p) => setSourceRange(p, clip.id, Math.round(nextIn * fps), Math.round(nextOut * fps)));
    if (!ok) { setInText(seconds(range.in, fps).toFixed(2)); setOutText(seconds(range.out, fps).toFixed(2)); }
  };
  const atPlayhead = timelineToSource(clip, Math.min(Math.max(playhead, clip.start), clipEnd(clip) - 1));
  const maxSec = Number.isFinite(range.max) ? seconds(range.max, fps) : undefined;

  return (
    <section className="space-y-3 border-t border-ink-600/70 pt-3">
      <div className="flex items-center gap-2 label"><Gauge size={12} /> Speed &amp; timing</div>
      <Slider label="Speed" value={clip.speed} min={0.1} max={20} step={0.05} format={(v) => `${v.toFixed(2)}×`} onCommit={changeSpeed} />
      <div className="grid grid-cols-5 gap-1">
        {[0.25, 0.5, 0.75, 1, 1.5, 2, 4, 8, 12, 20].map((v) => <Btn key={v} active={Math.abs(clip.speed - v) < 0.001} onClick={() => changeSpeed(v)}>{v}×</Btn>)}
      </div>
      {isMedia && <p className="text-[10px] leading-relaxed text-zinc-500">Slower stretches the clip longer on the timeline (2× slower = twice as long); faster shortens it. Clips after it move to make room.</p>}
      {clip.kind === 'audio' || clip.kind === 'video' ? (
        <Btn active={clip.audio.preservePitch !== false} title="On: only tempo changes. Off: tape/vinyl style where slower also means lower." onClick={() => patchClip(clip.id, { audio: { ...clip.audio, preservePitch: clip.audio.preservePitch === false } })}>
          {clip.audio.preservePitch === false ? 'Tape style: pitch follows speed' : 'Keep original pitch'}
        </Btn>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <Btn active={clip.reverse} onClick={() => patchClip(clip.id, { reverse: !clip.reverse })}>{clip.reverse ? 'Play forward' : 'Play in reverse'}</Btn>
        {(clip.kind === 'video' || clip.kind === 'image') && <Btn active={clip.freezeFrame !== undefined} onClick={() => patchClip(clip.id, { freezeFrame: clip.freezeFrame !== undefined ? undefined : (timelineToSource(clip, playhead) ?? clip.sourceIn) })}>{clip.freezeFrame !== undefined ? 'Unfreeze' : 'Freeze frame'}</Btn>}
      </div>
      {isMedia && (
        <div className="space-y-2 rounded-lg border border-ink-600/70 bg-ink-900/60 p-2.5">
          <div className="flex items-center gap-1.5 label"><Scissors size={12} /> Trim · in / out (source seconds)</div>
          <div className="grid grid-cols-2 gap-2">
            <label className="label">In<input className="field mt-1 font-mono" inputMode="decimal" value={inText} onChange={(e) => setInText(e.target.value)} onBlur={() => { const v = parseFloat(inText); if (Number.isFinite(v)) commitRange(v, seconds(range.out, fps)); }} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} /></label>
            <label className="label">Out<input className="field mt-1 font-mono" inputMode="decimal" value={outText} onChange={(e) => setOutText(e.target.value)} onBlur={() => { const v = parseFloat(outText); if (Number.isFinite(v)) commitRange(seconds(range.in, fps), v); }} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} /></label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Btn title="Make the playhead the new start of this clip" disabled={atPlayhead === null} onClick={() => atPlayhead !== null && commitRange(seconds(atPlayhead, fps), seconds(range.out, fps))}>Set In at playhead</Btn>
            <Btn title="Make the playhead the new end of this clip" disabled={atPlayhead === null} onClick={() => atPlayhead !== null && commitRange(seconds(range.in, fps), seconds(atPlayhead + 1, fps))}>Set Out at playhead</Btn>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Btn disabled={maxSec === undefined} onClick={() => maxSec !== undefined && commitRange(0, maxSec)}>Full length</Btn>
            <Btn title="Cut the clip in two at the playhead" onClick={() => { useEditor.getState().select([clip.id]); useEditor.getState().splitSelection(); }}>Split at playhead</Btn>
          </div>
          <p className="text-[10px] text-zinc-500">Source {maxSec !== undefined ? `length ${fmt(maxSec)}` : 'length unknown'} · using {fmt(seconds(range.out - range.in, fps))} · on timeline {formatTimecode(clip.duration, fps)}. You can also drag the clip edges on the timeline.</p>
        </div>
      )}
    </section>
  );
}

const PRESET_GLYPH: Record<string, string> = { 'slow-reverb': '🌙', nightcore: '⚡', daycore: '🌊', 'tape-ghost': '👻', phonk: '🔥', 'funk-flip': '🕺', 'qawwali-air': '🕌', clarity: '💎', 'bass-boost': '🔊', telephone: '☎️', underwater: '🫧', 'vintage-vinyl': '📻' };

/** The audio lab: one-tap looks, frequency tuning and every adjustable knob. */
export function AudioLab({ clip, trackVolume, onTrackVolume, tracks }: { clip: Clip; trackVolume: number; onTrackVolume: (v: number) => void; tracks: Array<{ id: string; name: string; kind: string }> }) {
  const { apply, patchClip, notify } = useEditor.getState();
  const project = useEditor((s) => s.history.present);
  const fps = project.settings.fps;
  const a = clip.audio;
  const proc = a.processing;
  const setAudio = (next: Partial<Clip['audio']>) => patchClip(clip.id, { audio: { ...a, ...next } });
  const setProc = (next: Partial<Clip['audio']['processing']>) => setAudio({ processing: { ...proc, ...next } });
  const [customHz, setCustomHz] = useState(String(a.tuningHz ?? 440));
  useEffect(() => setCustomHz(String(a.tuningHz ?? 440)), [a.tuningHz]);

  const applyPreset = (preset: AudioPreset) => {
    patchClip(clip.id, { audio: presetAudio(a, preset) });
    if (Math.abs(preset.speed - clip.speed) > 0.001) apply((p) => setClipSpeed(p, clip.id, preset.speed));
    notify(`${preset.name} applied${preset.speed !== 1 ? ` · ${preset.speed}× speed${preset.tape ? ' (tape)' : ''}` : ''}.`);
  };
  const reset = () => { patchClip(clip.id, { audio: { ...a, pitchSemitones: 0, tuningHz: undefined, preservePitch: true, processing: { eqLow: 0, eqMid: 0, eqHigh: 0, compressor: 0, limiter: 0, reverb: 0, echo: 0, warmth: 0, drive: 0, wobble: 0, vinyl: 0, muffle: 0 } } }); apply((p) => setClipSpeed(p, clip.id, 1)); };
  const g = (k: keyof Clip['audio']['processing']) => (proc?.[k] ?? 0) as number;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between"><div className="flex items-center gap-2 label"><Music4 size={12} /> Audio lab</div><button type="button" className="text-[10px] text-zinc-500 hover:text-zinc-200" onClick={reset}>Reset all</button></div>

      <div>
        <div className="mb-1.5 label">Quick presets</div>
        <div className="grid grid-cols-2 gap-1.5">
          {AUDIO_PRESETS.map((preset) => (
            <button key={preset.id} type="button" className="audio-preset" title={`${preset.name} · ${preset.speed}× ${preset.tape ? 'tape' : 'keep pitch'}`} onClick={() => applyPreset(preset)}>
              <span aria-hidden="true">{PRESET_GLYPH[preset.id] ?? '🎚️'}</span><b>{preset.name}</b><small>{preset.hint}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-ink-600/70 bg-ink-900/60 p-2.5">
        <div className="mb-1.5 flex items-center gap-1.5 label"><Waves size={12} /> Frequency lab · tuning from A=440</div>
        <div className="grid grid-cols-3 gap-1.5">
          {FREQUENCY_LAB.map((f) => (
            <button key={f.hz} type="button" aria-pressed={a.tuningHz === f.hz} className={`freq-chip ${a.tuningHz === f.hz ? 'is-on' : ''}`} onClick={() => setAudio({ tuningHz: a.tuningHz === f.hz ? undefined : f.hz })}>
              <b>{f.hz}<small>Hz</small></b><span>{f.name}</span><small>{f.hint}</small>
            </button>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <label className="label flex-1">Custom Hz<input className="field mt-1 font-mono" inputMode="decimal" value={customHz} onChange={(e) => setCustomHz(e.target.value)} onBlur={() => { const v = parseFloat(customHz); if (Number.isFinite(v) && v >= 300 && v <= 600) setAudio({ tuningHz: Math.abs(v - 440) < 0.01 ? undefined : v }); else setCustomHz(String(a.tuningHz ?? 440)); }} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} /></label>
          <span className="pt-4 font-mono text-[10px] text-zinc-500">{tuningSemitones(a.tuningHz).toFixed(2)} st</span>
        </div>
        <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-500">A creative pitch tool: shifts the whole clip musically from A=440. It does not claim a recording was originally tuned to 440 Hz.</p>
      </div>

      <div className="space-y-3">
        <div className="label">Core motion</div>
        <Slider label="Volume" value={a.volume} min={0} max={1.5} step={0.01} format={(v) => `${pct(v)} · ${db(v)}`} onCommit={(v) => setAudio({ volume: v })} />
        <Slider label="Pitch" value={a.pitchSemitones} min={-24} max={24} step={1} format={(v) => `${v > 0 ? '+' : ''}${Math.round(v)} st`} onCommit={(v) => setAudio({ pitchSemitones: Math.round(v) })} />
        <div className="grid grid-cols-2 gap-3">
          <Slider label="Fade in" value={a.fadeInFrames / fps} min={0} max={10} step={0.05} format={(v) => `${v.toFixed(1)} s`} onCommit={(v) => setAudio({ fadeInFrames: Math.round(v * fps) })} />
          <Slider label="Fade out" value={a.fadeOutFrames / fps} min={0} max={10} step={0.05} format={(v) => `${v.toFixed(1)} s`} onCommit={(v) => setAudio({ fadeOutFrames: Math.round(v * fps) })} />
        </div>
        <Slider label="Pan" value={a.pan} min={-1} max={1} step={0.01} format={(v) => (v === 0 ? 'Centre' : `${v < 0 ? 'L' : 'R'} ${Math.round(Math.abs(v) * 100)}%`)} onCommit={(v) => setAudio({ pan: v })} />
        <Slider label="Track volume" value={trackVolume} min={0} max={2} step={0.01} format={(v) => `${pct(v)} · ${db(v)}`} onCommit={onTrackVolume} />
      </div>

      <div className="space-y-3 border-t border-ink-600/70 pt-3">
        <div className="label">Space &amp; texture</div>
        <div className="grid grid-cols-2 gap-3">
          <Slider label="Reverb" value={g('reverb')} min={0} max={1} step={0.01} format={pct} onCommit={(v) => setProc({ reverb: v })} />
          <Slider label="Echo" value={g('echo')} min={0} max={1} step={0.01} format={pct} onCommit={(v) => setProc({ echo: v })} />
          <Slider label="Vinyl" value={g('vinyl')} min={0} max={1} step={0.01} format={pct} onCommit={(v) => setProc({ vinyl: v })} />
          <Slider label="Wobble" value={g('wobble')} min={0} max={1} step={0.01} format={pct} onCommit={(v) => setProc({ wobble: v })} />
          <Slider label="Warmth" value={g('warmth')} min={0} max={1} step={0.01} format={pct} onCommit={(v) => setProc({ warmth: v })} />
          <Slider label="Drive" value={g('drive')} min={0} max={1} step={0.01} format={pct} onCommit={(v) => setProc({ drive: v })} />
          <Slider label="Muffle" value={g('muffle')} min={0} max={1} step={0.01} format={pct} onCommit={(v) => setProc({ muffle: v })} />
        </div>
      </div>

      <div className="space-y-3 border-t border-ink-600/70 pt-3">
        <div className="label">Tone / EQ</div>
        <div className="grid grid-cols-2 gap-3">
          <Slider label="Bass" value={g('eqLow')} min={-18} max={18} step={0.1} format={(v) => `${v.toFixed(1)} dB`} onCommit={(v) => setProc({ eqLow: v })} />
          <Slider label="Mid" value={g('eqMid')} min={-18} max={18} step={0.1} format={(v) => `${v.toFixed(1)} dB`} onCommit={(v) => setProc({ eqMid: v })} />
          <Slider label="Treble" value={g('eqHigh')} min={-18} max={18} step={0.1} format={(v) => `${v.toFixed(1)} dB`} onCommit={(v) => setProc({ eqHigh: v })} />
          <Slider label="Compressor" value={g('compressor')} min={0} max={1} step={0.01} format={pct} onCommit={(v) => setProc({ compressor: v })} />
          <Slider label="Limiter" value={g('limiter')} min={0} max={1} step={0.01} format={pct} onCommit={(v) => setProc({ limiter: v })} />
        </div>
      </div>

      <div className="border-t border-ink-600/70 pt-3">
        <div className="mb-2 flex items-center justify-between"><div className="label">Ducking</div><button className="text-[10px] text-zinc-500 hover:text-zinc-200" onClick={() => setAudio({ ducking: { ...(a.ducking ?? { amount: 0.5, attackFrames: 6, releaseFrames: 15 }), enabled: !(a.ducking?.enabled ?? false) } })}>{a.ducking?.enabled ? 'Disable' : 'Enable'}</button></div>
        {a.ducking?.enabled && <div className="space-y-3">
          <label className="label">Sidechain track<select className="field mt-1" value={a.ducking.sidechainTrackId ?? ''} onChange={(e) => setAudio({ ducking: { ...a.ducking!, sidechainTrackId: e.target.value || undefined } })}><option value="">Choose a track…</option>{tracks.filter((t) => t.id !== clip.trackId).map((t) => <option key={t.id} value={t.id}>{t.name} · {t.kind}</option>)}</select></label>
          <Slider label="Duck amount" value={a.ducking.amount} min={0} max={1} step={0.01} format={pct} onCommit={(v) => setAudio({ ducking: { ...a.ducking!, amount: v } })} />
        </div>}
      </div>
      <p className="text-[10px] leading-relaxed text-zinc-500">Everything here plays live in the preview and is rendered into the exported file.</p>
    </section>
  );
}

/** Entrance / exit / loop motion for image, video and visualizer clips. */
export function MotionSection({ clip }: { clip: Clip }) {
  const { patchClip } = useEditor.getState();
  const fps = useEditor((s) => s.history.present.settings.fps);
  const anim = clip.animation ?? {};
  const slots = [['in', 'Entrance'], ['out', 'Exit'], ['loop', 'Loop · while on screen']] as const;
  const set = (slot: 'in' | 'out' | 'loop', id: string, seconds?: number) => {
    const next = { ...anim };
    if (!id) delete next[slot];
    else next[slot] = animationRef(id, Math.max(1, Math.round((seconds ?? (slot === 'loop' ? 2 : 0.8)) * fps)));
    patchClip(clip.id, { animation: Object.keys(next).length ? next : undefined });
  };
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2 label"><Sparkles size={12} /> Motion · animation presets</div>
      {slots.map(([slot, label]) => {
        const ref = anim[slot];
        return (
          <div key={slot} className="space-y-1.5">
            <label className="block text-[10px] font-medium uppercase tracking-wider text-zinc-500">{label}
              <select className="field mt-1" aria-label={`${label} animation`} value={ref?.presetId ?? ''} onChange={(e) => set(slot, e.target.value, ref ? ref.durationFrames / fps : undefined)}>
                <option value="">None</option>
                {MEDIA_ANIMATION_PRESETS.filter((p) => p.slot === slot).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            {ref && !ref.presetId.startsWith('ken-burns') && <Slider label="Duration" value={ref.durationFrames / fps} min={0.1} max={Math.max(1, clip.duration / fps)} step={0.05} format={(v) => `${v.toFixed(2)} s`} onCommit={(v) => set(slot, ref.presetId, v)} />}
          </div>
        );
      })}
    </section>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Eye, Grid3x3, Maximize, Pause, Play, RotateCw, SkipBack, SkipForward, Square, StepBack, StepForward } from 'lucide-react';
import { ASPECT_RATIOS, dimensionsFor, formatTimecode, projectDuration, type AspectRatioKey, type Transform } from '../../core';
import { engine, visualizerBox } from '../../engine/playback';
import { useEditor } from '../../store/editor';

type CanvasBounds = { left: number; top: number; width: number; height: number };

function boundsForClip(project: ReturnType<typeof useEditor.getState>['history']['present'], clip: NonNullable<ReturnType<typeof useEditor.getState>['history']['present']['clips'][string]>): CanvasBounds | null {
  const { width, height } = project.settings;
  const asset = clip.assetId ? project.assets[clip.assetId] : undefined;
  if (clip.kind === 'audio' || clip.kind === 'effect') return null;
  if (clip.kind === 'visualizer' && clip.visualizer) {
    const box = visualizerBox(clip.visualizer, width, height);
    const bw = Math.max(2, (box.w * clip.transform.scaleX) / width * 100);
    const bh = Math.max(2, (box.h * clip.transform.scaleY) / height * 100);
    return { left: (box.cx / width) * 100 + clip.transform.x * 50 - bw / 2, top: (box.cy / height) * 100 + clip.transform.y * 50 - bh / 2, width: bw, height: bh };
  }
  if (clip.kind === 'text' && clip.text) {
    const m = engine.measuredText(clip.id);
    if (m) {
      const w = Math.max(2, (m.w * clip.transform.scaleX) / width * 100);
      const h = Math.max(2, (m.h * clip.transform.scaleY) / height * 100);
      const cx = 50 + clip.transform.x * 50;
      const align = clip.text.style.align;
      return { left: align === 'left' ? cx : align === 'right' ? cx - w : cx - w / 2, top: 50 + clip.transform.y * 50 - h / 2, width: w, height: h };
    }
    const value = clip.text.timerMode ? '00:00' : clip.text.text;
    const lines = value.split('\n');
    const fontScale = clip.text.style.fontSize / height;
    const widest = Math.max(1, ...lines.map((line) => line.length)) * fontScale * 0.62 + (clip.text.style.letterSpacing / width) * 2;
    const textW = Math.max(4, Math.min(96, widest * 100 * clip.transform.scaleX));
    const textH = Math.max(4, Math.min(80, lines.length * fontScale * clip.text.style.lineHeight * 100 * clip.transform.scaleY));
    return { left: 50 + clip.transform.x * 50 - textW / 2, top: 50 + clip.transform.y * 50 - textH / 2, width: textW, height: textH };
  }
  const canvasAspect = width / height;
  const sourceAspect = asset?.width && asset.height ? asset.width / asset.height : canvasAspect;
  const fitW = sourceAspect >= canvasAspect ? 100 : (sourceAspect / canvasAspect) * 100;
  const fitH = sourceAspect >= canvasAspect ? (canvasAspect / sourceAspect) * 100 : 100;
  const crop = clip.transform.crop;
  const visibleW = fitW * clip.transform.width * clip.transform.scaleX * (1 - crop.left - crop.right);
  const visibleH = fitH * clip.transform.height * clip.transform.scaleY * (1 - crop.top - crop.bottom);
  const fullW = fitW * clip.transform.width * clip.transform.scaleX;
  const fullH = fitH * clip.transform.height * clip.transform.scaleY;
  return { left: 50 + clip.transform.x * 50 - fullW * clip.transform.anchorX + fullW * crop.left, top: 50 + clip.transform.y * 50 - fullH * clip.transform.anchorY + fullH * crop.top, width: Math.max(1.5, visibleW), height: Math.max(1.5, visibleH) };
}

export function Preview() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const project = useEditor((s) => s.history.present);
  const playhead = useEditor((s) => s.playhead);
  const playing = useEditor((s) => s.playing);
  const selection = useEditor((s) => s.selection);
  const setPlayhead = useEditor((s) => s.setPlayhead);
  const apply = useEditor((s) => s.apply);
  const [grid, setGrid] = useState(false);
  const [safe, setSafe] = useState(false);
  const [effects, setEffects] = useState(true);
  const { fps, width, height, aspect } = project.settings;
  const duration = projectDuration(project);
  const drag = useRef<{ id: string; pointerId: number; startX: number; startY: number; transform: Transform } | null>(null);
  const manipulate = useRef<{ id: string; pointerId: number; mode: 'resize' | 'rotate'; corner?: 'nw' | 'ne' | 'sw' | 'se'; startX: number; startY: number; centerX: number; centerY: number; startAngle: number; transform: Transform } | null>(null);
  const [live, setLive] = useState<{ id: string; transform: Transform } | null>(null);
  const baseClip = selection.length === 1 ? project.clips[selection[0]!] : undefined;
  const selectedClip = baseClip && live && live.id === baseClip.id ? { ...baseClip, transform: live.transform } : baseClip;
  const selectedBounds = selectedClip ? boundsForClip(project, selectedClip) : null;

  useEffect(() => {
    if (canvas.current) engine.attach(canvas.current);
    return () => engine.dispose();
  }, []);

  // Re-render the still frame whenever the playhead or project changes while paused.
  useEffect(() => {
    engine.refresh();
  }, [playhead, project, playing]);

  const toggle = () => (playing ? engine.pause() : engine.play());

  const setAspect = (a: AspectRatioKey) =>
    apply((p) => ({ ok: true, project: { ...p, settings: { ...p.settings, aspect: a, ...dimensionsFor(a) }, updatedAt: Date.now() } }));

  const onCanvasPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const point = { x: ((event.clientX - rect.left) / rect.width) * 100, y: ((event.clientY - rect.top) / rect.height) * 100 };
    const trackOrder = new Map(project.tracks.map((track, index) => [track.id, index] as const));
    const inside = (clip: NonNullable<typeof selectedClip>) => { const b = boundsForClip(project, clip); return b && point.x >= b.left && point.x <= b.left + b.width && point.y >= b.top && point.y <= b.top + b.height ? b : null; };
    const visible = Object.values(project.clips)
      .filter((clip) => playhead >= clip.start && playhead < clip.start + clip.duration && !clip.locked)
      .sort((a, b) => (trackOrder.get(a.trackId) ?? 0) - (trackOrder.get(b.trackId) ?? 0));
    const hits = visible.filter((clip) => inside(clip));
    // keep grabbing the selected clip when the pointer is inside its box; otherwise prefer real elements over frames / backdrops that cover the whole canvas
    const current = selection.length === 1 ? hits.find((clip) => clip.id === selection[0]) : undefined;
    const area = (clip: (typeof hits)[number]) => { const b = boundsForClip(project, clip)!; return (b.width * b.height) / 10000; };
    const hit = current ?? hits.find((clip) => area(clip) < 0.8) ?? hits[0];
    const clip = hit ?? (selection.length === 1 ? project.clips[selection[0]!] : undefined);
    if (!clip || clip.kind === 'audio' || clip.kind === 'effect' || clip.locked) return;
    useEditor.getState().select([clip.id]);
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: clip.id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, transform: clip.transform };
  };

  const onCanvasPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const next = { ...current.transform, x: Math.max(-1, Math.min(1, current.transform.x + ((event.clientX - current.startX) / rect.width) * 2)), y: Math.max(-1, Math.min(1, current.transform.y + ((event.clientY - current.startY) / rect.height) * 2)) };
    engine.setTransientTransform(current.id, next);
    setLive({ id: current.id, transform: next });
  };

  const onCanvasPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const clip = useEditor.getState().project().clips[current.id];
    const rect = event.currentTarget.getBoundingClientRect();
    const next = { ...current.transform, x: Math.max(-1, Math.min(1, current.transform.x + ((event.clientX - current.startX) / rect.width) * 2)), y: Math.max(-1, Math.min(1, current.transform.y + ((event.clientY - current.startY) / rect.height) * 2)) };
    if (clip && (next.x !== clip.transform.x || next.y !== clip.transform.y)) useEditor.getState().patchClip(current.id, { transform: next });
    engine.setTransientTransform(current.id, null);
    setLive(null);
    drag.current = null;
  };

  const beginManipulation = (event: React.PointerEvent, mode: 'resize' | 'rotate', corner?: 'nw' | 'ne' | 'sw' | 'se') => {
    if (!selectedClip || selectedClip.kind === 'audio' || selectedClip.kind === 'effect' || selectedClip.locked) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = canvas.current?.getBoundingClientRect();
    if (!rect) return;
    const centerX = rect.left + rect.width / 2 + selectedClip.transform.x * rect.width / 2;
    const centerY = rect.top + rect.height / 2 + selectedClip.transform.y * rect.height / 2;
    manipulate.current = { id: selectedClip.id, pointerId: event.pointerId, mode, corner, startX: event.clientX, startY: event.clientY, centerX, centerY, startAngle: Math.atan2(event.clientY - centerY, event.clientX - centerX), transform: selectedClip.transform };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onManipulateMove = (event: React.PointerEvent) => {
    const current = manipulate.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const rect = canvas.current?.getBoundingClientRect();
    if (!rect) return;
    const base = current.transform;
    let next = base;
    if (current.mode === 'rotate') {
      const angle = Math.atan2(event.clientY - current.centerY, event.clientX - current.centerX);
      const degrees = base.rotation + ((angle - current.startAngle) * 180) / Math.PI;
      next = { ...base, rotation: Math.round(degrees) };
    } else {
      const sx = current.corner?.includes('w') ? -1 : 1;
      const sy = current.corner?.includes('n') ? -1 : 1;
      const dx = ((event.clientX - current.startX) / rect.width) * 2 * sx;
      const dy = ((event.clientY - current.startY) / rect.height) * 2 * sy;
      const scale = Math.max(0.1, Math.min(4, base.scaleX + (dx + dy) / 2));
      next = { ...base, scaleX: scale, scaleY: scale };
    }
    engine.setTransientTransform(current.id, next);
    setLive({ id: current.id, transform: next });
  };

  const endManipulation = (event: React.PointerEvent) => {
    const current = manipulate.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const clip = useEditor.getState().project().clips[current.id];
    if (clip) {
      const transient = current.mode === 'rotate' ? { ...current.transform, rotation: current.transform.rotation + Math.round((Math.atan2(event.clientY - current.centerY, event.clientX - current.centerX) - current.startAngle) * 180 / Math.PI) } : { ...current.transform, scaleX: Math.max(0.1, Math.min(4, current.transform.scaleX + ((((event.clientX - current.startX) / (canvas.current?.getBoundingClientRect().width ?? 1)) * 2 * (current.corner?.includes('w') ? -1 : 1)) + (((event.clientY - current.startY) / (canvas.current?.getBoundingClientRect().height ?? 1)) * 2 * (current.corner?.includes('n') ? -1 : 1))) / 2)), scaleY: Math.max(0.1, Math.min(4, current.transform.scaleY + ((((event.clientX - current.startX) / (canvas.current?.getBoundingClientRect().width ?? 1)) * 2 * (current.corner?.includes('w') ? -1 : 1)) + (((event.clientY - current.startY) / (canvas.current?.getBoundingClientRect().height ?? 1)) * 2 * (current.corner?.includes('n') ? -1 : 1))) / 2)) };
      useEditor.getState().patchClip(current.id, { transform: transient });
    }
    engine.setTransientTransform(current.id, null);
    setLive(null);
    manipulate.current = null;
  };

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="preview-bar flex h-11 shrink-0 items-center gap-2 px-3">
        <label className="label" htmlFor="aspect">Size</label>
        <select id="aspect" className="field !w-24" value={aspect} onChange={(e) => setAspect(e.target.value as AspectRatioKey)}>
          {(Object.keys(ASPECT_RATIOS) as AspectRatioKey[]).map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <span className="text-[11px] text-zinc-500">{width}×{height} · {fps} fps</span>
        <div className="ml-auto flex items-center gap-1">
          <button className="btn-icon" aria-pressed={safe} aria-label="Safe-area guides" title="Safe-area guides" onClick={() => setSafe(!safe)}><Square size={14} /></button>
          <button className="btn-icon" aria-pressed={grid} aria-label="Grid overlay" title="Grid overlay" onClick={() => setGrid(!grid)}><Grid3x3 size={14} /></button>
          <button className="btn-icon" aria-pressed={!effects} aria-label={effects ? 'Show original before effects' : 'Show effects'} title={effects ? 'Before / after: show original' : 'Before / after: show effects'} onClick={() => { const next = !effects; setEffects(next); engine.setEffectsEnabled(next); }}><Eye size={14} /></button>
          <button className="btn-icon" aria-label="Fullscreen preview" title="Fullscreen" onClick={() => void canvas.current?.requestFullscreen?.()}><Maximize size={14} /></button>
        </div>
      </div>

      <div ref={stage} className="relative flex min-h-0 flex-1 items-center justify-center p-2 lg:p-3">
        <div className="relative max-h-full max-w-full" style={{ aspectRatio: `${width} / ${height}`, height: '100%' }}>
          <canvas ref={canvas} width={width} height={height} className={`h-full w-full bg-black ${selection.length === 1 ? 'cursor-move' : ''}`} aria-label="Video preview" onPointerDown={onCanvasPointerDown} onPointerMove={(e) => { onCanvasPointerMove(e); onManipulateMove(e); }} onPointerUp={(e) => { onCanvasPointerUp(e); endManipulation(e); }} onPointerCancel={(e) => { onCanvasPointerUp(e); endManipulation(e); }} />
          {selectedClip && selectedBounds && selectedClip.kind !== 'audio' && selectedClip.kind !== 'effect' && !selectedClip.locked && <div className="transform-overlay pointer-events-none absolute" style={{ left: `${selectedBounds.left}%`, top: `${selectedBounds.top}%`, width: `${selectedBounds.width}%`, height: `${selectedBounds.height}%`, transform: `rotate(${selectedClip.transform.rotation}deg)` }}><div className="absolute inset-0 rounded border border-violet-400" />{(['nw', 'ne', 'sw', 'se'] as const).map((corner) => <button key={corner} aria-label={`Resize ${corner}`} className={`transform-handle pointer-events-auto ${corner}`} onPointerDown={(e) => beginManipulation(e, 'resize', corner)} onPointerMove={onManipulateMove} onPointerUp={endManipulation} onPointerCancel={endManipulation} />)}<button aria-label="Rotate selected clip" title="Drag to rotate" className="rotate-handle pointer-events-auto" onPointerDown={(e) => beginManipulation(e, 'rotate')} onPointerMove={onManipulateMove} onPointerUp={endManipulation} onPointerCancel={endManipulation}><RotateCw size={12} /></button></div>}
          {selection.length > 1 && selection.map((id) => { const c = project.clips[id]; const b = c && playhead >= c.start && playhead < c.start + c.duration ? boundsForClip(project, c) : null; return b ? <div key={id} className="pointer-events-none absolute rounded-sm border border-violet-300/80 bg-violet-400/10" style={{ left: `${b.left}%`, top: `${b.top}%`, width: `${b.width}%`, height: `${b.height}%`, transform: `rotate(${c!.transform.rotation}deg)` }} /> : null; })}
          {safe && <div className="pointer-events-none absolute inset-[5%] border border-dashed border-yellow-400/60" />}
          {grid && (
            <div className="pointer-events-none absolute inset-0" style={{ backgroundImage: 'linear-gradient(to right, rgba(255,255,255,.25) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,.25) 1px, transparent 1px)', backgroundSize: '33.333% 33.333%' }} />
          )}
        </div>
      </div>

      <div className="preview-controls flex h-12 shrink-0 items-center justify-center gap-1 px-3">
        <span className="absolute left-0 hidden" />
        <span className="mr-3 w-28 text-right font-mono text-[13px] tabular-nums" aria-live="off">{formatTimecode(playhead, fps)}</span>
        <button className="btn-icon" aria-label="Go to start" title="Go to start (Home)" onClick={() => setPlayhead(0)}><SkipBack size={15} /></button>
        <button className="btn-icon" aria-label="Previous frame" title="Previous frame (←)" onClick={() => setPlayhead(playhead - 1)}><StepBack size={15} /></button>
        <button className="preview-play inline-flex h-9 w-9 items-center justify-center rounded-full" aria-label={playing ? 'Pause' : 'Play'} title="Play / pause (Space)" onClick={toggle}>
          {playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <button className="btn-icon" aria-label="Next frame" title="Next frame (→)" onClick={() => setPlayhead(playhead + 1)}><StepForward size={15} /></button>
        <button className="btn-icon" aria-label="Go to end" title="Go to end (End)" onClick={() => setPlayhead(duration)}><SkipForward size={15} /></button>
        <span className="ml-3 w-28 font-mono text-[13px] tabular-nums text-zinc-500">{formatTimecode(duration, fps)}</span>
      </div>
    </div>
  );
}

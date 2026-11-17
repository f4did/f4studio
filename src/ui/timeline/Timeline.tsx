import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AudioLines, ChevronDown, ChevronUp, Clipboard, Copy, Eye, EyeOff, FileText, Film, Image as ImageIcon, Layers3, Lock, Magnet, Maximize, Music2, Plus, Scissors, Shapes, Sparkles, Trash2, Unlock, Volume2, VolumeX, ZoomIn, ZoomOut } from 'lucide-react';
import { clipEnd, clipsOnTrack, createTrack, formatTimecode, moveClips, contentEnd, projectDuration, slideClip, slipClip, snapClipStart, trackAccepts, trimLeft, trimRight, TRANSITION_PRESETS, type Clip, type Id, type Project, type TrackKind } from '../../core';
import { useEditor } from '../../store/editor';
import { thumbnailFor } from '../../engine/media';
import { waveformFor } from '../../engine/waveform';

// Keep the timeline focused on clips. Track type is encoded by clip color/icon;
// the lane-control column is intentionally hidden for a cleaner Clipchamp-like
// editing surface.
// The timeline is clip-first: lane headers stay in the data model but are not
// rendered as a left-side control column. Clips occupy the full timeline.
const HEADER_W = 0;
const RULER_H = 30;
const SNAP_PX = 8;

// Lane colours live in CSS (--lane-*) so the light/dark themes stay in sync.
const KIND_ICON: Record<Clip['kind'], typeof Film> = { video: Film, image: ImageIcon, audio: Music2, text: FileText, shape: Shapes, visualizer: AudioLines, effect: Sparkles };
const TRACK_ICON: Record<TrackKind, typeof Film> = { video: Film, image: ImageIcon, audio: Music2, text: FileText, overlay: Layers3, effect: Sparkles };

type DragMode = 'move' | 'trimL' | 'trimR' | 'slip' | 'slide';
interface Drag {
  mode: DragMode;
  id: Id;
  ids: Id[];
  startX: number;
  origStart: number;
  origEnd: number;
  deltaFrames: number;
  trackId?: Id;
  moved: boolean;
}
interface TrackResize { id: Id; startY: number; baseHeight: number; height: number; }

/** Move clips across lanes while displacing only the clips they would overlap.
 * Displaced clips cascade downward to the next free unlocked lane. */
function moveAcrossLanes(project: Project, ids: Id[], leadId: Id, delta: number, targetTrackId?: Id) {
  if (!targetTrackId) return moveClips(project, ids.map((id) => ({ id, start: (project.clips[id]?.start ?? 0) + delta })));
  const moving = new Set(ids);
  const lead = project.clips[leadId];
  if (!lead) return moveClips(project, []);
  const targetIndex = project.tracks.findIndex((track) => track.id === targetTrackId);
  if (targetIndex < 0) return moveClips(project, []);
  let next: Project = { ...project, clips: { ...project.clips }, tracks: [...project.tracks] };
  const desired = ids.map((id) => {
    const clip = project.clips[id];
    return clip ? { start: clip.start + delta, end: clip.start + delta + clip.duration } : null;
  }).filter((value): value is { start: number; end: number } => value !== null);
  const overlaps = (clip: Clip, start: number, end: number) => start < clipEnd(clip) && end > clip.start;
  const blockers = Object.values(project.clips).filter((clip) => !moving.has(clip.id) && clip.trackId === targetTrackId && desired.some((range) => overlaps(clip, range.start, range.end)));
  for (const blocker of blockers) {
    let laneIndex = targetIndex + 1;
    let lane = next.tracks[laneIndex];
    while (lane && (lane.locked || Object.values(next.clips).some((clip) => clip.id !== blocker.id && clip.trackId === lane!.id && overlaps(clip, blocker.start, clipEnd(blocker))))) {
      laneIndex += 1;
      lane = next.tracks[laneIndex];
    }
    if (!lane) {
      lane = createTrack('overlay', next.tracks.filter((track) => track.kind === 'overlay').length + 1);
      next.tracks.push(lane);
    }
    next.clips[blocker.id] = { ...blocker, trackId: lane.id };
  }
  return moveClips(next, ids.map((id) => ({ id, start: (next.clips[id]?.start ?? 0) + delta, trackId: id === leadId ? targetTrackId : undefined })));
}

/** Where the video ends: the end of the background (video / image) layer. Anything after it is cut from playback and export. */
function EndMarker({ zoom }: { zoom: number }) {
  const end = useEditor((s) => projectDuration(s.history.present));
  const content = useEditor((s) => contentEnd(s.history.present));
  if (end <= 0) return null;
  return (
    <>
      {content > end && <div className="timeline-cut pointer-events-none absolute bottom-0 top-0 z-10" style={{ left: HEADER_W + end * zoom, width: (content - end) * zoom }} />}
      <div className="timeline-end pointer-events-none absolute bottom-0 top-0 z-20 w-px" style={{ left: HEADER_W + end * zoom }} title="Video ends here (end of the background)"><span>END</span></div>
    </>
  );
}

function Playhead({ zoom }: { zoom: number }) {
  const playhead = useEditor((s) => s.playhead);
  return (
    <div className="timeline-playhead pointer-events-none absolute bottom-0 top-0 z-30 w-px" style={{ left: HEADER_W + playhead * zoom }}>
      <div className="timeline-playhead-cap absolute -left-[6px] top-0 h-3 w-[13px] rounded-b-md" />
    </div>
  );
}

const ClipBlock = memo(function ClipBlock({ clip, zoom, selected, dragOffset, dragStartPx, dragWidthPx, onPointerDown }: {
  clip: Clip; zoom: number; selected: boolean; dragOffset: number; dragStartPx?: number; dragWidthPx?: number;
      onPointerDown: (e: React.PointerEvent, mode: DragMode, clip: Clip) => void;
}) {
  const left = dragStartPx ?? (clip.start + dragOffset) * zoom;
  const width = Math.max(4, dragWidthPx ?? clip.duration * zoom);
  const Icon = KIND_ICON[clip.kind];
  const asset = useEditor((s) => clip.assetId ? s.history.present.assets[clip.assetId] : undefined);
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    if (asset && (clip.kind === 'video' || clip.kind === 'image')) void thumbnailFor(asset).then((value) => { if (active) setThumbnail(value); });
    else setThumbnail(null);
    return () => { active = false; };
  }, [asset, clip.kind]);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${clip.kind} clip ${clip.name}`}
      aria-pressed={selected}
      data-clip-id={clip.id}
      className={`timeline-clip timeline-clip-${clip.kind} absolute text-[11px] ${selected ? 'is-selected' : ''} ${clip.locked ? 'opacity-60' : ''}`}
      style={{ left, width }}
      title="Drag to move · Alt-drag to slip · Shift+Alt-drag to slide"
      onPointerDown={(e) => onPointerDown(e, e.altKey ? (e.shiftKey ? 'slide' : 'slip') : 'move', clip)}
    >
      {thumbnail && <div className="timeline-clip-thumbs pointer-events-none absolute inset-0" style={{ backgroundImage: `url(${thumbnail})` }} aria-hidden="true" />}
      {clip.kind === 'audio' && clip.assetId && <AudioWaveform assetId={clip.assetId} selected={selected} />}
      <div className="timeline-clip-label pointer-events-none relative z-[1] flex h-full items-center gap-1.5 truncate pl-3 pr-2 font-semibold text-white">
        <span className="timeline-clip-chip"><Icon size={11} strokeWidth={2.4} /></span>
        <span className="truncate">{clip.name}</span>
        {clip.speed !== 1 && <span className="timeline-clip-badge">{clip.speed.toFixed(2).replace(/0$/, '')}×</span>}
      </div>
      {clip.effects.length > 0 && <div className="timeline-effect-edge" aria-hidden="true" />}
      <div className="timeline-handle timeline-handle-l" onPointerDown={(e) => { e.stopPropagation(); onPointerDown(e, 'trimL', clip); }}><i /></div>
      <div className="timeline-handle timeline-handle-r" onPointerDown={(e) => { e.stopPropagation(); onPointerDown(e, 'trimR', clip); }}><i /></div>
    </div>
  );
});

function TransitionBlock({ clip, zoom, onSelect }: { clip: Clip; zoom: number; onSelect: () => void }) {
  if (!clip.transitionIn) return null;
  const preset = TRANSITION_PRESETS.find((item) => item.id === clip.transitionIn?.type);
  const width = Math.max(14, Math.min(clip.transitionIn.durationFrames * zoom, 54));
  return <button type="button" className={`timeline-transition transition-${clip.transitionIn.type}`} style={{ left: clip.start * zoom - width / 2, width }} title={`${preset?.name ?? clip.transitionIn.type} transition · ${((clip.transitionIn.durationFrames ?? 18) / 30).toFixed(1)}s`} aria-label={`Edit ${preset?.name ?? clip.transitionIn.type} transition`} onClick={(event) => { event.stopPropagation(); onSelect(); }}><span className="timeline-transition-in" /></button>;
}

function TransitionAddButton({ frame, zoom, onSelect }: { frame: number; zoom: number; onSelect: () => void }) {
  return <button type="button" className="timeline-transition-add" style={{ left: frame * zoom - 8 }} title="Add a transition between clips" aria-label="Add transition between clips" onClick={(event) => { event.stopPropagation(); onSelect(); window.dispatchEvent(new Event('f4-open-transitions')); }}><span>+</span></button>;
}

function AudioWaveform({ assetId, selected }: { assetId: Id; selected: boolean }) {
  const asset = useEditor((s) => s.history.present.assets[assetId]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [peaks, setPeaks] = useState<number[] | null>(null);

  useEffect(() => {
    let active = true;
    setPeaks(null);
    if (asset) void waveformFor(asset).then((result) => { if (active) setPeaks(result); });
    return () => { active = false; };
  }, [asset]);

  useEffect(() => {
    const cv = canvas.current;
    if (!cv || !peaks?.length) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = selected ? 'rgba(255,255,255,0.95)' : 'rgba(191,208,255,0.78)';
    const middle = cv.height / 2;
    const scale = cv.width / peaks.length;
    peaks.forEach((peak, index) => {
      const h = Math.max(1, peak * middle * 0.92);
      ctx.fillRect(index * scale, middle - h, Math.max(1, scale), h * 2);
    });
  }, [peaks, selected]);

  return <canvas ref={canvas} width={512} height={36} className="timeline-waveform pointer-events-none absolute inset-x-0 top-1/2 h-[78%] w-full -translate-y-1/2" aria-label={peaks ? 'Audio waveform' : 'Loading audio waveform'} />;
}

function LanesMenu({ tracks, clipCounts, onClose }: { tracks: Project['tracks']; clipCounts: Record<string, number>; onClose: () => void }) {
  const { patchTrack, duplicateTrack, deleteTrack, reorderTrack } = useEditor.getState();
  return (
    <>
      <div className="fixed inset-0 z-40" onPointerDown={onClose} aria-hidden="true" />
      <div className="lanes-menu" role="dialog" aria-label="Timeline lanes">
        <div className="lanes-menu-title">Lanes <span>top lane is drawn in front</span></div>
        {tracks.map((track, index) => {
          const Icon = TRACK_ICON[track.kind];
          return (
            <div key={track.id} className="lanes-row">
              <span className={`lanes-chip lanes-chip-${track.kind}`}><Icon size={12} /></span>
              <span className="lanes-name" title={track.name}>{track.name}<small>{clipCounts[track.id] ?? 0} clip{(clipCounts[track.id] ?? 0) === 1 ? '' : 's'}</small></span>
              <button className="btn-icon !h-6 !w-6" aria-label="Move lane up" disabled={index === 0} onClick={() => reorderTrack(track.id, tracks[index - 1]!.id)}><ChevronUp size={12} /></button>
              <button className="btn-icon !h-6 !w-6" aria-label="Move lane down" disabled={index === tracks.length - 1} onClick={() => reorderTrack(track.id, tracks[index + 1]!.id)}><ChevronDown size={12} /></button>
              <button className="btn-icon !h-6 !w-6" aria-pressed={track.locked} aria-label={`${track.locked ? 'Unlock' : 'Lock'} ${track.name}`} onClick={() => patchTrack(track.id, { locked: !track.locked })}>{track.locked ? <Lock size={12} /> : <Unlock size={12} />}</button>
              <button className="btn-icon !h-6 !w-6" aria-pressed={!track.visible} aria-label={`${track.visible ? 'Hide' : 'Show'} ${track.name}`} onClick={() => patchTrack(track.id, { visible: !track.visible })}>{track.visible ? <Eye size={12} /> : <EyeOff size={12} />}</button>
              {(track.kind === 'audio' || track.kind === 'video') && <button className="btn-icon !h-6 !w-6" aria-pressed={track.muted} aria-label={`${track.muted ? 'Unmute' : 'Mute'} ${track.name}`} onClick={() => patchTrack(track.id, { muted: !track.muted })}>{track.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}</button>}
              <button className={`h-6 w-6 rounded text-[10px] font-bold ${track.solo ? 'bg-amber-500/30 text-amber-300' : 'text-zinc-500 hover:bg-ink-600'}`} aria-pressed={track.solo} aria-label={`Solo ${track.name}`} onClick={() => patchTrack(track.id, { solo: !track.solo })}>S</button>
              <button className="btn-icon !h-6 !w-6" aria-label={`Duplicate ${track.name}`} onClick={() => duplicateTrack(track.id)}><Copy size={11} /></button>
              <button className="btn-icon !h-6 !w-6 text-red-300/70 hover:text-red-200" aria-label={`Delete ${track.name}`} onClick={() => deleteTrack(track.id)}><Trash2 size={11} /></button>
            </div>
          );
        })}
      </div>
    </>
  );
}

export function Timeline() {
  const project = useEditor((s) => s.history.present);
  const selection = useEditor((s) => s.selection);
  const zoom = useEditor((s) => s.zoom);
  const snapping = useEditor((s) => s.snapping);
  const magnetic = useEditor((s) => s.magnetic);
  const { setZoom, select, apply, setPlayhead, patchTrack, addTrack } = useEditor.getState();
  const [newTrackKind, setNewTrackKind] = useState<TrackKind>('overlay');
  const [drag, setDrag] = useState<Drag | null>(null);
  const [trackResize, setTrackResize] = useState<TrackResize | null>(null);
  const [lanesOpen, setLanesOpen] = useState(false);
  const dragRef = useRef<Drag | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const fps = project.settings.fps;
  const selectedCount = selection.length;

  const total = Math.max(contentEnd(project) + fps * 10, fps * 30);
  const contentW = HEADER_W + total * zoom;
  const showBlankBackdrop = (project.settings.backgroundDurationFrames ?? 0) > 0 && !Object.values(project.clips).some((clip) => clip.kind === 'video' || clip.kind === 'image');
  const selSet = useMemo(() => new Set(selection), [selection]);

  const trackAtPoint = (x: number, y: number): Id | undefined => {
    for (const el of document.elementsFromPoint(x, y)) {
      const id = (el as HTMLElement).dataset?.trackId;
      if (id) return id;
    }
    return undefined;
  };

  const onClipPointerDown = useCallback((e: React.PointerEvent, mode: DragMode, clip: Clip) => {
    if (e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const st = useEditor.getState();
    let ids = st.selection;
    const isTrim = mode === 'trimL' || mode === 'trimR';
    // grabbing an edge of an already-selected clip keeps the whole selection so every selected clip stretches together
    if (isTrim && st.selection.includes(clip.id)) { /* keep selection */ }
    else if (e.shiftKey || e.ctrlKey || e.metaKey) st.select([clip.id], true);
    else if (!st.selection.includes(clip.id)) st.select([clip.id]);
    ids = useEditor.getState().selection;
    const d: Drag = { mode, id: clip.id, ids: mode === 'move' || (isTrim && ids.includes(clip.id)) ? ids : [clip.id], startX: e.clientX, origStart: clip.start, origEnd: clipEnd(clip), deltaFrames: 0, moved: false };
    dragRef.current = d;
    setDrag(d);
  }, []);

  const onMove = (e: React.PointerEvent) => {
    if (trackResize) {
      setTrackResize({ ...trackResize, height: Math.max(48, Math.min(240, trackResize.baseHeight + e.clientY - trackResize.startY)) });
      return;
    }
    const d = dragRef.current;
    if (!d) return;
    const px = e.clientX - d.startX;
    if (!d.moved && Math.abs(px) < 3) return; // avoid accidental drags on click
    const p = useEditor.getState().project();
    const st = useEditor.getState();
    let delta = Math.round(px / zoom);
    const opts = { thresholdFrames: Math.max(1, Math.round(SNAP_PX / zoom)), playhead: st.playhead, excludeIds: d.ids };
    if (st.snapping && (d.mode === 'move' || d.mode === 'trimL' || d.mode === 'trimR')) {
      if (d.mode === 'move') {
        const r = snapClipStart(p, d.id, d.origStart + delta, opts);
        delta = r.start - d.origStart;
      } else if (d.mode === 'trimL') delta = snapEdge(p, d.origStart + delta, opts) - d.origStart;
      else delta = snapEdge(p, d.origEnd + delta, opts) - d.origEnd;
    }
    const next: Drag = { ...d, deltaFrames: delta, moved: true, trackId: d.mode === 'move' ? trackAtPoint(e.clientX, e.clientY) : undefined };
    dragRef.current = next;
    setDrag(next);
  };

  const onUp = () => {
    if (trackResize) {
      patchTrack(trackResize.id, { height: Math.round(trackResize.height) });
      setTrackResize(null);
      return;
    }
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!d || !d.moved) return;
    if (d.mode === 'trimL' || d.mode === 'trimR') {
      apply((p) => {
        let next = p;
        let changed = false;
        // the dragged clip first, then every other selected clip by the same amount (each clamped to its own limits)
        const order = [d.id, ...d.ids.filter((id) => id !== d.id)];
        for (const id of order) {
          const c = next.clips[id];
          if (!c || c.locked) continue;
          const r = d.mode === 'trimL' ? trimLeft(next, id, Math.min(clipEnd(c) - 1, c.start + d.deltaFrames)) : trimRight(next, id, Math.max(c.start + 1, clipEnd(c) + d.deltaFrames));
          if (r.ok) { next = r.project; changed = true; }
        }
        return changed ? { ok: true, project: next } : { ok: false, project: p, reason: 'Cannot trim' };
      });
    }
    else if (d.mode === 'slip') apply((p) => slipClip(p, d.id, d.deltaFrames));
    else if (d.mode === 'slide') apply((p) => slideClip(p, d.id, d.deltaFrames));
    else {
      apply((p) => {
        const lead = p.clips[d.id];
        if (!lead) return { ok: false, project: p, reason: 'Clip not found' };
        const minStart = Math.min(...d.ids.map((id) => p.clips[id]?.start ?? 0));
        const delta = Math.max(d.deltaFrames, -minStart);
        const targetTrack = d.trackId && d.trackId !== lead.trackId ? d.trackId : undefined;
        return moveAcrossLanes(p, d.ids, d.id, delta, targetTrack);
      });
    }
  };

  const scrub = (e: React.PointerEvent) => {
    const rect = body.current?.getBoundingClientRect();
    const scroll = body.current?.scrollLeft ?? 0;
    if (!rect) return;
    setPlayhead((e.clientX - rect.left + scroll - HEADER_W) / zoom);
  };

  const zoomAtPointer = (e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const rect = body.current?.getBoundingClientRect();
    if (!rect || !body.current) return;
    const frameAtPointer = Math.max(0, (e.clientX - rect.left + body.current.scrollLeft - HEADER_W) / zoom);
    const nextZoom = Math.min(40, Math.max(0.2, zoom * (e.deltaY > 0 ? 0.86 : 1.16)));
    setZoom(nextZoom);
    requestAnimationFrame(() => {
      if (body.current) body.current.scrollLeft = Math.max(0, HEADER_W + frameAtPointer * nextZoom - (e.clientX - rect.left));
    });
  };

  const ticks = useMemo(() => {
    const secPx = fps * zoom;
    const stepSec = [1, 2, 5, 10, 15, 30, 60, 120, 300].find((s) => s * secPx >= 70) ?? 600;
    const out: Array<{ x: number; label: string }> = [];
    for (let s = 0; s * fps <= total; s += stepSec) out.push({ x: s * fps * zoom, label: formatTimecode(s * fps, fps).slice(3, 8) });
    return out;
  }, [fps, zoom, total]);

  /** Zoom so the whole project (plus a little breathing room) fits the visible timeline. */
  const fitToProject = useCallback(() => {
    const width = body.current?.clientWidth ?? 0;
    const frames = Math.max(projectDuration(useEditor.getState().project()), fps * 2);
    if (width > HEADER_W + 80) useEditor.getState().setZoom((width - HEADER_W - 48) / frames);
    if (body.current) body.current.scrollLeft = 0;
  }, [fps]);
  useEffect(() => {
    window.addEventListener('f4-zoom-fit', fitToProject);
    return () => window.removeEventListener('f4-zoom-fit', fitToProject);
  }, [fitToProject]);

  return (
    <div className="timeline-root flex h-full min-h-0 flex-col bg-ink-900">
      <div className="timeline-toolbar flex h-12 shrink-0 items-center gap-1.5 border-b border-ink-600/70 bg-ink-850 px-3">
        <div className="mr-2 flex min-w-[132px] items-center gap-2 border-r border-ink-600/70 pr-3">
          <span className="text-[11px] font-semibold text-zinc-200">Timeline</span>
        </div>
        <button className="btn-icon" disabled={!selectedCount} aria-label="Split selected at playhead" title="Split at playhead (S)" onClick={() => useEditor.getState().splitSelection()}><Scissors size={14} /></button>
        <button className="btn-icon" disabled={!selectedCount} aria-label="Duplicate selected clips" title="Duplicate selected (Ctrl/Cmd+D)" onClick={() => useEditor.getState().duplicateSelection()}><Copy size={14} /></button>
        <button className="btn-icon" disabled={!selectedCount} aria-label="Copy selected clips" title="Copy selected (Ctrl/Cmd+C)" onClick={() => useEditor.getState().copySelection()}><Clipboard size={14} /></button>
        <button className="btn-icon" disabled={!selectedCount} aria-label="Delete selected clips" title="Delete selected (Delete)" onClick={() => useEditor.getState().deleteSelection()}><Trash2 size={14} /></button>
        <div className="mx-1 h-5 w-px bg-ink-600" />
        <button className="btn-icon" aria-pressed={snapping} aria-label="Snapping" title="Snapping" onClick={() => useEditor.setState({ snapping: !snapping })}><Magnet size={14} /></button>
        <button className={`inline-flex h-7 items-center rounded px-2 text-[11px] ${magnetic ? 'bg-violet-600/25 text-violet-300' : 'text-zinc-400 hover:bg-ink-600'}`} aria-pressed={magnetic} title="Magnetic timeline: keeps video tracks free of gaps" onClick={() => useEditor.setState({ magnetic: !magnetic })}>Magnetic</button>
        <div className="relative">
          <button className={`inline-flex h-7 items-center gap-1 rounded px-2 text-[11px] ${lanesOpen ? 'bg-violet-600/25 text-violet-300' : 'text-zinc-400 hover:bg-ink-600'}`} aria-expanded={lanesOpen} title="Manage lanes: show, hide, lock, mute, solo, reorder" onClick={() => setLanesOpen((v) => !v)}><Layers3 size={13} /><span className="hidden sm:inline">Lanes</span></button>
          {lanesOpen && <LanesMenu tracks={project.tracks} clipCounts={Object.fromEntries(project.tracks.map((t) => [t.id, clipsOnTrack(project, t.id).length]))} onClose={() => setLanesOpen(false)} />}
        </div>
        <div className="ml-1 flex items-center gap-1 rounded border border-ink-600 bg-ink-900 px-1" title="Add a dedicated timeline lane">
          <select aria-label="New track type" className="h-6 max-w-20 bg-transparent text-[10px] text-zinc-300 outline-none" value={newTrackKind} onChange={(event) => setNewTrackKind(event.target.value as TrackKind)}>
            <option value="video">Video</option><option value="image">Image</option><option value="text">Text</option><option value="overlay">Overlay</option><option value="audio">Audio</option><option value="effect">Effects</option>
          </select>
          <button className="btn-icon !h-6 !w-6" aria-label={`Add ${newTrackKind} track`} title={`Add ${newTrackKind} track`} onClick={() => addTrack(newTrackKind)}><Plus size={13} /></button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden font-mono text-[10px] text-zinc-500 xl:inline">{selectedCount ? `${selectedCount} selected` : 'No selection'}</span>
          <button className="btn-icon" aria-label="Zoom out" title="Zoom out" onClick={() => setZoom(zoom / 1.4)}><ZoomOut size={14} /></button>
          <input type="range" aria-label="Timeline zoom" className="w-28 accent-violet-500" min={Math.log(0.05)} max={Math.log(50)} step={0.01} value={Math.log(zoom)} onChange={(e) => setZoom(Math.exp(Number(e.target.value)))} />
          <span className="w-10 text-right font-mono text-[10px] text-zinc-500">{zoom.toFixed(1)}×</span>
          <button className="btn-icon" aria-label="Zoom in" title="Zoom in" onClick={() => setZoom(zoom * 1.4)}><ZoomIn size={14} /></button>
          <button className="btn-icon" aria-label="Fit project to timeline" title="Zoom to fit (F)" onClick={fitToProject}><Maximize size={14} /></button>
        </div>
      </div>

      <div ref={body} className="timeline-surface relative min-h-0 flex-1 overflow-auto" onWheel={zoomAtPointer} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <div className="relative" style={{ width: contentW, minHeight: '100%' }}>
          {/* Ruler */}
          <div className="timeline-ruler sticky top-0 z-20 flex" style={{ height: RULER_H }}>
            <div className="relative flex-1 cursor-pointer" onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); scrub(e); }} onPointerMove={(e) => { if (e.buttons & 1) scrub(e); }}>
              {ticks.map((t) => (
                <div key={t.x} className="timeline-tick absolute top-0 h-full pl-1.5 text-[10px] leading-[28px]" style={{ left: t.x }}>{t.label}</div>
              ))}
              {project.markers.map((m) => <div key={m.id} title={m.label || 'Marker'} className="absolute bottom-0 h-2 w-2 -translate-x-1 rotate-45" style={{ left: m.frame * zoom, background: m.color }} />)}
            </div>
          </div>

          {/* Tracks */}
          {project.tracks.map((track) => {
            const clips = clipsOnTrack(project, track.id);
            const orderedClips = [...clips].sort((a, b) => a.start - b.start);
            const dropTarget = drag?.mode === 'move' && drag.moved && drag.trackId === track.id;
            const compatible = drag ? trackAccepts(track.kind, project.clips[drag.id]?.kind ?? 'video') : true;
            return (
              <div key={track.id} className={`timeline-track timeline-track-${track.kind} flex border-b border-transparent`} style={{ height: Math.max(40, trackResize?.id === track.id ? trackResize.height : Math.min(track.height, 56)) }}>
                <div
                  data-track-id={track.id}
                  className={`timeline-lane relative flex-1 ${dropTarget ? (compatible ? 'bg-violet-500/10' : 'bg-red-500/10') : ''} ${track.visible ? '' : 'opacity-40'}`}
                  onPointerDown={(e) => { if (e.target === e.currentTarget) { select([]); scrub(e); } }}
                >
                  {showBlankBackdrop && track === project.tracks[0] && <div className="timeline-blank-backdrop pointer-events-none absolute z-[1]" style={{ left: 0, width: (project.settings.backgroundDurationFrames ?? 0) * zoom }}><span>BLACK OPENING · 5s</span></div>}
                  {orderedClips.slice(1).map((clip, index) => { const previous = orderedClips[index]!; const visual = ['video', 'image'].includes(previous.kind) && ['video', 'image'].includes(clip.kind); const touching = clip.start >= clipEnd(previous); return visual && touching && !clip.transitionIn ? <TransitionAddButton key={`transition-add-${clip.id}`} frame={clip.start} zoom={zoom} onSelect={() => select([clip.id])} /> : null; })}
                  {clips.filter((clip) => Boolean(clip.transitionIn) && ['video', 'image', 'visualizer'].includes(clip.kind)).map((clip) => <TransitionBlock key={`transition-${clip.id}`} clip={clip} zoom={zoom} onSelect={() => select([clip.id])} />)}
                  {clips.map((c) => {
                    const inDrag = drag?.moved && drag.ids.includes(c.id);
                    const isTrim = inDrag && (drag.mode === 'trimL' || drag.mode === 'trimR');
                    let startPx: number | undefined;
                    let widthPx: number | undefined;
                    if (isTrim && drag) {
                      const ns = drag.mode === 'trimL' ? Math.min(c.start + c.duration - 1, c.start + drag.deltaFrames) : c.start;
                      const ne = drag.mode === 'trimR' ? Math.max(c.start + 1, clipEnd(c) + drag.deltaFrames) : clipEnd(c);
                      startPx = ns * zoom;
                      widthPx = (ne - ns) * zoom;
                    }
                    return (
                      <ClipBlock key={c.id} clip={c} zoom={zoom} selected={selSet.has(c.id)} dragOffset={inDrag && drag.mode === 'move' ? drag.deltaFrames : 0} dragStartPx={startPx} dragWidthPx={widthPx} onPointerDown={onClipPointerDown} />
                    );
                  })}
                  <div className="timeline-lane-resize" role="separator" aria-label={`Resize ${track.name}`} onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); setTrackResize({ id: track.id, startY: event.clientY, baseHeight: Math.min(track.height, 56), height: Math.min(track.height, 56) }); }} />
                </div>
              </div>
            );
          })}
          <EndMarker zoom={zoom} />
          <Playhead zoom={zoom} />
        </div>
      </div>
    </div>
  );
}

function snapEdge(p: Parameters<typeof snapClipStart>[0], frame: number, opts: Parameters<typeof snapClipStart>[3]): number {
  let best = frame;
  let bestD = (opts.thresholdFrames ?? 0) + 1;
  const skip = new Set(opts.excludeIds ?? []);
  const pts = [0, opts.playhead ?? 0, ...p.markers.map((m) => m.frame)];
  for (const c of Object.values(p.clips)) if (!skip.has(c.id)) pts.push(c.start, clipEnd(c));
  for (const pt of pts) {
    const d = Math.abs(pt - frame);
    if (d < bestD) { best = pt; bestD = d; }
  }
  return best;
}

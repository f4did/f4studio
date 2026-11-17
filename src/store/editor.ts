import { create } from 'zustand';
import {
  addClip, addMarker, canRedo, canUndo, closeGaps, commit, copyClips, createClip, createHistory,
  createProject, createTrack, duplicateClips, expandSelectionToGroups, groupClips, pasteClips,
  projectDuration, redo, removeClips, rippleDelete, secondsToFrames, splitAtPlayhead, undo,
  ungroupClips, updateClip, defaultVisualizer, newId, type Asset, type Clip, type ClipPatch, type EditResult, type HistoryState,
  type Id, type Project, type TrackKind, type VisualizerType, addSubtitleCues, parseSrt, projectSubtitles, subtitlesToSrt, transcriptToCues,
} from '../core';
import { createTemplateProject, isProgressVisualizer } from '../core';
import { trackAccepts } from '../core';
import { clipsOnTrack } from '../core';
import { loadProjectVersion } from '../engine/db';

function placementTrack(p: Project, kind: TrackKind, clipKind: Parameters<typeof trackAccepts>[1], start: number | undefined, duration: number): { track: Project['tracks'][number]; added?: Project['tracks'][number] } | undefined {
  const compatible = p.tracks.filter((track) => track.kind === kind && !track.locked && trackAccepts(track.kind, clipKind));
  const stackRows = kind === 'text' || kind === 'overlay' || kind === 'effect';
  const free = compatible.find((track) => {
    if (start === undefined) return true;
    return !stackRows || !clipsOnTrack(p, track.id).some((clip) => start < clip.start + clip.duration && start + duration > clip.start);
  });
  if (free) return { track: free };
  const added = createTrack(kind, p.tracks.filter((track) => track.kind === kind).length + 1);
  return { track: added, added };
}

function addWithPlacement(p: Project, clip: Clip, added?: Project['tracks'][number]): Parameters<typeof addClip>[1] extends never ? never : ReturnType<typeof addClip> {
  if (!added) return addClip(p, clip);
  const tracks = [...p.tracks];
  // Overlay / text / effect lanes composite ABOVE footage, so a newly created one goes to the top.
  if (added.kind === 'overlay' || added.kind === 'text' || added.kind === 'effect') tracks.unshift(added);
  else tracks.push(added);
  return addClip({ ...p, tracks }, clip);
}

interface EditorState {
  history: HistoryState<Project>;
  selection: Id[];
  playhead: number; // frames
  playing: boolean;
  zoom: number; // pixels per frame
  snapping: boolean;
  magnetic: boolean;
  clipboard: Clip[];
  message: string | null;
  saveStatus: 'saved' | 'saving' | 'unsaved' | 'error';
  previewQuality: 'full' | 'half' | 'quarter';

  project: () => Project;
  apply: (fn: (p: Project) => EditResult) => boolean;
  /** Replace project without touching history (used when loading from disk). */
  loadProject: (p: Project) => void;
  setPlayhead: (f: number) => void;
  setPlaying: (v: boolean) => void;
  setZoom: (z: number) => void;
  select: (ids: Id[], additive?: boolean) => void;
  notify: (m: string | null) => void;
  setSaveStatus: (s: EditorState['saveStatus']) => void;
  setPreviewQuality: (quality: EditorState['previewQuality']) => void;

  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  renameProject: (name: string) => void;
  registerAsset: (a: Asset) => void;
  addAssetToTimeline: (assetId: Id, at?: number, options?: { newLayer?: boolean; trackKind?: TrackKind }) => void;
  addText: (text?: string) => void;
  addTimer: (mode: 'stopwatch' | 'countdown') => void;
  addCaption: (text: string, start?: number, duration?: number) => void;
  addVisualizer: (type?: VisualizerType) => void;
  applyTemplate: (templateId: string) => Promise<void>;
  importSrt: (input: string) => void;
  importTranscript: (input: string) => void;
  exportSrt: () => string;
  restoreVersion: (versionId: number) => Promise<void>;
  addTrack: (kind: TrackKind) => void;
  duplicateTrack: (id: Id) => void;
  deleteTrack: (id: Id) => void;
  patchTrack: (id: Id, patch: Partial<Project['tracks'][number]>) => void;
  reorderTrack: (id: Id, beforeId: Id) => void;
  patchClip: (id: Id, patch: ClipPatch) => void;

  deleteSelection: (ripple?: boolean) => void;
  splitSelection: () => void;
  duplicateSelection: () => void;
  copySelection: () => void;
  paste: () => void;
  group: () => void;
  ungroup: () => void;
  placeMarker: () => void;
  placeMarkers: (frames: number[], label?: string, color?: string) => void;
}

export const useEditor = create<EditorState>((set, get) => {
  const apply = (fn: (p: Project) => EditResult): boolean => {
    const h = get().history;
    const r = fn(h.present);
    if (!r.ok) {
      set({ message: r.reason });
      return false;
    }
    let next = r.project;
    // Magnetic timeline: after any edit, re-pack tracks that were already gapless-from-zero.
    if (get().magnetic) {
      for (const t of next.tracks) {
        if (t.kind !== 'video') continue; // magnetic applies to the main video tracks only
        const m = closeGaps(next, t.id);
        if (m.ok) next = m.project;
      }
    }
    // Drop selected ids that no longer exist.
    const selection = get().selection.filter((id) => next.clips[id]);
    set({ history: commit(h, next), selection, saveStatus: 'unsaved', message: null });
    return true;
  };

  return {
    history: createHistory(createProject()),
    selection: [],
    playhead: 0,
    playing: false,
    zoom: 3,
    snapping: true,
    magnetic: false,
    clipboard: [],
    message: null,
    saveStatus: 'saved',
    previewQuality: 'full',

    project: () => get().history.present,
    apply,
    loadProject: (p) => set({ history: createHistory(p), selection: [], playhead: 0, playing: false, saveStatus: 'saved' }),
    setPlayhead: (f) => set({ playhead: Math.max(0, Math.round(f)) }),
    setPlaying: (v) => set({ playing: v }),
    setZoom: (z) => set({ zoom: Math.min(50, Math.max(0.05, z)) }),
    select: (ids, additive) =>
      set((s) => {
        const expanded = expandSelectionToGroups(s.history.present, ids);
        if (!additive) return { selection: expanded };
        const cur = new Set(s.selection);
        for (const id of expanded) (cur.has(id) ? cur.delete(id) : cur.add(id));
        return { selection: [...cur] };
      }),
    notify: (m) => set({ message: m }),
    setSaveStatus: (s) => set({ saveStatus: s }),
    setPreviewQuality: (previewQuality) => set({ previewQuality }),

    undo: () => set((s) => ({ history: undo(s.history), saveStatus: 'unsaved', selection: [] })),
    redo: () => set((s) => ({ history: redo(s.history), saveStatus: 'unsaved', selection: [] })),
    canUndo: () => canUndo(get().history),
    canRedo: () => canRedo(get().history),

    renameProject: (name) => apply((p) => ({ ok: true, project: { ...p, name: name.trim() || 'Untitled project', updatedAt: Date.now() } })),
    registerAsset: (a) => apply((p) => ({ ok: true, project: { ...p, assets: { ...p.assets, [a.id]: a } } })),

    addAssetToTimeline: (assetId, at, options) => {
      const p = get().project();
      const a = p.assets[assetId];
      if (!a) return;
      const fps = p.settings.fps;
      const kind = a.kind;
      const trackKind: TrackKind = options?.trackKind ?? kind;
      const duration = Math.max(1, secondsToFrames(a.durationSec, fps));
      const placed = options?.newLayer
        ? (() => { const added = createTrack(trackKind, p.tracks.filter((track) => track.kind === trackKind).length + 1); return { track: added, added }; })()
        : placementTrack(p, trackKind, kind, at ?? 0, duration);
      const track = placed?.track;
      if (!track) return get().notify(`No unlocked ${kind} track available.`);
      const targetTrack = track;
      const start = at ?? Math.max(0, ...clipsOnTrack(p, targetTrack.id).map((c) => c.start + c.duration));
      const clip = createClip({
        kind,
        trackId: targetTrack.id,
        assetId: a.id,
        name: a.name,
        start,
        duration,
      });
      if (apply((q) => addWithPlacement(q, clip, placed?.added))) set({ selection: [clip.id] });
    },

    addText: (text = 'Your text here') => {
      const p = get().project();
      const placed = placementTrack(p, 'text', 'text', get().playhead, p.settings.fps * 4);
      if (!placed) return get().notify('No unlocked text track available.');
      const track = placed.track;
      const clip = createClip({
        kind: 'text',
        trackId: track.id,
        name: 'Text',
        start: get().playhead,
        duration: p.settings.fps * 4,
        text: {
          text,
          style: { fontFamily: 'Inter, sans-serif', fontSize: 72, fontWeight: 700, letterSpacing: 0, lineHeight: 1.15, align: 'center', color: '#ffffff' },
        },
      });
      if (apply((q) => addWithPlacement(q, clip, placed.added))) set({ selection: [clip.id] });
    },
    addTimer: (mode) => {
      const p = get().project();
      const track = p.tracks.find((t) => t.kind === 'text' && !t.locked);
      if (!track) return get().notify('No unlocked text track available for timers.');
      const clip = createClip({ kind: 'text', trackId: track.id, name: mode === 'stopwatch' ? 'Stopwatch' : 'Countdown', start: get().playhead, duration: Math.max(p.settings.fps * 8, projectDuration(p) - get().playhead), text: { text: '00:00', timerMode: mode, style: { fontFamily: 'Inter, sans-serif', fontSize: 96, fontWeight: 800, letterSpacing: 2, lineHeight: 1, align: 'center', color: '#ffffff', gradient: { from: '#ffffff', to: '#22d3ee', angle: 90 }, shadow: { color: '#7c3aed', blur: 24, offsetX: 0, offsetY: 0 } } } });
      if (apply((q) => addClip(q, clip))) set({ selection: [clip.id] });
    },
    addCaption: (text, start, duration) => {
      const p = get().project();
      const value = text.trim();
      if (!value) return;
      const startFrame = Math.max(0, Math.round(start ?? get().playhead));
      const durationFrames = Math.max(1, Math.round(duration ?? p.settings.fps * 2));
      const placed = placementTrack(p, 'text', 'text', startFrame, durationFrames);
      if (!placed) return get().notify('No unlocked text track available for captions.');
      const track = placed.track;
      const clip = createClip({
        kind: 'text',
        trackId: track.id,
        name: 'Auto caption',
        start: startFrame,
        duration: durationFrames,
        text: {
          text: value,
          style: { fontFamily: 'Inter, sans-serif', fontSize: 54, fontWeight: 700, letterSpacing: 0, lineHeight: 1.1, align: 'center', color: '#ffffff', background: { color: '#000000', padding: 12, radius: 8 } },
        },
      });
      if (apply((q) => addWithPlacement(q, clip, placed.added))) set({ selection: [clip.id] });
    },

    addVisualizer: (type = 'spectrum') => {
      const p = get().project();
      const start = get().playhead;
      const duration = Math.max(p.settings.fps * 8, projectDuration(p) - start);
      const placed = placementTrack(p, 'overlay', 'visualizer', start, duration);
      if (!placed) return get().notify('No unlocked overlay track available.');
      const clip = createClip({ kind: 'visualizer', trackId: placed.track.id, name: isProgressVisualizer(type) ? 'Progress bar' : 'Audio visualizer', start, duration, visualizer: defaultVisualizer(type) });
      if (apply((q) => addWithPlacement(q, clip, placed.added))) set({ selection: [clip.id] });
    },

    applyTemplate: async (templateId) => {
      const project = createTemplateProject(templateId);
      set({ history: createHistory(project), selection: [], playhead: 0, playing: false, saveStatus: 'unsaved', message: `Building ${project.name}…` });
      try {
        const { enrichTemplateProject } = await import('../engine/templateBuilder');
        const full = await enrichTemplateProject(project, templateId);
        if (get().project().id !== project.id) return;
        set({ history: createHistory(full), saveStatus: 'unsaved', message: `${project.name} is ready — music, backdrop and animations included.` });
      } catch (error) {
        set({ message: `${project.name} opened without its media: ${error instanceof Error ? error.message : 'generation failed'}.` });
      }
    },

    importSrt: (input) => {
      try {
        const cues = parseSrt(input, get().project().settings.fps);
        const result = addSubtitleCues(get().project(), cues);
        if (!result.ok) return set({ message: result.reason });
        const h = get().history;
        set({ history: commit(h, { ...result.project, updatedAt: Date.now() }), saveStatus: 'unsaved', message: `Imported ${result.added} subtitle cue${result.added === 1 ? '' : 's'}.` });
      } catch (error) {
        set({ message: error instanceof Error ? error.message : 'Could not parse SRT file.' });
      }
    },
    importTranscript: (input) => {
      const p = get().project();
      const duration = Math.max(1, ...Object.values(p.clips).map((clip) => clip.start + clip.duration));
      const cues = transcriptToCues(input, p.settings.fps, duration);
      const result = addSubtitleCues(p, cues);
      if (!result.ok) return set({ message: result.reason });
      const h = get().history;
      set({ history: commit(h, { ...result.project, updatedAt: Date.now() }), saveStatus: 'unsaved', message: `Timed ${result.added} transcript cue${result.added === 1 ? '' : 's'}.` });
    },
    exportSrt: () => subtitlesToSrt(projectSubtitles(get().project()), get().project().settings.fps),
    restoreVersion: async (versionId) => {
      const project = await loadProjectVersion(versionId);
      if (!project) return set({ message: 'That project version is no longer available.' });
      set({ history: createHistory(project), selection: [], playhead: 0, playing: false, saveStatus: 'unsaved', message: 'Restored project version.' });
    },

    addTrack: (kind) =>
      apply((p) => {
        const n = p.tracks.filter((t) => t.kind === kind).length + 1;
        return { ok: true, project: { ...p, tracks: [...p.tracks, createTrack(kind, n)], updatedAt: Date.now() } };
      }),
    duplicateTrack: (id) => {
      let newIds: Id[] = [];
      const done = apply((p) => {
        const source = p.tracks.find((track) => track.id === id);
        if (!source) return { ok: false, project: p, reason: 'Track not found.' };
        const copy = createTrack(source.kind, p.tracks.filter((track) => track.kind === source.kind).length + 1);
        const track = { ...copy, name: `${source.name} copy`, height: source.height, volume: source.volume, visible: source.visible, muted: source.muted, solo: false };
        const clips = { ...p.clips };
        for (const clip of Object.values(p.clips).filter((item) => item.trackId === id)) {
          const clone: Clip = { ...clip, id: newId('clip'), trackId: track.id, groupId: undefined };
          clips[clone.id] = clone;
          newIds.push(clone.id);
        }
        const index = p.tracks.findIndex((item) => item.id === id);
        const tracks = [...p.tracks];
        tracks.splice(index + 1, 0, track);
        return { ok: true, project: { ...p, tracks, clips, updatedAt: Date.now() } };
      });
      if (done && newIds.length) set({ selection: newIds });
    },
    deleteTrack: (id) => apply((p) => {
      if (p.tracks.length <= 1) return { ok: false, project: p, reason: 'The project must keep at least one track.' };
      const track = p.tracks.find((item) => item.id === id);
      if (!track) return { ok: false, project: p, reason: 'Track not found.' };
      const clips = Object.values(p.clips).filter((clip) => clip.trackId === id);
      if (clips.some((clip) => clip.locked)) return { ok: false, project: p, reason: 'Unlock clips on this track before deleting it.' };
      const nextClips = { ...p.clips };
      for (const clip of clips) delete nextClips[clip.id];
      return { ok: true, project: { ...p, tracks: p.tracks.filter((item) => item.id !== id), clips: nextClips, updatedAt: Date.now() } };
    }),
    patchTrack: (id, patch) =>
      apply((p) => ({ ok: true, project: { ...p, tracks: p.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)), updatedAt: Date.now() } })),
    reorderTrack: (id, beforeId) => apply((p) => {
      if (id === beforeId) return { ok: false, project: p, reason: 'Track is already in that position.' };
      const from = p.tracks.findIndex((track) => track.id === id);
      const to = p.tracks.findIndex((track) => track.id === beforeId);
      if (from < 0 || to < 0) return { ok: false, project: p, reason: 'Track not found.' };
      const tracks = [...p.tracks];
      const [moved] = tracks.splice(from, 1);
      if (!moved) return { ok: false, project: p, reason: 'Track not found.' };
      tracks.splice(tracks.findIndex((track) => track.id === beforeId), 0, moved);
      return { ok: true, project: { ...p, tracks, updatedAt: Date.now() } };
    }),
    patchClip: (id, patch) => void apply((p) => updateClip(p, id, patch)),

    deleteSelection: (ripple) => {
      const ids = get().selection;
      if (ids.length) apply((p) => (ripple ? rippleDelete(p, ids) : removeClips(p, ids)));
    },
    splitSelection: () => {
      const { selection, playhead } = get();
      apply((p) => splitAtPlayhead(p, playhead, selection.length ? selection : undefined));
    },
    duplicateSelection: () => {
      const ids = get().selection;
      if (!ids.length) return;
      let newIds: Id[] | undefined;
      const done = apply((p) => {
        const r = duplicateClips(p, ids);
        newIds = r.newIds;
        return r;
      });
      if (done && newIds) set({ selection: newIds });
    },
    copySelection: () => set({ clipboard: copyClips(get().project(), get().selection) }),
    paste: () => {
      const { clipboard, playhead } = get();
      let newIds: Id[] | undefined;
      const done = apply((p) => {
        const r = pasteClips(p, clipboard, playhead);
        newIds = r.newIds;
        return r;
      });
      if (done && newIds) set({ selection: newIds });
    },
    group: () => void apply((p) => groupClips(p, get().selection)),
    ungroup: () => void apply((p) => ungroupClips(p, get().selection)),
    placeMarker: () => void apply((p) => addMarker(p, get().playhead)),
    placeMarkers: (frames, label = 'Marker', color = '#a78bfa') => void apply((p) => {
      let next = p;
      for (const frame of frames) {
        const result = addMarker(next, Math.max(0, Math.round(frame)), label, color);
        if (result.ok) next = result.project;
      }
      return next === p ? { ok: false, project: p, reason: 'Those markers already exist.' } : { ok: true, project: next };
    }),
  };
});

export const selectDuration = (s: EditorState) => projectDuration(s.history.present);

import { useEffect, useRef, useState } from 'react';
import { AudioLines, Film, Layers3, Library, Sparkles, Type, Video, WandSparkles, X } from 'lucide-react';
import { createProject, PROJECT_TEMPLATES } from '../core';
import { useEditor } from '../store/editor';
import { db, debounce, latestProject, loadProject, saveProject } from '../engine/db';
import { engine } from '../engine/playback';
import { releaseAllUrls } from '../engine/media';
import { Resizer } from './common/Resizer';
import { TopBar } from './layout/TopBar';
import { MediaPanel } from './panels/MediaPanel';
import { AudioStudioPage } from './panels/AudioStudioPage';
import { TextPanel } from './panels/TextPanel';
import { TemplatesPanel } from './panels/TemplatesPanel';
import { Preview } from './preview/Preview';
import { Inspector } from './inspector/Inspector';
import { Timeline } from './timeline/Timeline';
import { CommandPalette, type ToolId } from './common/CommandPalette';
import { RecordPanel } from './panels/RecordPanel';
import { LibraryPanel } from './panels/LibraryPanel';
import { handleLaunchFiles } from '../engine/pwa';
import { openProjectFile } from '../engine/projectio';
import { BackgroundsPanel, EffectsPanel, ShapesPanel, TransitionsPanel } from './panels/CreativePanels';

type Tool = ToolId;
const TOOLS: Array<{ id: Tool; label: string; icon: typeof Film }> = [
  { id: 'media', label: 'Your media', icon: Film },
  { id: 'record', label: 'Record', icon: Video },
  { id: 'audio', label: 'Audio', icon: AudioLines },
  { id: 'library', label: 'Library', icon: Library },
  { id: 'text', label: 'Text', icon: Type },
  { id: 'templates', label: 'Templates', icon: Layers3 },
  { id: 'transitions', label: 'Transitions', icon: WandSparkles },
  { id: 'effects', label: 'Effects', icon: Sparkles },
];
/** Panels that are reachable from the Library / command palette but have no rail button of their own. */
const SECONDARY_TOOLS: Tool[] = ['shapes', 'backgrounds'];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function ToolStatusPanel({ tool }: { tool: Exclude<Tool, 'media' | 'audio' | 'text' | 'record' | 'library'> }) {
  const label = TOOLS.find((item) => item.id === tool)?.label ?? tool;
  if (tool === 'shapes') return <ShapesPanel />;
  if (tool === 'transitions') return <TransitionsPanel />;
  if (tool === 'effects') return <EffectsPanel />;
  if (tool === 'backgrounds') return <BackgroundsPanel />;
  return <div className="p-4 text-xs text-zinc-500">{label} is not available yet.</div>;
}

function useKeyboard(onCommandPalette: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onCommandPalette();
        return;
      }
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return;
      const s = useEditor.getState();
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      let handled = true;
      if (k === ' ') (s.playing ? engine.pause() : engine.play());
      else if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(k) && s.selection.length) {
        const step = e.shiftKey ? 0.05 : 0.01;
        const dx = k === 'arrowleft' ? -step : k === 'arrowright' ? step : 0;
        const dy = k === 'arrowup' ? -step : k === 'arrowdown' ? step : 0;
        for (const id of s.selection) {
          const clip = s.project().clips[id];
          if (!clip || clip.kind === 'audio' || clip.kind === 'effect' || clip.kind === 'visualizer' || clip.locked) continue;
          s.patchClip(id, { transform: { ...clip.transform, x: Math.max(-1, Math.min(1, clip.transform.x + dx)), y: Math.max(-1, Math.min(1, clip.transform.y + dy)) } });
        }
      } else if (k === 'arrowleft') s.setPlayhead(s.playhead - 1);
      else if (k === 'arrowright') s.setPlayhead(s.playhead + 1);
      else if (k === 'arrowup') s.setPlayhead(s.playhead - 1);
      else if (k === 'arrowdown') s.setPlayhead(s.playhead + 1);
      else if (k === 'home') s.setPlayhead(0);
      else if (k === 'end') s.setPlayhead(Math.max(0, ...Object.values(s.project().clips).map((c) => c.start + c.duration)));
      else if (k === 'k' && !mod) (s.playing ? engine.pause() : engine.play());
      else if (k === 'j' && !mod) s.setPlayhead(s.playhead - s.project().settings.fps);
      else if (k === 'l' && !mod) s.setPlayhead(s.playhead + s.project().settings.fps);
      else if ((k === '[' || k === ']') && !mod) {
        const edges = [...new Set(Object.values(s.project().clips).flatMap((c) => [c.start, c.start + c.duration]))].sort((a, b) => a - b);
        const target = k === ']' ? edges.find((f) => f > s.playhead) : [...edges].reverse().find((f) => f < s.playhead);
        if (target !== undefined) s.setPlayhead(target);
      }
      else if (k === 'f' && !mod) window.dispatchEvent(new Event('f4-zoom-fit'));
      else if (mod && k === 'e') window.dispatchEvent(new Event('f4-open-export-presets'));
      else if (mod && k === 's') { if (e.shiftKey) window.dispatchEvent(new Event('f4-save-project-file')); else s.notify('Saved — your project autosaves to this browser as you edit.'); }
      else if (k === 's' && !mod) s.splitSelection();
      else if (k === 'delete' || k === 'backspace') s.deleteSelection(e.shiftKey);
      else if (mod && k === 'd') s.duplicateSelection();
      else if (mod && k === 'c') s.copySelection();
      else if (mod && k === 'v') s.paste();
      else if (mod && k === 'g') (e.shiftKey ? s.ungroup() : s.group());
      else if (mod && k === 'z') (e.shiftKey ? s.redo() : s.undo());
      else if (mod && k === 'y') s.redo();
      else if (k === 'm' && !mod) s.placeMarker();
      else if (k === '=' || k === '+') s.setZoom(s.zoom * 1.25);
      else if (k === '-') s.setZoom(s.zoom / 1.25);
      else handled = false;
      if (handled) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCommandPalette]);
}

/** Load the most recent project on start; autosave (debounced) on every committed change. */
function usePersistence(): { ready: boolean; hasSavedProject: boolean } {
  const present = useEditor((s) => s.history.present);
  const [state, setState] = useState({ ready: false, hasSavedProject: false });
  const loaded = useRef(false);
  const save = useRef(
    debounce((p: ReturnType<typeof createProject>) => {
      useEditor.getState().setSaveStatus('saving');
      saveProject(p).then(
        () => useEditor.getState().setSaveStatus('saved'),
        () => useEditor.getState().setSaveStatus('error'),
      );
    }, 800),
  );

  useEffect(() => {
    void latestProject().then((p) => {
      if (p) useEditor.getState().loadProject(p);
      setState({ ready: true, hasSavedProject: Boolean(p) });
      loaded.current = true;
    }).catch(() => { loaded.current = true; setState({ ready: true, hasSavedProject: false }); });
    const flush = () => save.current.flush();
    window.addEventListener('beforeunload', flush);
    return () => { window.removeEventListener('beforeunload', flush); releaseAllUrls(); };
  }, []);

  useEffect(() => {
    if (loaded.current && useEditor.getState().saveStatus === 'unsaved') save.current(present);
  }, [present]);
  return state;
}

function StartupScreen({ onStart, onImport, onCommands, onOpenProject, onFeature, onRecordScreen, onAudioMode }: { onStart: (templateId?: string) => void; onImport: () => void; onCommands: () => void; onOpenProject: (id: string) => void; onFeature: (feature: string) => void; onRecordScreen: () => void; onAudioMode: () => void }) {
  const syncHome = async (frame: HTMLIFrameElement) => {
    const [rows, versions] = await Promise.all([
      db.projects.orderBy('updatedAt').reverse().toArray(),
      db.projectVersions.orderBy('savedAt').reverse().limit(40).toArray(),
    ]);
    frame.contentWindow?.postMessage({
      source: 'f4-editor',
      action: 'sync',
      projects: rows.map((row) => ({ id: row.id, name: row.name, ratio: row.data.settings.aspect, dur: Math.max(0, ...Object.values(row.data.clips).map((clip) => (clip.start + clip.duration) / row.data.settings.fps)), edited: row.updatedAt, prog: 100, pin: false, draft: true, seed: 1 })),
      history: versions.map((version) => ({ t: 'Autosaved version', s: version.data.name, i: 'save', c: '#34d399', at: version.savedAt })),
      exports: (() => { try { return JSON.parse(localStorage.getItem('f4.exports') ?? '[]'); } catch (_) { return []; } })(),
    }, window.location.origin);
  };
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.data?.source !== 'f4-studio-home') return;
      if (event.data.action === 'new') onStart();
      else if (event.data.action === 'template') {
        const template = PROJECT_TEMPLATES.find((item) => item.name === event.data.name);
        onStart(template?.id);
      } else if (event.data.action === 'import') onImport();
      else if (event.data.action === 'record-screen') onRecordScreen();
      else if (event.data.action === 'audio-mode' || event.data.action === 'audio-studio') onAudioMode();
      else if (event.data.action === 'commands') onCommands();
      else if (event.data.action === 'open-project' && typeof event.data.id === 'string') onOpenProject(event.data.id);
      else if (event.data.action === 'feature' && typeof event.data.feature === 'string') onFeature(event.data.feature);
      else if (event.data.action === 'theme' && (event.data.theme === 'dark' || event.data.theme === 'light')) { try { localStorage.setItem('f4.editor-theme', event.data.theme); } catch (_) { /* storage unavailable */ } window.dispatchEvent(new CustomEvent('f4-theme', { detail: event.data.theme })); }
     
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [onAudioMode, onCommands, onFeature, onImport, onOpenProject, onRecordScreen, onStart]);
  return (
    <div className="studio-startup fixed inset-0 z-[55] bg-[#16161a]" role="dialog" aria-modal="true" aria-label="F4 Studio home">
      <iframe title="F4 Studio home" src="/f4-studio-home-enhanced.html?embedded=1" className="h-full w-full border-0" onLoad={(event) => void syncHome(event.currentTarget)} />
      <button type="button" onClick={() => onStart()} className="absolute bottom-4 right-4 z-10 rounded-full bg-[#7556f5] sm:bottom-auto sm:right-5 sm:top-5 sm:rounded-lg px-4 py-2 text-xs font-semibold text-white shadow-xl hover:bg-[#8b6dff]">Open editor</button>
    </div>
  );
}

export function App() {
  if (new URLSearchParams(location.search).get('audio-studio') === '1') return <AudioStudioPage />;
  const [tool, setTool] = useState<Tool>(() => { const t = new URLSearchParams(location.search).get('tool'); return TOOLS.some((x) => x.id === t) || SECONDARY_TOOLS.includes(t as Tool) ? (t as Tool) : 'media'; });
  const [showHome, setShowHome] = useState(false);
  const [entered, setEntered] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 900px)').matches);
  const dismissHome = () => { setShowHome(false); setEntered(true); };
  const [editorTheme, setEditorTheme] = useState<'dark' | 'light'>(() => localStorage.getItem('f4.editor-theme') === 'light' ? 'light' : 'dark');
  const [leftW, setLeftW] = useState(250);
  const [rightW, setRightW] = useState(270);
  const [tlH, setTlH] = useState(300);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const hasSelection = useEditor((s) => s.selection.length > 0);
  const selectionKey = useEditor((s) => s.selection.join(','));
  const message = useEditor((s) => s.message);
  useKeyboard(() => setPaletteOpen(true));
  const persistence = usePersistence();

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => useEditor.getState().notify(null), 4000);
    return () => clearTimeout(t);
  }, [message]);

  useEffect(() => {
    if (!hasSelection) setInspectorOpen(false);
    else { setInspectorOpen(true); if (compact) setDrawer(false); }
  }, [hasSelection, selectionKey]);

  useEffect(() => {
    localStorage.setItem('f4.editor-theme', editorTheme);
  }, [editorTheme]);
  useEffect(() => {
    const onTheme = (event: Event) => setEditorTheme((event as CustomEvent<string>).detail === 'light' ? 'light' : 'dark');
    window.addEventListener('f4-theme', onTheme);
    return () => window.removeEventListener('f4-theme', onTheme);
  }, []);

  useEffect(() => {
    const preventBrowserZoom = (event: WheelEvent) => { if (event.ctrlKey || event.metaKey) event.preventDefault(); };
    const preventZoomKeys = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (['+', '=', '-', '0'].includes(event.key)) event.preventDefault();
    };
    window.addEventListener('wheel', preventBrowserZoom, { passive: false });
    window.addEventListener('keydown', preventZoomKeys);
    return () => { window.removeEventListener('wheel', preventBrowserZoom); window.removeEventListener('keydown', preventZoomKeys); };
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const on = () => setCompact(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  useEffect(() => { handleLaunchFiles(async (file) => { const m = await openProjectFile(file); useEditor.getState().notify(m); setEntered(true); }); }, []);

  useEffect(() => {
    const openTransitions = () => setTool('transitions');
    const openTool = (event: Event) => { const id = (event as CustomEvent<string>).detail as Tool; if (TOOLS.some((x) => x.id === id) || SECONDARY_TOOLS.includes(id)) setTool(id); };
    window.addEventListener('f4-open-transitions', openTransitions);
    window.addEventListener('f4-open-tool', openTool);
    return () => { window.removeEventListener('f4-open-transitions', openTransitions); window.removeEventListener('f4-open-tool', openTool); };
  }, []);

  return (
    <div className={`studio-editor editor-theme-${editorTheme} flex h-full w-full max-w-full flex-col overflow-hidden`}>
      <TopBar onOpenCommands={() => setPaletteOpen(true)} onGoHome={() => setShowHome(true)} editorTheme={editorTheme} onToggleTheme={() => setEditorTheme((value) => value === 'dark' ? 'light' : 'dark')} />
      <div className={`flex min-h-0 flex-1 ${compact ? 'flex-col' : ''}`}>
        <nav className={`editor-toolnav flex shrink-0 items-center gap-1 ${compact ? 'order-last' : 'flex-col'}`} aria-label="Tools">
          {TOOLS.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" aria-pressed={tool === id} title={label} aria-label={label} className="rail-btn"
              onClick={() => { if (compact && tool === id && drawer) setDrawer(false); else { setTool(id); setDrawer(true); } }}>
              <Icon size={compact ? 18 : 22} strokeWidth={1.75} /><span>{label}</span>
            </button>
          ))}
        </nav>
        {(!compact || drawer) && (
        <aside data-compact={compact || undefined} className={`editor-left-sidebar border-ink-600/70 bg-ink-850 ${compact ? 'h-[58vh] border-t shadow-2xl' : 'shrink-0 border-r'}`} style={compact ? undefined : { width: leftW }}>
          {compact && <button type="button" className="btn-icon absolute right-2 top-2 z-20" aria-label="Close panel" onClick={() => setDrawer(false)}><X size={15} /></button>}
          {tool === 'audio' ? <MediaPanel showVisualizer bundledKind="audio" /> : tool === 'media' ? <MediaPanel /> : tool === 'text' ? <TextPanel /> : tool === 'record' ? <RecordPanel /> : tool === 'library' ? <LibraryPanel /> : tool === 'templates' ? <TemplatesPanel /> : <ToolStatusPanel tool={tool} />}
        </aside>
        )}
        {!compact && <Resizer axis="x" label="Resize media panel" onResize={(d) => setLeftW((w) => clamp(w + d, 200, 520))} />}
        <main className="relative flex min-w-0 flex-1 flex-col">
          {hasSelection && !inspectorOpen && <button type="button" className="inspector-launch absolute right-3 top-3 z-30 rounded-lg border border-ink-500 bg-ink-850 px-3 py-2 text-[11px] font-semibold text-zinc-300 shadow-xl hover:border-violet-400 hover:text-white" onClick={() => setInspectorOpen(true)}>Open inspector</button>}
          <div className="min-h-0 flex-1"><Preview /></div>
          <Resizer axis="y" label="Resize timeline" onResize={(d) => setTlH((h) => clamp(h - d, 160, 640))} />
          <div className={`${compact ? 'min-h-[180px]' : 'min-h-[260px]'} shrink-0 border-t border-ink-600/70`} style={{ height: compact ? Math.min(tlH, 220) : tlH }}><Timeline /></div>
        </main>
        {hasSelection && inspectorOpen && (compact
          ? <aside data-compact className="editor-right-sidebar h-[52vh] border-t border-ink-600/70 bg-ink-850 shadow-2xl"><button type="button" className="inspector-close btn-icon absolute right-2 top-2 z-20" aria-label="Close inspector" onClick={() => setInspectorOpen(false)}><X size={14} /></button><Inspector /></aside>
          : <><Resizer axis="x" label="Resize inspector" onResize={(d) => setRightW((w) => clamp(w - d, 220, 480))} /><aside className="editor-right-sidebar relative shrink-0 border-l border-ink-600/70 bg-ink-850" style={{ width: rightW }}><button type="button" className="inspector-close btn-icon absolute right-2 top-2 z-20" aria-label="Close inspector" title="Close inspector" onClick={() => setInspectorOpen(false)}><X size={14} /></button><Inspector /></aside></>)}
      </div>
      {message && <div role="alert" className="pointer-events-none fixed bottom-6 left-1/2 -translate-x-1/2 rounded border border-ink-500 bg-ink-700 px-4 py-2 text-xs shadow-xl">{message}</div>}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onTool={setTool} />
      {persistence.ready && (showHome || (!persistence.hasSavedProject && !entered)) && <StartupScreen onStart={(templateId) => {
        if (templateId) useEditor.getState().applyTemplate(templateId);
        else useEditor.getState().loadProject(createProject());
        setTool(templateId === 'music-visualizer' ? 'audio' : 'media');
        dismissHome();
      }} onImport={() => { dismissHome(); setTool('media'); window.setTimeout(() => window.dispatchEvent(new Event('f4-open-import')), 0); }} onRecordScreen={() => { dismissHome(); setTool('record'); setDrawer(true); }} onAudioMode={() => { window.location.href = '/?audio-studio=1'; }} onCommands={() => { dismissHome(); setPaletteOpen(true); }} onOpenProject={(id) => { void loadProject(id).then((project) => { if (!project) return; useEditor.getState().loadProject(project); dismissHome(); setTool('media'); }); }} onFeature={(feature) => {
        const featureTools: Record<string, Tool> = { captions: 'text', 'beat-sync': 'audio', visualizer: 'audio', 'chroma-key': 'effects', speed: 'media', looks: 'effects', transform: 'media', 'audio-processing': 'audio', keyframes: 'media', reframe: 'media', 'text-animation': 'text', autosave: 'media', export: 'media' };
        dismissHome();
        setTool(featureTools[feature] ?? 'media');
        useEditor.getState().notify(`Opened ${feature.replaceAll('-', ' ')} tools.`);
      }} />}
    </div>
  );
}

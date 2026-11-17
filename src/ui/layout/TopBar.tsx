import { useEffect, useRef, useState } from 'react';
import { Check, CircleAlert, Command, Download, History, Keyboard, Loader2, Moon, Redo2, Settings, Sun, Undo2, X } from 'lucide-react';
import { ASPECT_RATIOS, dimensionsFor, exportFileName, SUPPORTED_FPS, type AspectRatioKey, type ExportSettings, type Fps, type Project } from '../../core';
import { canRenderProject, exportProject, type ExportProgress as RenderProgress } from '../../engine/exporter';
import { listProjectVersions, type ProjectVersion } from '../../engine/db';
import { useEditor } from '../../store/editor';
import { F4Logo } from '../common/F4Logo';
import { ProjectMenu } from './ProjectMenu';
import { ExportComplete, ExportDialog, ExportProgress } from './ExportDialog';

export const SHORTCUTS: Array<[string, string]> = [
  ['Space', 'Play / pause'],
  ['← / →', 'Step one frame'],
  ['Home / End', 'Go to start / end'],
  ['S', 'Split at playhead'],
  ['Delete / Backspace', 'Delete selected'],
  ['Shift + Delete', 'Ripple delete'],
  ['Ctrl/Cmd + D', 'Duplicate'],
  ['Ctrl/Cmd + C / V', 'Copy / paste at playhead'],
  ['Ctrl/Cmd + G', 'Group'],
  ['Ctrl/Cmd + Shift + G', 'Ungroup'],
  ['M', 'Add marker at playhead'],
  ['Ctrl/Cmd + Z', 'Undo'],
  ['Ctrl/Cmd + Shift + Z / Y', 'Redo'],
  ['+ / -', 'Timeline zoom'],
  ['J / K / L', 'Back 1 s · play / pause · forward 1 s'],
  ['[ / ]', 'Jump to previous / next clip edge'],
  ['F', 'Zoom timeline to fit the project'],
  ['Ctrl/Cmd + E', 'Export presets'],
  ['Ctrl/Cmd + S', 'Save now'],
  ['Ctrl/Cmd + Shift + S', 'Save project file (.f4proj)'],
  ['Ctrl/Cmd + K', 'Command palette'],
];

export function TopBar({ onOpenCommands, onGoHome, editorTheme, onToggleTheme }: { onOpenCommands: () => void; onGoHome: () => void; editorTheme: 'dark' | 'light'; onToggleTheme: () => void }) {
  const name = useEditor((s) => s.history.present.name);
  const saveStatus = useEditor((s) => s.saveStatus);
  const canUndo = useEditor((s) => s.history.past.length > 0);
  const canRedo = useEditor((s) => s.history.future.length > 0);
  const project = useEditor((s) => s.history.present);
  const previewQuality = useEditor((s) => s.previewQuality);
  const { undo, redo, renameProject, apply, setPreviewQuality, notify } = useEditor.getState();
  const [help, setHelp] = useState(false);
  const [settings, setSettings] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportedProject, setExportedProject] = useState<Project | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportRatio, setExportRatio] = useState(0);
  const [exportEta, setExportEta] = useState<number | null>(null);
  const [exportPhase, setExportPhase] = useState<'loading' | 'rendering' | 'complete'>('loading');
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const [exportBytes, setExportBytes] = useState(0);
  const [exportName, setExportName] = useState('');
  const [exportInfo, setExportInfo] = useState<{ note?: string; seconds: number; engine: string; container: 'mp4' | 'webm' } | null>(null);
  const [exportDetail, setExportDetail] = useState<Pick<RenderProgress, 'label' | 'framesDone' | 'framesTotal'>>({});
  const [versionsOpen, setVersionsOpen] = useState(false);
  const exportController = useRef<AbortController | null>(null);
  const exportCapability = canRenderProject(project);
  const [exportThumbnail, setExportThumbnail] = useState<string | null>(null);

  const handleExport = async (target: Project) => {
    if (!canRenderProject(target).ok || exporting) return;
    setExportOpen(false);
    setExportedProject(target);
    if (exportUrl) {
      URL.revokeObjectURL(exportUrl);
      setExportUrl(null);
    }
    const controller = new AbortController();
    exportController.current = controller;
    setExporting(true);
    setExportRatio(0);
    setExportEta(null);
    setExportPhase('loading');
    try {
      let renderStarted = 0;
      const result = await exportProject(target, ({ ratio, phase, label, framesDone, framesTotal }) => {
        setExportRatio(ratio);
        setExportPhase(phase);
        setExportDetail({ label, framesDone, framesTotal });
        if (phase === 'rendering' && framesDone && framesTotal) {
          if (!renderStarted) renderStarted = performance.now();
          const elapsed = (performance.now() - renderStarted) / 1000;
          if (framesDone >= 3) setExportEta((elapsed / framesDone) * (framesTotal - framesDone) + 1);
        }
      }, controller.signal);
      const blob = result.blob;
      setExportInfo({ note: result.note, seconds: result.seconds, engine: result.engine, container: result.container });
      if (result.note) notify(result.note);
      const url = URL.createObjectURL(blob);
      setExportUrl(url);
      setExportBytes(blob.size);
      const link = document.createElement('a');
      link.href = url;
      const fileName = exportFileName(target.name, { ...target.export, container: result.container });
      setExportName(fileName);
      link.download = fileName;
      link.click();
      try {
        const existing = JSON.parse(localStorage.getItem('f4.exports') ?? '[]') as unknown[];
        const record = { project: target.name, format: result.container === 'webm' ? 'WebM' : 'MP4 · H.264', resolution: `${target.export.resolution}p`, sizeMb: Number((blob.size / 1048576).toFixed(1)), seconds: Number(result.seconds.toFixed(1)), fileName, at: Date.now() };
        localStorage.setItem('f4.exports', JSON.stringify([record, ...existing].slice(0, 40)));
      } catch (_) { /* browser storage may be unavailable */ }
      notify(`${result.container.toUpperCase()} export finished in ${result.seconds < 60 ? `${result.seconds.toFixed(1)}s` : `${Math.floor(result.seconds / 60)}m ${Math.round(result.seconds % 60)}s`}.`);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        const message = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Export failed.';
        notify(message.startsWith('Export ') ? message : `Export failed: ${message}`);
      }
    } finally {
      exportController.current = null;
      setExporting(false);
      setExportRatio(0);
      setExportEta(null);
      setExportPhase('loading');
    }
  };

  const openExportDialog = () => {
    const previewCanvas = document.querySelector('canvas[aria-label="Video preview"]') as HTMLCanvasElement | null;
    let snap: string | null = null;
    if (previewCanvas) { try { snap = previewCanvas.toDataURL('image/jpeg', 0.82); } catch (_) { /* canvas may be unavailable */ } }
    setExportThumbnail(snap);
    setExportOpen(true);
  };

  const handleExportClick = () => {
    if (exporting) {
      exportController.current?.abort();
      return;
    }
    openExportDialog();
  };

  const startExport = (settings: ExportSettings) => {
    apply((p) => ({ ok: true, project: { ...p, export: { ...settings }, updatedAt: Date.now() } }));
    void handleExport({ ...useEditor.getState().project(), export: { ...settings } });
  };

  useEffect(() => {
    const run = () => handleExportClick();
    window.addEventListener('f4-export', run);
    return () => window.removeEventListener('f4-export', run);
  });

  const closeExportResult = () => {
    if (exportUrl) URL.revokeObjectURL(exportUrl);
    setExportUrl(null);
  };

  const status = {
    saved: { icon: <Check size={12} />, text: 'Saved', cls: 'text-emerald-400' },
    saving: { icon: <Loader2 size={12} className="animate-spin" />, text: 'Saving…', cls: 'text-zinc-400' },
    unsaved: { icon: null, text: 'Unsaved changes', cls: 'text-amber-400' },
    error: { icon: <CircleAlert size={12} />, text: 'Save failed', cls: 'text-red-400' },
  }[saveStatus];

  return (
    <header className="flex shrink-0 items-center gap-3">
      <button type="button" className="flex items-center gap-2 rounded-lg px-1 py-1 text-left transition hover:bg-white/5" aria-label="Go to F4 Studio home" title="Go to F4 Studio home" onClick={onGoHome}>
        <div className="f4-logo-mark flex h-6 w-6 items-center justify-center overflow-hidden rounded text-[11px] font-black text-white"><F4Logo className="h-full w-full" /></div>
        <span className="hidden text-[14px] font-bold tracking-tight sm:inline">F4 Studio</span>
      </button>
      <input
        aria-label="Project name"
        className="h-8 w-28 rounded-md border border-transparent bg-transparent px-2 text-[13px] font-medium hover:border-ink-500 focus:border-violet-500 focus:outline-none sm:w-60"
        defaultValue={name}
        key={name}
        onBlur={(e) => e.target.value !== name && renameProject(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <span className={`hidden items-center gap-1 text-[11px] sm:flex ${status.cls}`} role="status">{status.icon}{status.text}</span>
      <div className="ml-auto flex items-center gap-1">
        <button className="btn-icon" aria-label={`Switch to ${editorTheme === 'dark' ? 'light' : 'dark'} editor theme`} title={`Switch to ${editorTheme === 'dark' ? 'light' : 'dark'} editor theme`} onClick={onToggleTheme}>{editorTheme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}</button>
        <label className="hidden items-center gap-1.5 xl:flex">
          <span className="label">Preview</span>
          <select className="field !h-7 !w-20" aria-label="Preview quality" value={previewQuality} onChange={(e) => setPreviewQuality(e.target.value as typeof previewQuality)}>
            <option value="full">Full</option><option value="half">Half</option><option value="quarter">Quarter</option>
          </select>
        </label>
        <button className="btn-icon hidden md:inline-flex" aria-label="Project settings" title="Project settings" onClick={() => setSettings(true)}><Settings size={15} /></button>
        <button className="btn-icon hidden md:inline-flex" aria-label="Project version history" title="Project version history" onClick={() => setVersionsOpen(true)}><History size={15} /></button>
        <button className="btn-icon" aria-label="Command palette" title="Command palette (Ctrl/Cmd+K)" onClick={onOpenCommands}><Command size={15} /></button>
        <button className="btn-icon" disabled={!canUndo} aria-label="Undo" title="Undo (Ctrl+Z)" onClick={undo}><Undo2 size={15} /></button>
        <button className="btn-icon" disabled={!canRedo} aria-label="Redo" title="Redo (Ctrl+Shift+Z)" onClick={redo}><Redo2 size={15} /></button>
        <button className="btn-icon hidden md:inline-flex" aria-label="Keyboard shortcuts" title="Keyboard shortcuts" onClick={() => setHelp(true)}><Keyboard size={15} /></button>
        <ProjectMenu />
        <button className="export-btn" title={exporting ? 'Cancel the running export' : 'Choose export settings'} onClick={handleExportClick}>{exporting ? <X size={14} /> : <Download size={14} />} {exporting ? `Cancel ${(exportRatio * 100).toFixed(0)}%` : 'Export'}</button>
      </div>
      {help && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onClick={() => setHelp(false)}>
          <div className="w-[420px] rounded-lg border border-ink-500 bg-ink-800 p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-3 text-sm font-semibold">Keyboard shortcuts</h2>
            <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 text-xs">
              {SHORTCUTS.map(([k, d]) => (<div key={k} className="contents"><dt className="text-zinc-400">{d}</dt><dd className="font-mono text-violet-300">{k}</dd></div>))}
            </dl>
            <button className="mt-4 h-8 w-full rounded bg-violet-600 text-xs font-medium hover:bg-violet-500" autoFocus onClick={() => setHelp(false)}>Close</button>
          </div>
        </div>
      )}
      {settings && <ProjectSettingsDialog project={project} onClose={() => setSettings(false)} apply={apply} />}
      {versionsOpen && <VersionHistoryDialog projectId={project.id} onClose={() => setVersionsOpen(false)} />}
      {exportOpen && !exporting && <ExportDialog project={project} snapshot={exportThumbnail} blockedReason={exportCapability.ok ? null : exportCapability.reason} onClose={() => setExportOpen(false)} onStart={startExport} />}
      {exporting && exportedProject && <ExportProgress project={exportedProject} ratio={exportRatio} eta={exportEta} phase={exportPhase} detail={exportDetail} snapshot={exportThumbnail} onCancel={() => exportController.current?.abort()} />}
      {exportUrl && exportedProject && <ExportComplete url={exportUrl} fileName={exportName} bytes={exportBytes} info={exportInfo} project={exportedProject} snapshot={exportThumbnail} onClose={closeExportResult} />}
    </header>
  );
}

function VersionHistoryDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [versions, setVersions] = useState<ProjectVersion[]>([]);
  const restoreVersion = useEditor((state) => state.restoreVersion);
  useEffect(() => { void listProjectVersions(projectId).then(setVersions); }, [projectId]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4" role="dialog" aria-modal="true" aria-label="Project version history">
      <div className="w-[min(480px,100%)] rounded-lg border border-ink-500 bg-ink-800 p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between"><div><div className="label">Recovery</div><h2 className="mt-1 text-sm font-semibold text-zinc-100">Project version history</h2></div><button className="btn-icon" aria-label="Close version history" onClick={onClose}><X size={15} /></button></div>
        {versions.length === 0 ? <p className="py-5 text-center text-xs text-zinc-500">No autosaved versions yet. Make a change and wait for autosave.</p> : <div className="max-h-72 space-y-1 overflow-y-auto">{versions.map((version) => <button key={version.id} className="flex w-full items-center justify-between rounded border border-transparent px-3 py-2 text-left hover:border-violet-500/50 hover:bg-ink-700" onClick={() => { if (version.id !== undefined) void restoreVersion(version.id); onClose(); }}><span className="text-xs text-zinc-200">{new Date(version.savedAt).toLocaleString()}</span><span className="font-mono text-[10px] text-zinc-500">Restore</span></button>)}</div>}
        <p className="mt-4 text-[10px] leading-relaxed text-zinc-600">The latest 30 autosaved snapshots are retained locally in IndexedDB.</p>
      </div>
    </div>
  );
}

function ProjectSettingsDialog({ project, onClose, apply }: {
  project: ReturnType<typeof useEditor.getState>['history']['present'];
  onClose: () => void;
  apply: ReturnType<typeof useEditor.getState>['apply'];
}) {
  const [aspect, setAspect] = useState<AspectRatioKey>(project.settings.aspect);
  const [fps, setFps] = useState<Fps>(project.settings.fps);
  const [background, setBackground] = useState(project.settings.backgroundColor);
  const [opening, setOpening] = useState((project.settings.backgroundDurationFrames ?? 0) > 0);
  const [resolution, setResolution] = useState(project.export.resolution);

  const save = () => {
    apply((p) => ({
      ok: true,
      project: {
        ...p,
        settings: { ...p.settings, aspect, fps, ...dimensionsFor(aspect), backgroundColor: background, backgroundDurationFrames: opening ? fps * 5 : 0 },
        export: { ...p.export, resolution, fps },
        updatedAt: Date.now(),
      },
    }));
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4" role="dialog" aria-modal="true" aria-label="Project settings">
      <div className="w-[min(440px,100%)] rounded-lg border border-ink-500 bg-ink-800 p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div><div className="label">Project</div><h2 className="mt-1 text-sm font-semibold text-zinc-100">Project settings</h2></div>
          <button className="btn-icon" aria-label="Close project settings" onClick={onClose}><X size={15} /></button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="label">Aspect ratio<select className="field mt-1" value={aspect} onChange={(e) => setAspect(e.target.value as AspectRatioKey)}>{(Object.keys(ASPECT_RATIOS) as AspectRatioKey[]).map((key) => <option key={key}>{key}</option>)}</select></label>
          <label className="label">Timeline FPS<select className="field mt-1" value={fps} onChange={(e) => setFps(Number(e.target.value) as Fps)}>{SUPPORTED_FPS.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label className="label">Export resolution<select className="field mt-1" value={resolution} onChange={(e) => setResolution(Number(e.target.value) as typeof resolution)}>{[360, 480, 720, 1080].map((value) => <option key={value}>{value}p</option>)}</select></label>
          <label className="label">Canvas background<input className="field mt-1 h-8 p-1" type="color" value={background} onChange={(e) => setBackground(e.target.value)} /></label>
          <label className="col-span-2 flex items-center gap-2 text-[11px] text-zinc-300"><input type="checkbox" checked={opening} onChange={(e) => setOpening(e.target.checked)} className="accent-violet-500" /> Keep a 5-second black opening on blank projects</label>
        </div>
        <p className="mt-4 text-[11px] leading-relaxed text-zinc-500">Export settings are stored with the project. Supported clips render through the browser FFmpeg worker; unsupported effect combinations remain disabled with an explanation.</p>
        <div className="mt-5 flex justify-end gap-2"><button className="h-8 rounded px-3 text-xs text-zinc-400 hover:bg-ink-700" onClick={onClose}>Cancel</button><button className="h-8 rounded bg-violet-600 px-3 text-xs font-medium text-white hover:bg-violet-500" onClick={save}>Save settings</button></div>
      </div>
    </div>
  );
}

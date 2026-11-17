import { useEffect, useRef, useState } from 'react';
import { Camera, Check, FolderOpen, ImagePlus, MonitorDown, Rocket, Save, X } from 'lucide-react';
import { applyExportPreset, EXPORT_PRESETS } from '../../core';
import { importFile } from '../../engine/media';
import { engine } from '../../engine/playback';
import { canInstall, isStandalone, onInstallStateChange, promptInstall } from '../../engine/pwa';
import { downloadBlob, openProjectFile, saveProjectFile } from '../../engine/projectio';
import { PROJECT_FILE_EXTENSION } from '../../engine/projectfile';
import { useEditor } from '../../store/editor';

export function ProjectMenu() {
  const [open, setOpen] = useState(false);
  const [presets, setPresets] = useState(false);
  const [installable, setInstallable] = useState(canInstall());
  const root = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const notify = useEditor((s) => s.notify);

  useEffect(() => onInstallStateChange(() => setInstallable(canInstall())), []);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', away); window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('mousedown', away); window.removeEventListener('keydown', esc); };
  }, [open]);
  useEffect(() => { const h = () => setPresets(true); window.addEventListener('f4-open-export-presets', h); return () => window.removeEventListener('f4-open-export-presets', h); }, []);
  useEffect(() => { const h = () => void saveFile(); window.addEventListener('f4-save-project-file', h); return () => window.removeEventListener('f4-save-project-file', h); });

  const saveFile = async () => { try { notify(await saveProjectFile(useEditor.getState().project())); } catch (e) { notify(e instanceof Error ? e.message : 'Could not save the project file.'); } };
  const stamp = () => { const d = new Date(); const p = (n: number) => String(n).padStart(2, '0'); return `${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`; };
  const frameName = () => `${useEditor.getState().project().name.replace(/[^a-z0-9-_ ]+/gi, '-')} frame ${stamp()}.png`;
  const snapshot = async (toMedia: boolean) => {
    const blob = await engine.snapshotPng();
    if (!blob) return notify('Nothing to capture yet.');
    if (!toMedia) { downloadBlob(blob, frameName()); return notify('Frame saved as PNG.'); }
    const out = await importFile(new File([blob], frameName(), { type: 'image/png' }));
    if (out.asset) { useEditor.getState().registerAsset(out.asset); notify('Frame added to your media bin.'); } else notify(out.error ?? 'Could not add the frame.');
  };
  const item = 'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-xs text-zinc-200 hover:bg-violet-600/20';
  const run = (fn: () => void | Promise<void>) => () => { setOpen(false); void fn(); };

  return (
    <div className="relative" ref={root}>
      <button type="button" className="inline-flex h-7 items-center gap-1.5 rounded border border-ink-500 px-2 text-xs font-medium text-zinc-200 hover:border-violet-400" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}><Save size={13} />Project</button>
      {open && (
        <div role="menu" className="absolute right-0 top-9 z-50 w-64 rounded-lg border border-ink-500 bg-ink-850 p-1 shadow-2xl">
          <button role="menuitem" className={item} onClick={run(saveFile)}><Save size={14} className="text-violet-300" /><span className="flex-1">Save project file</span><kbd className="text-[10px] text-zinc-500">Ctrl+Shift+S</kbd></button>
          <button role="menuitem" className={item} onClick={run(() => fileInput.current?.click())}><FolderOpen size={14} className="text-violet-300" />Open project file…</button>
          <div className="my-1 h-px bg-ink-600/70" />
          <button role="menuitem" className={item} onClick={run(() => setPresets(true))}><Rocket size={14} className="text-violet-300" /><span className="flex-1">Export presets…</span><kbd className="text-[10px] text-zinc-500">Ctrl+E</kbd></button>
          <button role="menuitem" className={item} onClick={run(() => snapshot(false))}><Camera size={14} className="text-violet-300" />Save current frame as PNG</button>
          <button role="menuitem" className={item} onClick={run(() => snapshot(true))}><ImagePlus size={14} className="text-violet-300" />Add current frame to media</button>
          {installable && !isStandalone() && <><div className="my-1 h-px bg-ink-600/70" /><button role="menuitem" className={item} onClick={run(async () => { const r = await promptInstall(); if (r === 'accepted') notify('F4 Studio is installing as an app.'); })}><MonitorDown size={14} className="text-emerald-300" />Install as desktop app</button></>}
        </div>
      )}
      <input ref={fileInput} type="file" accept={`${PROJECT_FILE_EXTENSION},application/x-f4-project`} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void openProjectFile(f).then(notify, (err) => notify(err instanceof Error ? err.message : 'Could not open that file.')); }} />
      {presets && <ExportPresetsDialog onClose={() => setPresets(false)} />}
    </div>
  );
}

function ExportPresetsDialog({ onClose }: { onClose: () => void }) {
  const project = useEditor((s) => s.history.present);
  const apply = useEditor((s) => s.apply);
  const { aspect, fps, width, height } = project.settings;
  const current = EXPORT_PRESETS.find((p) => p.aspect === aspect && p.fps === fps && p.resolution === project.export.resolution && p.videoBitrateKbps === project.export.videoBitrateKbps)?.id;
  useEffect(() => { const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', esc); return () => window.removeEventListener('keydown', esc); }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4" role="dialog" aria-modal="true" aria-label="Export presets" onMouseDown={onClose}>
      <div className="w-[min(560px,100%)] rounded-xl border border-ink-500 bg-ink-800 p-5 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between"><div><div className="label">Export</div><h2 className="mt-1 text-sm font-semibold text-zinc-100">Choose where this video is going</h2></div><button className="btn-icon" aria-label="Close" onClick={onClose}><X size={15} /></button></div>
        <p className="mb-3 text-[11px] text-zinc-500">A preset sets the canvas shape, resolution, frame rate and bitrate in one click. Your clips are kept.</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {EXPORT_PRESETS.map((preset) => (
            <button key={preset.id} type="button" aria-pressed={current === preset.id} onClick={() => apply((p) => ({ ok: true, project: applyExportPreset(p, preset) }))}
              className={`flex items-start gap-3 rounded-lg border p-3 text-left transition ${current === preset.id ? 'border-violet-400 bg-violet-500/15' : 'border-ink-500 hover:border-ink-400'}`}>
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded bg-ink-700"><span className="block border border-violet-300/80" style={{ width: preset.aspect === '9:16' ? 10 : preset.aspect === '4:5' ? 14 : preset.aspect === '1:1' ? 16 : 22, height: preset.aspect === '9:16' ? 18 : preset.aspect === '4:5' ? 18 : preset.aspect === '1:1' ? 16 : preset.aspect === '21:9' ? 10 : 12 }} /></span>
              <span className="min-w-0 flex-1"><span className="block text-xs font-semibold text-zinc-100">{preset.label}</span><span className="block text-[10px] text-zinc-500">{preset.hint}</span></span>
              {current === preset.id && <Check size={14} className="mt-1 text-violet-300" />}
            </button>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between gap-3 border-t border-ink-600/70 pt-3">
          <span className="text-[11px] text-zinc-400">Now: <b className="text-zinc-200">{width}×{height}</b> · {fps} fps · {aspect} · {project.export.videoBitrateKbps / 1000} Mbps</span>
          <div className="flex gap-2"><button className="h-8 rounded px-3 text-xs text-zinc-400 hover:bg-ink-700" onClick={onClose}>Done</button><button className="inline-flex h-8 items-center gap-1.5 rounded bg-violet-600 px-3 text-xs font-medium text-white hover:bg-violet-500" onClick={() => { onClose(); window.dispatchEvent(new Event('f4-export')); }}><Rocket size={13} />Export MP4</button></div>
        </div>
      </div>
    </div>
  );
}

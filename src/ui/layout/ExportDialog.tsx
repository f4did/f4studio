import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, Clock, Download, FileVideo, HardDrive, Info, MonitorPlay, X } from 'lucide-react';
import {
  estimateSizeBytes, exportFileName, FORMAT_OPTIONS, normalizedExport, projectDuration, QUALITY_OPTIONS, RESOLUTION_OPTIONS, SPEED_OPTIONS, SUPPORTED_FPS,
  type ExportSettings, type Project,
} from '../../core';
import { outputSize, webCodecsSupported } from '../../engine/exporter';

const RESOLUTION_LABEL: Record<number, string> = { 360: 'Low', 480: 'SD', 720: 'HD', 1080: 'Full HD' };

const QUICK_PRESETS: Array<{ id: string; label: string; hint: string; patch: Partial<ExportSettings> }> = [
  { id: 'social', label: 'YouTube & social', hint: '1080p · 30 fps · Fast', patch: { container: 'mp4', resolution: 1080, fps: 30, quality: 'high', speed: 'fast', rateControl: 'quality' } },
  { id: 'best', label: 'Best quality', hint: '1080p · 30 fps · Best', patch: { container: 'mp4', resolution: 1080, fps: 30, quality: 'best', speed: 'slow', rateControl: 'quality' } },
  { id: 'web', label: 'Web & messaging', hint: '720p · 30 fps · Good', patch: { container: 'mp4', resolution: 720, fps: 30, quality: 'good', speed: 'balanced', rateControl: 'quality' } },
  { id: 'draft', label: 'Quick draft', hint: '480p · 24 fps · Draft', patch: { container: 'mp4', resolution: 480, fps: 24, quality: 'draft', speed: 'fast', rateControl: 'quality' } },
];

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function Segmented<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: Array<{ id: T; label: string; hint?: string }>; onChange: (v: T) => void }) {
  return (
    <div className="xp-field">
      <div className="xp-label">{label}</div>
      <div className="xp-seg" role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <button key={String(option.id)} type="button" role="radio" aria-checked={value === option.id} className="xp-seg-btn" onClick={() => onChange(option.id)}>
            <span>{option.label}</span>{option.hint && <small>{option.hint}</small>}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ExportDialog({ project, snapshot, blockedReason, onClose, onStart }: { project: Project; snapshot: string | null; blockedReason: string | null; onClose: () => void; onStart: (settings: ExportSettings) => void }) {
  const [draft, setDraft] = useState<ExportSettings>(() => ({ ...project.export, ...normalizedExport(project.export), fileName: project.export.fileName ?? '' }));
  const [advanced, setAdvanced] = useState(draft.rateControl === 'bitrate');
  const patch = (next: Partial<ExportSettings>) => setDraft((current) => {
    const merged = { ...current, ...next };
    if (next.container) { const f = FORMAT_OPTIONS.find((item) => item.id === next.container)!; merged.videoCodec = f.videoCodec; merged.audioCodec = f.audioCodec; }
    return merged;
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const preview = useMemo(() => ({ ...project, export: draft }), [project, draft]);
  const size = outputSize(preview);
  const durationSec = projectDuration(project) / project.settings.fps;
  const hasAudio = Object.values(project.clips).some((clip) => clip.kind === 'audio' || (clip.kind === 'video' && clip.assetId && project.assets[clip.assetId]?.hasAudio));
  const bytes = estimateSizeBytes(draft, durationSec, hasAudio);
  const fileName = exportFileName(project.name, draft);
  const activePreset = QUICK_PRESETS.find((preset) => Object.entries(preset.patch).every(([key, value]) => (draft as unknown as Record<string, unknown>)[key] === value))?.id;
  const fastPipeline = webCodecsSupported();

  return (
    <div className="xp-page" role="dialog" aria-modal="true" aria-label="Export video">
      <header className="xp-head">
        <button type="button" className="xp-back" onClick={onClose}><ArrowLeft size={16} /> Back to editor</button>
        <div className="xp-title">Export</div>
        <button type="button" className="xp-primary" disabled={Boolean(blockedReason)} title={blockedReason ?? `Export ${fileName}`} onClick={() => onStart({ ...draft, fileName: draft.fileName })}><Download size={15} /> Export video</button>
      </header>
      <div className="xp-body">
        <section className="xp-left" aria-label="Export summary">
          <div className="xp-stage" style={{ aspectRatio: `${size.width} / ${size.height}` }}>
            {snapshot ? <img src={snapshot} alt="Current frame of your video" /> : <div className="xp-stage-empty"><MonitorPlay size={34} /><span>Preview unavailable</span></div>}
          </div>
          <div className="xp-file"><FileVideo size={18} /><div><strong>{fileName}</strong><span>{size.width} × {size.height} · {draft.fps} fps · {draft.container === 'mp4' ? 'H.264' : 'VP8'}</span></div></div>
          <dl className="xp-stats">
            <div><dt><Clock size={13} /> Duration</dt><dd>{formatDuration(durationSec)}</dd></div>
            <div><dt><MonitorPlay size={13} /> Resolution</dt><dd>{size.height}p</dd></div>
            <div><dt><HardDrive size={13} /> Est. size</dt><dd>~{formatBytes(bytes)}</dd></div>
          </dl>
          {blockedReason ? <p className="xp-note xp-warn"><Info size={14} />{blockedReason}</p> : <p className="xp-note"><Info size={14} />{fastPipeline ? 'Fast local encoder available. ' : 'Using the compatibility encoder. '}Your video renders on this device; nothing is uploaded.</p>}
        </section>
        <section className="xp-right" aria-label="Export settings">
          <div className="xp-field">
            <div className="xp-label">Quick presets</div>
            <div className="xp-presets">
              {QUICK_PRESETS.map((preset) => (
                <button key={preset.id} type="button" className="xp-preset" aria-pressed={activePreset === preset.id} onClick={() => patch(preset.patch)}>
                  <strong>{preset.label}</strong><small>{preset.hint}</small>{activePreset === preset.id && <Check size={14} />}
                </button>
              ))}
            </div>
          </div>
          <label className="xp-field"><span className="xp-label">File name</span>
            <span className="xp-input"><input aria-label="File name" value={draft.fileName ?? ''} placeholder={project.name || 'My video'} onChange={(e) => patch({ fileName: e.target.value })} /><em>.{draft.container}</em></span>
          </label>
          <Segmented label="Format" value={draft.container} options={FORMAT_OPTIONS.map((f) => ({ id: f.id, label: f.label, hint: f.detail }))} onChange={(container) => patch({ container })} />
          <Segmented label="Resolution" value={draft.resolution} options={RESOLUTION_OPTIONS.map((r) => ({ id: r, label: `${r}p`, hint: RESOLUTION_LABEL[r] }))} onChange={(resolution) => patch({ resolution })} />
          <Segmented label="Frame rate" value={draft.fps} options={SUPPORTED_FPS.map((f) => ({ id: f, label: `${f} fps` }))} onChange={(fps) => patch({ fps })} />
          <Segmented label="Quality" value={draft.quality ?? 'high'} options={QUALITY_OPTIONS.map((q) => ({ id: q.id, label: q.label, hint: q.hint }))} onChange={(quality) => patch({ quality, rateControl: 'quality' })} />
          <Segmented label="Encoding speed" value={draft.speed ?? 'balanced'} options={SPEED_OPTIONS.map((s) => ({ id: s.id, label: s.label, hint: s.hint }))} onChange={(speed) => patch({ speed })} />
          <button type="button" className="xp-adv-toggle" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>{advanced ? 'Hide' : 'Show'} advanced options</button>
          {advanced && (
            <div className="xp-adv">
              <Segmented label="Rate control" value={draft.rateControl ?? 'quality'} options={[{ id: 'quality', label: 'Constant quality', hint: 'Follows the Quality setting' }, { id: 'bitrate', label: 'Target bitrate', hint: 'Predictable file size' }]} onChange={(rateControl) => patch({ rateControl })} />
              <div className="xp-grid2">
                <label className="xp-field"><span className="xp-label">Video bitrate (kbps)</span><span className="xp-input"><input type="number" min={200} max={60000} step={100} aria-label="Video bitrate" disabled={draft.rateControl !== 'bitrate'} value={draft.videoBitrateKbps} onChange={(e) => patch({ videoBitrateKbps: Number(e.target.value) })} /></span></label>
                <label className="xp-field"><span className="xp-label">Audio bitrate</span><span className="xp-input"><select aria-label="Audio bitrate" value={draft.audioBitrateKbps} onChange={(e) => patch({ audioBitrateKbps: Number(e.target.value) })}>{[96, 128, 160, 192, 256, 320].map((v) => <option key={v} value={v}>{v} kbps</option>)}</select></span></label>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export function ExportProgress({ project, ratio, eta, phase, detail, snapshot, onCancel }: { project: Project; ratio: number; eta: number | null; phase: 'loading' | 'rendering' | 'complete'; detail?: { label?: string; framesDone?: number; framesTotal?: number }; snapshot: string | null; onCancel: () => void }) {
  const size = outputSize(project);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => { const started = performance.now(); const timer = window.setInterval(() => setElapsed(Math.floor((performance.now() - started) / 1000)), 1000); return () => window.clearInterval(timer); }, []);
  const percent = Math.max(0, Math.min(100, ratio * 100));
  const etaText = eta === null || !Number.isFinite(eta) ? 'Calculating time remaining…' : eta < 60 ? `About ${Math.ceil(eta)}s remaining` : `About ${Math.floor(eta / 60)}m ${String(Math.ceil(eta % 60)).padStart(2, '0')}s remaining`;
  return (
    <div className="xp-page xp-center" role="dialog" aria-modal="true" aria-label="Exporting video">
      <div className="xp-card">
        <div className="xp-stage" style={{ aspectRatio: `${size.width} / ${size.height}` }}>
          {snapshot ? <img src={snapshot} alt="" /> : <div className="xp-stage-empty"><MonitorPlay size={34} /></div>}
          <div className="xp-stage-bar"><i style={{ width: `${percent}%` }} /></div>
        </div>
        <h2>{phase === 'loading' ? (detail?.label ?? 'Getting ready…') : 'Exporting your video'}</h2>
        <p className="xp-sub">{exportFileName(project.name, project.export)} · {size.width}×{size.height} · {project.export.fps} fps{detail?.framesTotal ? ` · frame ${detail.framesDone ?? 0} of ${detail.framesTotal}` : ''}{detail?.label && phase === 'rendering' ? ` · ${detail.label}` : ''}</p>
        <div className="xp-meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}><i style={{ width: `${percent}%` }} /></div>
        <div className="xp-meter-row"><b>{percent.toFixed(0)}%</b><span>{etaText}</span><span>Elapsed {formatDuration(elapsed)}</span></div>
        <button type="button" className="xp-secondary" onClick={onCancel}><X size={14} /> Cancel export</button>
      </div>
    </div>
  );
}

export function ExportComplete({ url, fileName, bytes, info, project, snapshot, onClose }: { url: string; fileName: string; bytes: number; info: { note?: string; seconds: number; engine: string; container: 'mp4' | 'webm' } | null; project: Project; snapshot: string | null; onClose: () => void }) {
  const size = outputSize(project);
  const download = () => { const link = document.createElement('a'); link.href = url; link.download = fileName; link.click(); };
  return (
    <div className="xp-page xp-center" role="dialog" aria-modal="true" aria-label="Export complete">
      <div className="xp-card">
        <div className="xp-stage" style={{ aspectRatio: `${size.width} / ${size.height}` }}>
          {snapshot ? <img src={snapshot} alt="" /> : <div className="xp-stage-empty"><MonitorPlay size={34} /></div>}
          <span className="xp-done"><Check size={18} /></span>
        </div>
        <h2>Your video is ready</h2>
        <p className="xp-sub">{fileName} · {formatBytes(bytes)} · {size.width}×{size.height} · {project.export.fps} fps</p>
        {info && <p className="xp-sub">Rendered in {info.seconds < 60 ? `${info.seconds.toFixed(1)} seconds` : `${Math.floor(info.seconds / 60)}m ${Math.round(info.seconds % 60)}s`}{info.engine === 'recorder' ? ' (real-time fallback)' : ''}</p>}
        {info?.note && <p className="xp-note">{info.note}</p>}
        <div className="xp-actions">
          <button type="button" className="xp-primary" onClick={download}><Download size={15} /> Download again</button>
          <button type="button" className="xp-secondary" onClick={onClose}>Back to editor</button>
        </div>
      </div>
    </div>
  );
}

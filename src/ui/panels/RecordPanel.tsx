import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Circle, Mic, MonitorUp, Pause, Play, Square, X } from 'lucide-react';
import { useEditor } from '../../store/editor';
import { importFile } from '../../engine/media';
import { describeMediaError, formatElapsed, listDevices, Recorder, recordingSupport, type RecordKind } from '../../engine/recorder';

const SOURCES: Array<{ id: RecordKind; label: string; hint: string; icon: typeof Camera }> = [
  { id: 'screen', label: 'Screen', hint: 'Window, tab or full screen', icon: MonitorUp },
  { id: 'webcam', label: 'Camera', hint: 'Webcam + microphone', icon: Camera },
  { id: 'voice', label: 'Voice-over', hint: 'Microphone only', icon: Mic },
];

type Phase = 'idle' | 'starting' | 'countdown' | 'recording' | 'paused' | 'saving';

export function RecordPanel() {
  const registerAsset = useEditor((s) => s.registerAsset);
  const addToTimeline = useEditor((s) => s.addAssetToTimeline);
  const notify = useEditor((s) => s.notify);
  const support = recordingSupport();
  const [kind, setKind] = useState<RecordKind>('screen');
  const [phase, setPhase] = useState<Phase>('idle');
  const [mic, setMic] = useState(true);
  const [systemAudio, setSystemAudio] = useState(true);
  const [countdownOn, setCountdownOn] = useState(true);
  const [autoPlace, setAutoPlace] = useState(true);
  const [count, setCount] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState('');
  const [camId, setCamId] = useState('');
  const recorder = useRef<Recorder | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const cancelled = useRef(false);

  const refreshDevices = useCallback(() => { void listDevices().then((d) => { setMics(d.mics); setCams(d.cameras); }).catch(() => undefined); }, []);
  useEffect(() => { refreshDevices(); }, [refreshDevices]);

  // Tick the timer and level meter while a recording is live.
  useEffect(() => {
    if (phase !== 'recording' && phase !== 'paused') return;
    const timer = window.setInterval(() => { const r = recorder.current; if (!r) return; setElapsed(r.elapsedSec()); setLevel(r.level()); }, 100);
    return () => window.clearInterval(timer);
  }, [phase]);

  // Never leave the camera light on if the panel is closed mid-capture.
  useEffect(() => () => { cancelled.current = true; recorder.current?.cancel(); recorder.current = null; }, []);

  const finish = useCallback(async () => {
    const r = recorder.current;
    if (!r) return;
    setPhase('saving');
    try {
      const result = await r.stop();
      recorder.current = null;
      if (video.current) video.current.srcObject = null;
      const file = new File([result.blob], result.fileName, { type: result.mimeType });
      const outcome = await importFile(file, { durationHintSec: result.durationSec });
      if (!outcome.asset) throw new Error(outcome.error ?? 'The recording could not be imported.');
      registerAsset(outcome.asset);
      if (autoPlace) {
        // Camera clips become picture-in-picture overlays; screen and voice go on their natural tracks.
        addToTimeline(outcome.asset.id, undefined, result.kind === 'webcam' && Object.values(useEditor.getState().project().clips).some((c) => c.kind === 'video') ? { trackKind: 'overlay' } : undefined);
      }
      notify(`Saved “${result.fileName}” (${formatElapsed(result.durationSec)})${autoPlace ? ' and added it to the timeline' : ' to your media'}.`);
    } catch (e) {
      setError(describeMediaError(e));
    } finally {
      setPhase('idle'); setElapsed(0); setLevel(0); recorder.current = null;
    }
  }, [addToTimeline, autoPlace, notify, registerAsset]);

  const start = async () => {
    setError(null); cancelled.current = false; setPhase('starting');
    try {
      const r = await Recorder.start({ kind, mic: kind === 'voice' ? true : mic, systemAudio, micDeviceId: micId || undefined, cameraDeviceId: camId || undefined });
      if (cancelled.current) { r.cancel(); return; }
      recorder.current = r;
      r.onEnded = () => { void finish(); };
      refreshDevices(); // labels become available once permission is granted
      if (video.current && kind !== 'voice') { video.current.srcObject = new MediaStream(r.stream.getVideoTracks()); void video.current.play().catch(() => undefined); }
      if (countdownOn) {
        for (let n = 3; n > 0; n--) { if (cancelled.current) return; setPhase('countdown'); setCount(n); await new Promise((res) => window.setTimeout(res, 1000)); }
        if (cancelled.current || recorder.current !== r) return;
      }
      r.begin(); setPhase('recording');
    } catch (e) {
      recorder.current?.cancel(); recorder.current = null; setPhase('idle');
      setError(describeMediaError(e));
    }
  };

  const abort = () => { cancelled.current = true; recorder.current?.cancel(); recorder.current = null; if (video.current) video.current.srcObject = null; setPhase('idle'); setElapsed(0); setLevel(0); };
  const live = phase === 'countdown' || phase === 'recording' || phase === 'paused';
  const busy = phase !== 'idle';
  const usable = support.recorder && (kind === 'screen' ? support.screen : support.media);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-ink-600/70 p-3"><span className="label">Record</span><p className="mt-1 text-[11px] leading-relaxed text-zinc-500">Capture straight into your project. Nothing is uploaded — recordings stay in this browser.</p></div>
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Recording source">
          {SOURCES.map(({ id, label, hint, icon: Icon }) => (
            <button key={id} type="button" role="radio" aria-checked={kind === id} disabled={busy} title={hint} onClick={() => setKind(id)}
              className={`flex flex-col items-center gap-1.5 rounded-xl border px-1 py-3 text-[11px] font-semibold transition disabled:opacity-50 ${kind === id ? 'border-violet-400 bg-violet-500/15 text-white' : 'border-ink-500 text-zinc-400 hover:border-ink-400 hover:text-zinc-100'}`}>
              <Icon size={18} />{label}
            </button>
          ))}
        </div>

        <div className={`relative overflow-hidden rounded-xl border border-ink-500 bg-black ${kind === 'voice' ? 'h-24' : 'aspect-video'}`}>
          {kind !== 'voice' && <video ref={video} muted playsInline className="h-full w-full object-contain" />}
          {!live && phase !== 'starting' && <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-3 text-center text-[11px] text-zinc-500">{kind === 'voice' ? <Mic size={22} /> : kind === 'screen' ? <MonitorUp size={22} /> : <Camera size={22} />}<span>{SOURCES.find((x) => x.id === kind)?.hint}</span></div>}
          {phase === 'starting' && <div className="absolute inset-0 flex items-center justify-center text-xs text-zinc-300" role="status">Waiting for permission…</div>}
          {phase === 'countdown' && <div className="absolute inset-0 flex items-center justify-center bg-black/55 text-6xl font-black text-white" role="status" aria-live="assertive">{count}</div>}
          {(phase === 'recording' || phase === 'paused') && <div className="absolute left-2 top-2 flex items-center gap-1.5 rounded bg-black/65 px-2 py-1 font-mono text-[11px] text-white"><i className={`h-2 w-2 rounded-full ${phase === 'recording' ? 'animate-pulse bg-red-500' : 'bg-amber-400'}`} />{phase === 'paused' ? 'PAUSED' : 'REC'} {formatElapsed(elapsed)}</div>}
        </div>

        {live && <div className="h-2 overflow-hidden rounded bg-ink-700" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={1} aria-valuenow={Number(level.toFixed(2))}><i className="block h-full rounded bg-gradient-to-r from-emerald-400 via-yellow-300 to-red-500 transition-[width] duration-100" style={{ width: `${Math.round(level * 100)}%` }} /></div>}

        <div className="flex items-center gap-2">
          {!live ? (
            <button type="button" disabled={busy || !usable} onClick={() => void start()} className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 px-3 text-xs font-bold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"><Circle size={13} fill="currentColor" />{phase === 'saving' ? 'Saving…' : 'Start recording'}</button>
          ) : (
            <>
              <button type="button" disabled={phase === 'countdown'} onClick={() => void finish()} className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 px-3 text-xs font-bold text-white hover:bg-red-500 disabled:opacity-40"><Square size={12} fill="currentColor" />Stop &amp; add</button>
              <button type="button" disabled={phase === 'countdown'} className="btn-icon !h-9 !w-9" aria-label={phase === 'paused' ? 'Resume recording' : 'Pause recording'} title={phase === 'paused' ? 'Resume' : 'Pause'} onClick={() => { const r = recorder.current; if (!r) return; if (phase === 'paused') { r.resume(); setPhase('recording'); } else { r.pause(); setPhase('paused'); } }}>{phase === 'paused' ? <Play size={14} /> : <Pause size={14} />}</button>
              <button type="button" className="btn-icon !h-9 !w-9" aria-label="Discard recording" title="Discard" onClick={abort}><X size={14} /></button>
            </>
          )}
        </div>
        {error && <p role="alert" className="rounded border border-red-500/30 bg-red-500/10 p-2 text-[11px] text-red-300">{error}</p>}
        {!usable && <p className="rounded border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-200">{kind === 'screen' ? 'Screen capture is not supported here (try desktop Chrome, Edge or Firefox).' : 'Camera/microphone capture needs a supported browser on https or localhost.'}</p>}

        <fieldset disabled={busy} className="space-y-2 text-[11px] text-zinc-300 disabled:opacity-60">
          {kind === 'screen' && <label className="flex items-center gap-2"><input type="checkbox" checked={systemAudio} onChange={(e) => setSystemAudio(e.target.checked)} />Include system / tab audio <span className="text-zinc-500">(tick “Share audio” in the picker)</span></label>}
          {kind !== 'voice' && <label className="flex items-center gap-2"><input type="checkbox" checked={mic} onChange={(e) => setMic(e.target.checked)} />{kind === 'screen' ? 'Narrate with microphone' : 'Record microphone'}</label>}
          {(mic || kind === 'voice') && <label className="block">Microphone<select className="field mt-1" value={micId} onChange={(e) => setMicId(e.target.value)}><option value="">System default</option>{mics.map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>)}</select></label>}
          {kind === 'webcam' && <label className="block">Camera<select className="field mt-1" value={camId} onChange={(e) => setCamId(e.target.value)}><option value="">System default</option>{cams.map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>)}</select></label>}
          <label className="flex items-center gap-2"><input type="checkbox" checked={countdownOn} onChange={(e) => setCountdownOn(e.target.checked)} />3-2-1 countdown</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={autoPlace} onChange={(e) => setAutoPlace(e.target.checked)} />Add to timeline when finished</label>
        </fieldset>
      </div>
    </div>
  );
}

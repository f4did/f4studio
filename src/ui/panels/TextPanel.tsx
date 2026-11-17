import { Clock3, Download, FileText, Mic, Square, Type, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../../store/editor';
import type { TextStyle } from '../../core';

type SpeechResult = { isFinal: boolean; [index: number]: { transcript: string } };
type SpeechResultList = { length: number; [index: number]: SpeechResult };
type SpeechEvent = Event & { results: SpeechResultList };
interface SpeechRecognizer {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onend: (() => void) | null;
  onerror: ((event: Event) => void) | null;
  onresult: ((event: SpeechEvent) => void) | null;
  start: () => void;
  stop: () => void;
}
type SpeechRecognizerConstructor = new () => SpeechRecognizer;

export function TextPanel() {
  const addText = useEditor((s) => s.addText);
  const patchClip = useEditor((s) => s.patchClip);
  const importSrt = useEditor((s) => s.importSrt);
  const importTranscript = useEditor((s) => s.importTranscript);
  const exportSrt = useEditor((s) => s.exportSrt);
  const addCaption = useEditor((s) => s.addCaption);
  const addTimer = useEditor((s) => s.addTimer);
  const notify = useEditor((s) => s.notify);
  const input = useRef<HTMLInputElement>(null);
  const transcriptInput = useRef<HTMLInputElement>(null);
  const recognizer = useRef<SpeechRecognizer | null>(null);
  const capturing = useRef(false);
  const [captioning, setCaptioning] = useState(false);
  useEffect(() => () => { capturing.current = false; recognizer.current?.stop(); }, []);

  const toggleCaptioning = () => {
    if (captioning) {
      capturing.current = false;
      recognizer.current?.stop();
      setCaptioning(false);
      notify('Automatic caption capture stopped.');
      return;
    }
    const speechWindow = window as Window & { SpeechRecognition?: SpeechRecognizerConstructor; webkitSpeechRecognition?: SpeechRecognizerConstructor };
    const Constructor = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Constructor) {
      notify('This browser does not provide Speech Recognition. Import an SRT file instead.');
      return;
    }
    const instance = new Constructor();
    instance.continuous = true;
    instance.interimResults = false;
    instance.lang = navigator.language || 'en-US';
    instance.onresult = (event) => {
      const state = useEditor.getState();
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result?.isFinal) addCaption(result[0]?.transcript ?? '', state.playhead, Math.max(1, Math.round(state.project().settings.fps * 2)));
      }
    };
    instance.onerror = () => notify('Speech recognition stopped or permission was denied.');
    instance.onend = () => {
      if (!capturing.current) return;
      try { instance.start(); } catch { /* browser is already restarting recognition */ }
    };
    recognizer.current = instance;
    capturing.current = true;
    setCaptioning(true);
    notify('Listening for speech. Play the timeline and speak near the microphone.');
    try { instance.start(); } catch { capturing.current = false; setCaptioning(false); notify('Could not start Speech Recognition.'); }
  };
  const downloadSrt = () => {
    const url = URL.createObjectURL(new Blob([exportSrt()], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'f4-subtitles.srt';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const addPreset = (text: string, name: string, style: Partial<TextStyle>) => {
    addText(text);
    const id = useEditor.getState().selection[0];
    const clip = id ? useEditor.getState().project().clips[id] : undefined;
    if (id && clip?.text) patchClip(id, { name, text: { ...clip.text, style: { ...clip.text.style, ...style } } });
  };
  const presets: Array<[string, string, Partial<TextStyle>]> = [
    ['BIG TITLE', 'Bold title', { fontFamily: 'Georgia, serif', fontSize: 116, fontWeight: 900, gradient: { from: '#ffffff', to: '#c4b5fd', angle: 90 } }],
    ['A beautiful subtitle', 'Subtitle', { fontFamily: 'Georgia, serif', fontSize: 58, fontWeight: 500, color: '#f4f2ff' }],
    ['NEON NIGHTS', 'Neon', { fontFamily: 'Arial Black, sans-serif', fontSize: 104, fontWeight: 900, gradient: { from: '#22d3ee', to: '#ec4899', angle: 90 }, shadow: { color: '#ec4899', blur: 24, offsetX: 0, offsetY: 0 } }],
    ['Your Name', 'Lower third', { fontFamily: 'Inter, sans-serif', fontSize: 54, fontWeight: 700, background: { color: '#000000', padding: 18, radius: 12 } }],
    ['Typing this out…', 'Typewriter', { fontFamily: 'Courier New, monospace', fontSize: 72, fontWeight: 700 }],
    ['SIGNAL LOST', 'Glitch', { fontFamily: 'Arial Black, sans-serif', fontSize: 110, fontWeight: 900, gradient: { from: '#f472b6', to: '#22d3ee', angle: 0 } }],
    ['Captions look great', 'Caption', { fontFamily: 'Inter, sans-serif', fontSize: 48, fontWeight: 700, background: { color: '#000000', padding: 16, radius: 14 } }],
    ['wavy vibes', 'Wavy', { fontFamily: 'Georgia, serif', fontSize: 110, fontWeight: 800, gradient: { from: '#22d3ee', to: '#f472b6', angle: 90 } }],
    ['BOUNCE!', 'Bounce', { fontFamily: 'Arial Black, sans-serif', fontSize: 112, fontWeight: 900, color: '#fde047', outline: { color: '#7c2d12', width: 5 } }],
    ['MAKE IT COUNT', 'Gradient hero', { fontFamily: 'Arial Black, sans-serif', fontSize: 92, fontWeight: 900, letterSpacing: 2, gradient: { from: '#facc15', to: '#f472b6', angle: 0 } }],
    ['Chapter 01', 'Chapter card', { fontFamily: 'Courier New, monospace', fontSize: 60, fontWeight: 700, letterSpacing: 4, color: '#22d3ee', background: { color: '#071b2e', padding: 20, radius: 12 } }],
    ['stay curious', 'Soft serif', { fontFamily: 'Georgia, serif', fontSize: 96, fontWeight: 500, italic: true, color: '#f9a8d4', shadow: { color: '#ec4899', blur: 14, offsetX: 0, offsetY: 2 } }],
    ['PLAY IT LOUD', 'Outline poster', { fontFamily: 'Arial Black, sans-serif', fontSize: 88, fontWeight: 900, color: 'transparent', outline: { color: '#fde047', width: 6 }, letterSpacing: 3 }],
    ['03:45', 'Time stamp', { fontFamily: 'Courier New, monospace', fontSize: 76, fontWeight: 700, color: '#a7f3d0', background: { color: '#052e2b', padding: 14, radius: 8 } }],
  ] as const;
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-ink-600/70 p-3"><span className="label">Text</span></div>
      <div className="text-panel-scroll min-h-0 flex-1 space-y-2 overflow-y-auto p-3 pr-2">
        <button className="flex w-full items-center gap-2 rounded border border-ink-500 bg-ink-800 p-3 text-left hover:border-violet-500" onClick={() => addText('Your text here')}>
          <Type size={16} className="text-violet-400" />
          <span className="text-sm font-semibold">Add text at playhead</span>
        </button>
        <div className="grid grid-cols-2 gap-2"><button className="inline-flex h-9 items-center justify-center gap-1.5 rounded border border-cyan-400/30 bg-cyan-500/10 text-[11px] text-cyan-200 hover:border-cyan-300" onClick={() => addTimer('stopwatch')}><Clock3 size={13} /> Stopwatch</button><button className="inline-flex h-9 items-center justify-center gap-1.5 rounded border border-fuchsia-400/30 bg-fuchsia-500/10 text-[11px] text-fuchsia-200 hover:border-fuchsia-300" onClick={() => addTimer('countdown')}><Clock3 size={13} /> Countdown</button></div>
        <div className="mt-4"><div className="mb-2 flex items-center justify-between"><span className="label">Text presets</span><span className="text-[10px] text-zinc-600">editable after adding</span></div><div className="grid grid-cols-2 gap-2">{presets.map(([value, label, style]) => <button key={label} className="group flex min-h-[90px] flex-col justify-between rounded-2xl border border-ink-600 bg-ink-800 p-3 text-left hover:border-fuchsia-300 hover:bg-fuchsia-500/10" onClick={() => addPreset(value, label, style)}><span className="line-clamp-2 text-center text-sm text-zinc-100" style={{ fontFamily: style.fontFamily, fontSize: 16, fontWeight: Number(style.fontWeight ?? 700), fontStyle: style.italic ? 'italic' : 'normal', background: style.background?.color ?? 'transparent' }}>{value}</span><span className="text-[10px] text-zinc-500">{label}</span></button>)}</div></div>
        <div className="grid grid-cols-2 gap-2">
          <button className="inline-flex h-8 items-center justify-center gap-1.5 rounded border border-ink-500 bg-ink-800 text-[11px] text-zinc-300 hover:border-violet-500" onClick={() => input.current?.click()}><Upload size={13} /> Import SRT</button>
          <button className="inline-flex h-8 items-center justify-center gap-1.5 rounded border border-ink-500 bg-ink-800 text-[11px] text-zinc-300 hover:border-violet-500" onClick={downloadSrt}><Download size={13} /> Export SRT</button>
        </div>
        <button className={`inline-flex h-9 w-full items-center justify-center gap-2 rounded border text-[11px] ${captioning ? 'border-rose-400/70 bg-rose-500/10 text-rose-200' : 'border-ink-500 bg-ink-800 text-zinc-300 hover:border-violet-500'}`} aria-pressed={captioning} onClick={toggleCaptioning}>
          {captioning ? <Square size={13} /> : <Mic size={13} />} {captioning ? 'Stop automatic captions' : 'Capture automatic captions'}
        </button>
        <input ref={input} type="file" accept=".srt,text/plain" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void file.text().then(importSrt); event.target.value = ''; }} />
        <button className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded border border-ink-500 bg-ink-800 text-[11px] text-zinc-300 hover:border-violet-500" onClick={() => transcriptInput.current?.click()}><FileText size={13} /> Time a plain transcript automatically</button>
        <input ref={transcriptInput} type="file" accept=".txt,text/plain" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void file.text().then(importTranscript); event.target.value = ''; }} />
        <div className="flex items-center gap-2 rounded border border-ink-600/70 bg-ink-900 p-2 text-[10px] text-zinc-500"><FileText size={13} className="shrink-0 text-violet-400" />Subtitle cues become editable text clips on the text track.</div>
        <p className="text-[11px] leading-relaxed text-zinc-500">
          Add text, capture browser speech as editable captions, automatically time a plain transcript, import SRT cues, or export your project text clips as SRT. Edit content, styling, animation, and timing in the inspector.
        </p>
      </div>
    </div>
  );
}

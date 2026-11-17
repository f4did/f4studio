import { useEffect, useMemo, useRef, useState } from 'react';
import { Command, Search } from 'lucide-react';
import { createProject } from '../../core';
import { engine } from '../../engine/playback';
import { useEditor } from '../../store/editor';
import { autoCutSilence } from '../../engine/smart';

export type ToolId = 'media' | 'audio' | 'text' | 'shapes' | 'templates' | 'transitions' | 'effects' | 'backgrounds' | 'record' | 'library';

export interface PaletteCommand {
  id: string;
  label: string;
  detail: string;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onTool: (tool: ToolId) => void;
}

export function CommandPalette({ open, onClose, onTool }: CommandPaletteProps) {
  const playing = useEditor((s) => s.playing);
  const snapping = useEditor((s) => s.snapping);
  const magnetic = useEditor((s) => s.magnetic);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const commands = useMemo<PaletteCommand[]>(() => {
    const s = useEditor.getState();
    return [
      { id: 'new-project', label: 'New empty project', detail: 'Project', run: () => { s.loadProject(createProject()); } },
      { id: 'play', label: playing ? 'Pause preview' : 'Play preview', detail: 'Playback · Space', run: () => { const current = useEditor.getState(); current.playing ? engine.pause() : engine.play(); } },
      { id: 'split', label: 'Split selected at playhead', detail: 'Timeline · S', run: () => s.splitSelection() },
      { id: 'duplicate', label: 'Duplicate selected clips', detail: 'Timeline · Ctrl/Cmd+D', run: () => s.duplicateSelection() },
      { id: 'delete', label: 'Delete selected clips', detail: 'Timeline · Delete', run: () => s.deleteSelection() },
      { id: 'ripple-delete', label: 'Ripple delete selected clips', detail: 'Timeline · Shift+Delete', run: () => s.deleteSelection(true) },
      { id: 'undo', label: 'Undo last edit', detail: 'History · Ctrl/Cmd+Z', run: () => s.undo() },
      { id: 'redo', label: 'Redo last edit', detail: 'History · Ctrl/Cmd+Shift+Z', run: () => s.redo() },
      { id: 'add-text', label: 'Add text clip', detail: 'Create', run: () => { onTool('text'); s.addText(); } },
      { id: 'add-visualizer', label: 'Add spectrum visualizer', detail: 'Create', run: () => { onTool('audio'); s.addVisualizer('spectrum'); } },
      { id: 'marker', label: 'Add marker at playhead', detail: 'Timeline · M', run: () => s.placeMarker() },
      { id: 'snapping', label: `${snapping ? 'Disable' : 'Enable'} snapping`, detail: 'Timeline', run: () => useEditor.setState({ snapping: !useEditor.getState().snapping }) },
      { id: 'magnetic', label: `${magnetic ? 'Disable' : 'Enable'} magnetic timeline`, detail: 'Timeline', run: () => useEditor.setState({ magnetic: !useEditor.getState().magnetic }) },
      { id: 'auto-cut', label: 'Auto-cut silences in selected clip', detail: 'Smart tools', run: () => { void autoCutSilence().then((m) => useEditor.getState().notify(m)); } },
      { id: 'zoom-fit', label: 'Zoom timeline to fit project', detail: 'Timeline · F', run: () => window.dispatchEvent(new Event('f4-zoom-fit')) },
      { id: 'export-presets', label: 'Export presets (YouTube, TikTok, Instagram…)', detail: 'Export · Ctrl/Cmd+E', run: () => window.dispatchEvent(new Event('f4-open-export-presets')) },
      { id: 'export-now', label: 'Export MP4 now', detail: 'Export', run: () => window.dispatchEvent(new Event('f4-export')) },
      { id: 'save-file', label: 'Save project file (.f4proj)', detail: 'Project · Ctrl/Cmd+Shift+S', run: () => window.dispatchEvent(new Event('f4-save-project-file')) },
      { id: 'record', label: 'Record screen, camera or voice-over', detail: 'Create', run: () => onTool('record') },
      ...([
        ['media', 'Open Media workspace'], ['record', 'Open Record workspace'], ['library', 'Open Library (music, SFX, backdrops, stickers)'], ['audio', 'Open Audio workspace'], ['text', 'Open Text workspace'],
        ['templates', 'Open Templates workspace'], ['transitions', 'Open Transitions workspace'],
        ['effects', 'Open Effects workspace'], ['backgrounds', 'Open Backdrops workspace'], ['shapes', 'Open Shapes workspace'],
      ] as const).map(([id, label]) => ({ id: `tool-${id}`, label, detail: 'Workspace', run: () => onTool(id) })),
    ];
  }, [magnetic, onTool, playing, snapping]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? commands.filter((item) => `${item.label} ${item.detail}`.toLowerCase().includes(q)) : commands;
  }, [commands, query]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    window.setTimeout(() => input.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    if (active >= filtered.length) setActive(Math.max(0, filtered.length - 1));
  }, [active, filtered.length]);

  if (!open) return null;
  const execute = (command: PaletteCommand | undefined) => {
    if (!command) return;
    command.run();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/65 px-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Command palette" onMouseDown={onClose}>
      <div className="w-[min(560px,100%)] overflow-hidden rounded-xl border border-ink-500 bg-ink-850 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-ink-600/70 px-3">
          <Search size={16} className="text-zinc-500" />
          <input ref={input} value={query} onChange={(e) => { setQuery(e.target.value); setActive(0); }} onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((n) => Math.min(n + 1, filtered.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((n) => Math.max(n - 1, 0)); }
            else if (e.key === 'Enter') { e.preventDefault(); execute(filtered[active]); }
          }} className="h-12 min-w-0 flex-1 bg-transparent text-sm text-zinc-100 outline-none" placeholder="Search commands…" aria-label="Search commands" />
          <kbd className="hidden rounded border border-ink-500 px-1.5 py-0.5 text-[10px] text-zinc-500 sm:inline">Esc</kbd>
        </div>
        <div className="max-h-[min(420px,60vh)] overflow-y-auto p-1.5">
          {filtered.length === 0 ? <p className="px-3 py-8 text-center text-xs text-zinc-500">No matching commands.</p> : filtered.map((command, index) => (
            <button key={command.id} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left ${index === active ? 'bg-violet-600/20 text-white' : 'text-zinc-300 hover:bg-ink-700'}`} onMouseEnter={() => setActive(index)} onClick={() => execute(command)}>
              <Command size={14} className={index === active ? 'text-violet-300' : 'text-zinc-500'} />
              <span className="min-w-0 flex-1 truncate text-xs font-medium">{command.label}</span>
              <span className="text-[10px] text-zinc-600">{command.detail}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

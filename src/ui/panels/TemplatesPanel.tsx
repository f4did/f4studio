import { AudioWaveform, Check, LayoutTemplate, Sparkles } from 'lucide-react';
import { PROJECT_TEMPLATES } from '../../core';
import { useEditor } from '../../store/editor';

export function TemplatesPanel() {
  const applyTemplate = useEditor((state) => state.applyTemplate);
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-ink-600/70 p-3"><div className="label">Templates</div><h2 className="mt-1 text-sm font-semibold text-zinc-100">Starter projects</h2></div>
      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {PROJECT_TEMPLATES.map((template) => (
          <article key={template.id} className="group overflow-hidden rounded-xl border border-ink-600/70 bg-ink-800 transition-all hover:-translate-y-0.5 hover:border-violet-400/70 hover:shadow-xl hover:shadow-violet-950/20">
            <div className="relative h-20 overflow-hidden p-3" style={{ background: `radial-gradient(circle at 78% 25%, ${template.accent}88, transparent 34%), linear-gradient(135deg, ${template.background}, #09090b)` }}><div className="absolute inset-x-3 bottom-3 flex items-end justify-between"><div className="h-1 w-24 rounded-full" style={{ background: template.accent }} /><div className="flex gap-1 text-[9px] uppercase tracking-wider text-white/70"><span className="rounded bg-black/30 px-1.5 py-0.5">{template.aspect}</span>{template.includeVisualizer && <span className="flex items-center gap-1 rounded bg-black/30 px-1.5 py-0.5"><AudioWaveform size={9} /> audio</span>}</div></div></div>
            <div className="p-3"><div className="mb-1 flex items-center gap-2"><div className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: `${template.accent}22`, color: template.accent }}><LayoutTemplate size={14} /></div><h3 className="text-xs font-semibold text-zinc-100">{template.name}</h3></div>
            <p className="mb-3 min-h-8 text-[11px] leading-relaxed text-zinc-500">{template.description}</p>
            <div className="mb-3 flex items-center gap-2 text-[9px] uppercase tracking-wider text-zinc-600"><Sparkles size={11} className="text-violet-300" /> Editable starter project</div>
            <button className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-violet-600/20 text-[11px] font-medium text-violet-200 transition-colors hover:bg-violet-600/35" onClick={() => applyTemplate(template.id)}><Check size={13} /> Open & customize</button></div>
          </article>
        ))}
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';

/** Slider that edits locally while dragging and commits ONE history step on release. */
export function Slider({ label, value, min, max, step, format, onCommit }: {
  label: string; value: number; min: number; max: number; step: number; format?: (v: number) => string; onCommit: (v: number) => void;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  const commit = () => { if (local !== value) onCommit(local); };
  return (
    <label className="block">
      <div className="mb-1 flex justify-between"><span className="label">{label}</span><span className="font-mono text-[11px] text-zinc-400">{format ? format(local) : local.toFixed(2)}</span></div>
      <input type="range" className="w-full accent-violet-500" min={min} max={max} step={step} value={local}
        onChange={(e) => setLocal(Number(e.target.value))} onPointerUp={commit} onKeyUp={commit} onBlur={commit} />
    </label>
  );
}

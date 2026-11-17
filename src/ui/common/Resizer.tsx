import { useRef, useState } from 'react';

interface Props {
  axis: 'x' | 'y';
  /** Called with the pointer delta in px since drag start. */
  onResize: (deltaPx: number) => void;
  label: string;
}

/** Pointer-captured divider. Works with mouse, touch and pen; keyboard arrows nudge by 16px. */
export function Resizer({ axis, onResize, label }: Props) {
  const start = useRef<number | null>(null);
  const [active, setActive] = useState(false);
  return (
    <div
      role="separator"
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-label={label}
      tabIndex={0}
      className={`${axis === 'x' ? 'resize-h' : 'resize-v'} shrink-0 transition-colors ${active ? 'resize-active' : ''}`}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = axis === 'x' ? e.clientX : e.clientY;
        setActive(true);
      }}
      onPointerMove={(e) => {
        if (start.current === null) return;
        const pos = axis === 'x' ? e.clientX : e.clientY;
        onResize(pos - start.current);
        start.current = pos;
      }}
      onPointerUp={() => {
        start.current = null;
        setActive(false);
      }}
      onKeyDown={(e) => {
        const step = 16;
        if (axis === 'x' && e.key === 'ArrowLeft') onResize(-step);
        if (axis === 'x' && e.key === 'ArrowRight') onResize(step);
        if (axis === 'y' && e.key === 'ArrowUp') onResize(-step);
        if (axis === 'y' && e.key === 'ArrowDown') onResize(step);
      }}
    />
  );
}

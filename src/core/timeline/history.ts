/**
 * Snapshot-based undo/redo. Project edits are immutable with structural sharing,
 * so storing references is cheap and every edit (including multi-clip edits) is one undo step.
 */
export interface HistoryState<T> {
  past: T[];
  present: T;
  future: T[];
}

export const HISTORY_LIMIT = 200;

export function createHistory<T>(present: T): HistoryState<T> {
  return { past: [], present, future: [] };
}

/** Commit a new present. A reference-equal value is a no-op and does not touch the stack. */
export function commit<T>(h: HistoryState<T>, next: T, limit = HISTORY_LIMIT): HistoryState<T> {
  if (next === h.present) return h;
  const past = [...h.past, h.present];
  if (past.length > limit) past.splice(0, past.length - limit);
  return { past, present: next, future: [] };
}

/** Replace the present without creating an undo step (e.g. live drag previews, autosave bookkeeping). */
export function replacePresent<T>(h: HistoryState<T>, next: T): HistoryState<T> {
  return next === h.present ? h : { ...h, present: next };
}

export const canUndo = <T>(h: HistoryState<T>) => h.past.length > 0;
export const canRedo = <T>(h: HistoryState<T>) => h.future.length > 0;

export function undo<T>(h: HistoryState<T>): HistoryState<T> {
  const prev = h.past[h.past.length - 1];
  if (prev === undefined) return h;
  return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] };
}

export function redo<T>(h: HistoryState<T>): HistoryState<T> {
  const [next, ...rest] = h.future;
  if (next === undefined) return h;
  return { past: [...h.past, h.present], present: next, future: rest };
}

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { LIBRARY_COLUMN_LIMITS, LIBRARY_COLUMN_WIDTHS_KEY, clampLibraryColumnWidth, libraryColumnWidthsStyle, parseLibraryColumnWidths, type LibraryColumnField, type LibraryColumnWidths } from "../lib/library-column-widths.js";

function readStoredWidths(): LibraryColumnWidths {
  try { return parseLibraryColumnWidths(window.localStorage.getItem(LIBRARY_COLUMN_WIDTHS_KEY)); }
  catch { return {}; }
}

function saveWidths(widths: LibraryColumnWidths) {
  try {
    if (Object.keys(widths).length) window.localStorage.setItem(LIBRARY_COLUMN_WIDTHS_KEY, JSON.stringify(widths));
    else window.localStorage.removeItem(LIBRARY_COLUMN_WIDTHS_KEY);
  } catch { /* Private/quota-restricted storage must not prevent resizing. */ }
}

function headerGeometry(header: HTMLElement): { width: number; zoom: number } | undefined {
  const style = window.getComputedStyle(header);
  const rect = header.getBoundingClientRect();
  if (style.display === "none" || !(rect.width > 0)) return undefined;
  // Computed width preserves fractional CSS grid tracks; offsetWidth rounds them.
  const computed = Number.parseFloat(style.width);
  const width = computed > 0 ? computed : header.offsetWidth || rect.width;
  const zoom = rect.width / width;
  return { width, zoom: Number.isFinite(zoom) && zoom > 0 ? zoom : 1 };
}

function measureVisibleColumns(handle: HTMLElement): LibraryColumnWidths {
  const table = handle.closest(".library-list-table");
  const widths: LibraryColumnWidths = {};
  table?.querySelectorAll<HTMLElement>('[role="columnheader"][data-library-column]').forEach(header => {
    const field = header.dataset.libraryColumn as LibraryColumnField;
    if (!Object.hasOwn(LIBRARY_COLUMN_LIMITS, field)) return;
    const geometry = headerGeometry(header);
    if (geometry) widths[field] = clampLibraryColumnWidth(field, geometry.width);
  });
  return widths;
}

type Drag = {
  before: LibraryColumnWidths;
  pointerId: number;
  handle: HTMLSpanElement;
  cleanup: () => void;
};

type HandleProps = {
  field: LibraryColumnField;
  label: string;
  active: boolean;
  widths: LibraryColumnWidths;
  onStart: (field: LibraryColumnField, event: PointerEvent<HTMLSpanElement>) => void;
  onKey: (field: LibraryColumnField, event: KeyboardEvent<HTMLSpanElement>) => void;
  onReset: (field: LibraryColumnField) => void;
  onUnmount: (handle: HTMLSpanElement) => void;
};

function LibraryColumnResizeHandle({ field, label, active, widths, onStart, onKey, onReset, onUnmount }: HandleProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [measured, setMeasured] = useState<number | undefined>(undefined);
  useEffect(() => {
    const handle = ref.current;
    return () => { if (handle) onUnmount(handle); };
  }, [onUnmount]);
  useLayoutEffect(() => {
    const header = ref.current?.closest<HTMLElement>('[role="columnheader"]');
    if (!header) return;
    const measure = () => {
      const geometry = headerGeometry(header);
      setMeasured(geometry ? Math.round(geometry.width) : undefined);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(header);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [widths]);
  return <span ref={ref} role="separator" tabIndex={0} aria-label={`调整${label}列宽`} aria-orientation="vertical"
    aria-valuemin={LIBRARY_COLUMN_LIMITS[field].min} aria-valuemax={LIBRARY_COLUMN_LIMITS[field].max}
    aria-valuenow={measured} aria-valuetext={measured === undefined ? undefined : `${measured} 像素`}
    title="拖动调整列宽；方向键微调，Shift 加速；双击或按 Enter 恢复默认"
    className="library-column-resizer" data-active={active}
    onPointerDown={event => onStart(field, event)}
    onKeyDown={event => onKey(field, event)}
    onClick={event => { event.preventDefault(); event.stopPropagation(); }}
    onDoubleClick={event => { event.preventDefault(); event.stopPropagation(); onReset(field); }}
    onDragStart={event => { event.preventDefault(); event.stopPropagation(); }} />;
}

export function useLibraryColumnWidths(): {
  style: CSSProperties;
  hasCustomWidths: boolean;
  resizing: boolean;
  resetAll: () => void;
  renderHandle: (field: LibraryColumnField, label: string) => ReactNode;
} {
  const [widths, setWidths] = useState<LibraryColumnWidths>(readStoredWidths);
  const widthsRef = useRef(widths);
  const dragRef = useRef<Drag | null>(null);
  const [activeField, setActiveField] = useState<LibraryColumnField | null>(null);
  const replace = useCallback((next: LibraryColumnWidths) => { widthsRef.current = next; setWidths(next); }, []);
  const finish = useCallback((commit: boolean) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    drag.cleanup();
    if (commit) saveWidths(widthsRef.current);
    else replace(drag.before);
    setActiveField(null);
  }, [replace]);

  useEffect(() => () => {
    const drag = dragRef.current;
    dragRef.current = null;
    drag?.cleanup();
  }, []);

  const unmountHandle = useCallback((handle: HTMLSpanElement) => {
    if (dragRef.current?.handle === handle) finish(false);
  }, [finish]);

  const reset = useCallback((field?: LibraryColumnField) => {
    finish(false);
    const next = field ? { ...widthsRef.current } : {};
    if (field) delete next[field];
    replace(next);
    saveWidths(next);
  }, [finish, replace]);

  const start = useCallback((field: LibraryColumnField, event: PointerEvent<HTMLSpanElement>) => {
    event.stopPropagation();
    event.preventDefault();
    if (event.button !== 0 || event.isPrimary === false) return;
    finish(false);
    const handle = event.currentTarget;
    const header = handle.closest<HTMLElement>('[role="columnheader"]');
    const geometry = header ? headerGeometry(header) : undefined;
    if (!geometry) return;
    handle.focus({ preventScroll: true });
    const before = { ...widthsRef.current };
    // Freeze every visible track before changing one: otherwise preceding fr
    // tracks absorb the delta and the divider no longer follows the pointer.
    const pinned = { ...before, ...measureVisibleColumns(handle) };
    const startWidth = pinned[field] ?? clampLibraryColumnWidth(field, geometry.width);
    const startX = event.clientX;
    const pointerId = event.pointerId;
    let changed = false;
    const move = (next: globalThis.PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      next.preventDefault(); next.stopPropagation();
      const width = clampLibraryColumnWidth(field, startWidth + (next.clientX - startX) / geometry.zoom);
      changed = width !== startWidth;
      replace({ ...pinned, [field]: width });
    };
    const up = (next: globalThis.PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      next.preventDefault(); next.stopPropagation(); finish(changed);
    };
    const cancelPointer = (next: globalThis.PointerEvent) => { if (next.pointerId === pointerId) finish(false); };
    const lostCapture = (next: globalThis.PointerEvent) => { if (next.target === handle) cancelPointer(next); };
    const cancel = () => finish(false);
    const key = (next: globalThis.KeyboardEvent) => {
      if (next.key === "Escape") { next.preventDefault(); next.stopPropagation(); finish(false); }
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", cancelPointer, true);
      handle.removeEventListener("lostpointercapture", lostCapture);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", cancel);
      try { handle.releasePointerCapture(pointerId); } catch { /* Capture may already be lost. */ }
    };
    dragRef.current = { before, pointerId, handle, cleanup };
    replace(pinned);
    setActiveField(field);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", cancelPointer, true);
    handle.addEventListener("lostpointercapture", lostCapture);
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", cancel);
    try { handle.setPointerCapture(pointerId); } catch { /* Window listeners also cover older hosts. */ }
  }, [finish, replace]);

  const keyboard = useCallback((field: LibraryColumnField, event: KeyboardEvent<HTMLSpanElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End", "Enter", "Delete"].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    if (event.key === "Enter" || event.key === "Delete") { reset(field); return; }
    finish(false);
    const pinned = { ...widthsRef.current, ...measureVisibleColumns(event.currentTarget) };
    const current = pinned[field] ?? LIBRARY_COLUMN_LIMITS[field].min;
    const step = event.shiftKey ? 64 : 16;
    const next = event.key === "Home" ? LIBRARY_COLUMN_LIMITS[field].min
      : event.key === "End" ? LIBRARY_COLUMN_LIMITS[field].max
      : current + (event.key === "ArrowRight" ? step : -step);
    pinned[field] = clampLibraryColumnWidth(field, next);
    replace(pinned); saveWidths(pinned);
  }, [finish, replace, reset]);

  return {
    style: libraryColumnWidthsStyle(widths),
    hasCustomWidths: Object.keys(widths).length > 0,
    resizing: activeField !== null,
    resetAll: () => reset(),
    renderHandle: (field, label) => <LibraryColumnResizeHandle key={field} field={field} label={label} active={activeField === field} widths={widths} onStart={start} onKey={keyboard} onReset={reset} onUnmount={unmountHandle} />,
  };
}

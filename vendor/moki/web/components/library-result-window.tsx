import { defaultRangeExtractor, useVirtualizer, type Range } from "@tanstack/react-virtual";
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { ResourceLibraryItem } from "../../shared/resource-library-contract.js";

type Props = {
  items: ResourceLibraryItem[];
  viewMode: "grid" | "list";
  scrollRef: RefObject<HTMLDivElement | null>;
  loading: boolean;
  draggedId: string;
  renamingId: string;
  children: (item: ResourceLibraryItem) => ReactNode;
  renderProbe: (mounted: ResourceLibraryItem[]) => ReactNode;
};

function collectionClass(viewMode: Props["viewMode"]) {
  return viewMode === "grid"
    ? "library-resource-grid grid min-w-0 max-w-full"
    : "library-resource-list w-full min-w-0 max-w-full";
}

export function LibraryResultWindow(props: Props) {
  if (props.items.length > 64) return <WindowedResults {...props} />;
  return <>
    {props.renderProbe(props.items)}
    <div className={collectionClass(props.viewMode)} data-result-count={props.items.length}>
      {props.items.map(props.children)}
    </div>
  </>;
}

function WindowedResults({ items, viewMode, scrollRef, loading, draggedId, renamingId, renderProbe, children }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [focusedId, setFocusedId] = useState("");
  const [layout, setLayout] = useState({ columns: 1, gap: 0, margin: 0 });

  useLayoutEffect(() => {
    const container = containerRef.current;
    const scroll = scrollRef.current;
    if (!container || !scroll) return;
    function measureLayout() {
      const css = getComputedStyle(container!);
      const columns = viewMode === "grid" ? css.gridTemplateColumns.split(/\s+/).length : 1;
      const gap = viewMode === "grid" ? parseFloat(css.rowGap) || 0 : 0;
      const margin = Math.round(container!.getBoundingClientRect().top - scroll!.getBoundingClientRect().top + scroll!.scrollTop);
      setLayout(previous => previous.columns === columns && previous.gap === gap && previous.margin === margin
        ? previous : { columns, gap, margin });
    }
    measureLayout();
    const observer = new ResizeObserver(measureLayout);
    observer.observe(container);
    observer.observe(scroll);
    return () => observer.disconnect();
  }, [scrollRef, viewMode, loading]);

  const { columns, gap, margin } = layout;
  const getItemKey = useCallback((row: number) => `${viewMode}:${columns}:${items[row * columns].id}`, [columns, items, viewMode]);
  const rangeExtractor = useCallback((range: Range) => {
    const rows = defaultRangeExtractor(range);
    for (const id of [draggedId, renamingId, focusedId]) {
      if (!id) continue;
      const index = items.findIndex(item => item.id === id);
      const row = Math.floor(index / columns);
      if (row >= 0 && !rows.includes(row)) rows.push(row);
    }
    return rows.sort((a, b) => a - b);
  }, [columns, draggedId, focusedId, items, renamingId]);

  const virtualizer = useVirtualizer({
    count: Math.ceil(items.length / columns),
    getScrollElement: () => scrollRef.current,
    estimateSize: () => viewMode === "grid" ? 108 : 50,
    getItemKey,
    gap,
    scrollMargin: margin,
    overscan: 5,
    rangeExtractor,
  });
  const rows = virtualizer.getVirtualItems().map(row => ({
    row,
    entries: items.slice(row.index * columns, (row.index + 1) * columns),
  }));

  return <>
    {renderProbe(rows.flatMap(({ entries }) => entries))}
    <div ref={containerRef} className={`${collectionClass(viewMode)} library-window`} data-result-count={items.length}
      style={{ height: virtualizer.getTotalSize() }}
      onFocusCapture={event => setFocusedId(event.target.closest<HTMLElement>("[data-resource-id]")?.dataset.resourceId ?? "")}
      onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocusedId(""); }}>
      {rows.map(({ row, entries }) => (
        <div key={row.key} ref={virtualizer.measureElement} data-index={row.index} className="library-window-row"
          style={{ transform: `translateY(${row.start - margin}px)` }}>
          {entries.map(children)}
        </div>
      ))}
    </div>
  </>;
}

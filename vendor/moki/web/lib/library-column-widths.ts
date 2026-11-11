import type { CSSProperties } from "react";

export const LIBRARY_COLUMN_WIDTHS_KEY = "moki.library.column-widths.v1";
export const LIBRARY_COLUMN_LIMITS = {
  name: { min: 56, max: 1200 },
  type: { min: 64, max: 320 },
  path: { min: 100, max: 1600 },
  modified: { min: 128, max: 360 },
  added: { min: 128, max: 360 },
} as const;
export type LibraryColumnField = keyof typeof LIBRARY_COLUMN_LIMITS;
export type LibraryColumnWidths = Partial<Record<LibraryColumnField, number>>;

export function clampLibraryColumnWidth(field: LibraryColumnField, width: number): number {
  const { min, max } = LIBRARY_COLUMN_LIMITS[field];
  return Math.min(max, Math.max(min, Number.isFinite(width) ? width : min));
}

export function parseLibraryColumnWidths(serialized: string | null): LibraryColumnWidths {
  try {
    const parsed: unknown = JSON.parse(serialized ?? "null");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const widths: LibraryColumnWidths = {};
    for (const field of Object.keys(LIBRARY_COLUMN_LIMITS) as LibraryColumnField[]) {
      const value = (parsed as Record<string, unknown>)[field];
      if (typeof value === "number" && Number.isFinite(value)) widths[field] = clampLibraryColumnWidth(field, value);
    }
    return widths;
  } catch { return {}; }
}

export function libraryColumnWidthsStyle(widths: LibraryColumnWidths): CSSProperties {
  return Object.fromEntries(Object.entries(widths).map(([field, width]) => [`--library-column-${field}`, `${width}px`])) as CSSProperties;
}

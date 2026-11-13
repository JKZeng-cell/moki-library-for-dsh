import { l as uiText, getLocale, intlLocale, subscribeLocale } from '../../../../src/i18n.js';
import { PageFeedback } from "../components/page-feedback.js";
import { Select as PermissionSelect } from "../components/ui-controls.js";
import { usePageState } from '../lib/page-state.js';
import { useContextMenuPosition } from '../lib/use-context-menu-position.js';
import {
  ArrowDown,
  ArrowUp,
  ArrowDownUp,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardPaste,
  ClipboardCopy,
  Copy,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  FileUp,
  Folder,
  FolderOpen,
  FolderInput,
  ShieldCheck,
  FolderPlus,
  FolderTree,
  Palette,
  PanelRightOpen,
  Grid2X2,
  Link2,
  List,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  Presentation,
  Plus,
  RotateCcw,
  Search,
  Scissors,
  Tag,
  TextCursorInput,
  Trash2,
  X,
} from "lucide-react";
import { createPortal } from "react-dom";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { ResourceLibraryItem } from "../../shared/resource-library-contract.js";
import type { DesktopClipboardResource } from "../../shared/desktop-clipboard-contract.js";
import {
  ASSISTANT_DOWNLOAD_DIRECTORY_TAG,
  ASSISTANT_TASK_DIRECTORY_TAG,
} from "../../shared/assistant-directory-contract.js";
import {
  ASSISTANT_TASK_SPACE_SOURCE_TAG_PREFIX,
  ASSISTANT_TASK_SPACE_TAG,
} from "../../shared/assistant-task-space-contract.js";
import { AppShell } from "../components/app-shell.js";
import { Button, IconButton, Input } from "../components/ui-controls.js";
import { useLibraryColumnWidths } from "../components/library-column-resize.js";
import { ResourceFileIcon } from "../components/resource-file-icon.js";
import { beginLibraryDrag, endLibraryDrag, exportDraggedFiles, nativeFileDrag, pathsForDroppedFiles, prepareFileExport, requestParent, warmNativeFileDrag } from "../lib/library-drag.js";
import { LibraryPathBar } from "../components/library-path-bar.js";
import { LibraryResultWindow } from "../components/library-result-window.js";
import { LibraryDialog } from "../components/library-dialog.js";
import { resourceLibraryPath, resolveResourceLibraryPath } from "../lib/resource-library-path.js";
import { ResourceLibraryPreviewer } from "../components/resource-library-previewer.js";
import {
  createResourceLibraryItem,
  importDroppedFile,
  copyLibraryFile,
  createGeneratedResourceLibraryFile,
  deleteResourceLibraryItem,
  permanentlyDeleteResourceLibraryItem,
  exportResourceLibraryItem,
  getResourceLibraryItems,
  getResourceLibraryIndexStatus,
  importLocalResourceIntoFolder,
  moveResourceLibraryItem,
  openResourceLibraryItem,
  reindexResourceLibraryFolder,
  revealResourceLibraryFolder,
  resourceLibraryAttachmentName,
  resourceLibraryPreviewUrl,
  resourceLibraryThumbnailUrl,
  updateResourceLibraryItem,
} from "../lib/resource-library-api.js";
import {
  clearWorkbenchSelectionContext,
  publishWorkbenchSelectionContext,
} from "../lib/workbench-selection-context.js";

type CreateMode = "folder" | "mapping" | "file";
const LIBRARY_FILE_TYPES = [
  { format: "markdown", get label() { return uiText("Markdown 文档"); }, icon: FileText },
  { format: "docx", get label() { return uiText("Word 文档"); }, icon: FileText },
  { format: "xlsx", get label() { return uiText("Excel 表格"); }, icon: FileSpreadsheet },
  { format: "csv", get label() { return uiText("CSV 表格"); }, icon: FileSpreadsheet },
  { format: "pptx", get label() { return uiText("PowerPoint 演示文稿"); }, icon: Presentation },
  { format: "univer", get label() { return uiText("Univer 多组件文件"); }, icon: Grid2X2 },
] as const;
type CardDropMode = "before" | "inside" | "after";
type LibraryViewMode = "grid" | "list";
type LibraryContextMenu = { x: number; y: number; item?: ResourceLibraryItem };
const FOLDER_COLORS = [
  { id: "violet", get label() { return uiText("紫色"); }, background: "#ebeafd", foreground: "#625bc5", darkBackground: "#2b2948", darkForeground: "#aaa4ff" },
  { id: "blue", get label() { return uiText("蓝色"); }, background: "#e8f0ff", foreground: "#4c76c8", darkBackground: "#21334d", darkForeground: "#8fb9ff" },
  { id: "green", get label() { return uiText("绿色"); }, background: "#e4f6f2", foreground: "#259783", darkBackground: "#1b3b38", darkForeground: "#68d1b8" },
  { id: "amber", get label() { return uiText("黄色"); }, background: "#fff2df", foreground: "#b97625", darkBackground: "#463421", darkForeground: "#f6b75a" },
  { id: "rose", get label() { return uiText("粉色"); }, background: "#ffe8ee", foreground: "#cf5b78", darkBackground: "#452b3b", darkForeground: "#ef8eac" },
  { id: "slate", get label() { return uiText("灰色"); }, background: "#edf0f5", foreground: "#697386", darkBackground: "#343c4b", darkForeground: "#bec9dc" },
] as const;
type FolderColor = (typeof FOLDER_COLORS)[number]["id"];

function folderPaletteStyle(color: (typeof FOLDER_COLORS)[number]) {
  return {
    "--library-folder-background": color.background,
    "--library-folder-foreground": color.foreground,
    "--library-folder-dark-background": color.darkBackground,
    "--library-folder-dark-foreground": color.darkForeground,
  } as CSSProperties;
}

function folderColorStyle(item: ResourceLibraryItem) {
  if (!isFolder(item) || !item.folderColor) return undefined;
  const color = FOLDER_COLORS.find((value) => value.id === item.folderColor);
  return color && folderPaletteStyle(color);
}
type LibraryClipboard = { mode: "copy" | "cut"; itemIds: string[] };
type LibrarySelectionGesture = {
  pointerId: number;
  startX: number;
  startY: number;
  base: Set<string>;
  pendingRowClick: boolean;
};
type LibrarySelectionRect = {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  selected: Set<string>;
};

function boxSelectionPoint(event: ReactPointerEvent<HTMLElement>) {
  const surface = event.currentTarget;
  const rect = surface.getBoundingClientRect();
  const left = rect.left + surface.clientLeft, top = rect.top + surface.clientTop;
  return {
    x: Math.min(left + surface.clientWidth, Math.max(left, event.clientX)),
    y: Math.min(top + surface.clientHeight, Math.max(top, event.clientY)),
  };
}
export type ResourceFolderTreeNode = {
  item: ResourceLibraryItem;
  children: ResourceFolderTreeNode[];
};
export type LibrarySortField = "name" | "type" | "path" | "modified" | "added";
export type LibrarySortDirection = "asc" | "desc";
export type LibrarySortMode =
  "manual" | `${LibrarySortField}-${LibrarySortDirection}`;
const RESOURCE_DRAG_TYPE = "application/x-moki-resource-library-item";
const LIBRARY_VIEW_KEY = "dsh.native.moki.library.view.v1";
const LIBRARY_SORT_KEY = "moki.library.sort.v1";
const LIBRARY_FOLDER_KEY = "moki.library.folder.v1";
const LIBRARY_TAG_HISTORY_KEY = "moki.library.tag-history.v1";
const LIBRARY_HIDDEN_TAG_HISTORY_KEY = "moki.library.hidden-tag-history.v1";
const LIBRARY_SORT_MODES: readonly LibrarySortMode[] = [
  "manual",
  "name-asc",
  "name-desc",
  "type-asc",
  "type-desc",
  "path-asc",
  "path-desc",
  "modified-asc",
  "modified-desc",
  "added-asc",
  "added-desc",
];

export function clipboardTextResources(
  text: string,
): DesktopClipboardResource[] {
  const resources: DesktopClipboardResource[] = [];
  const seen = new Set<string>();
  for (const rawLine of text.split(/\r?\n|\0/u)) {
    let target = rawLine
      .trim()
      .replace(/^(["'])(.*)\1$/u, "$2")
      .trim();
    if (!target || target.startsWith("#")) continue;
    let kind: DesktopClipboardResource["kind"] | undefined;
    if (/^https?:\/\//iu.test(target)) {
      kind = "url";
    } else if (/^file:\/\//iu.test(target)) {
      try {
        const url = new URL(target);
        target = decodeURIComponent(url.pathname)
          .replace(/^\/([A-Za-z]:)/u, "$1")
          .replaceAll("/", "\\");
        kind =
          /[\\/]$/u.test(target) || !/\.[^\\/.]+$/u.test(target)
            ? "local_folder"
            : "local_file";
      } catch {
        continue;
      }
    } else if (/^[A-Za-z]:[\\/]|^\\\\|^\//u.test(target)) {
      kind =
        /[\\/]$/u.test(target) || !/\.[^\\/.]+$/u.test(target)
          ? "local_folder"
          : "local_file";
    }
    if (!kind) continue;
    const key = `${kind}:${target.toLocaleLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    resources.push({
      kind,
      name: displayNameFromTarget(target, kind) || target,
      target,
    });
  }
  return resources;
}

export function normalizeResourceTags(
  values: Iterable<string>,
  limit = 20,
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    for (const part of value.split(/[,，\n]/u)) {
      const tag = part.trim();
      const key = tag.toLocaleLowerCase("zh-CN");
      if (!tag || seen.has(key)) continue;
      seen.add(key);
      result.push(tag);
      if (result.length >= limit) return result;
    }
  }
  return result;
}

function storedTagHistory(key = LIBRARY_TAG_HISTORY_KEY): string[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(
      window.localStorage.getItem(key) ?? "[]",
    );
    return Array.isArray(value)
      ? normalizeResourceTags(
          value.filter((tag): tag is string => typeof tag === "string"),
          key === LIBRARY_HIDDEN_TAG_HISTORY_KEY ? Number.MAX_SAFE_INTEGER : 60,
        )
      : [];
  } catch {
    return [];
  }
}

function navigateMenu(event: ReactKeyboardEvent<HTMLDivElement>) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled),button[role="menuitemradio"]:not(:disabled)'));
  if (!items.length) return;
  event.preventDefault();
  event.stopPropagation();
  const active = items.findIndex(item => item === document.activeElement);
  const index = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 :
    event.key === "ArrowDown" ? (active + 1) % items.length : (Math.max(active, 0) + items.length - 1) % items.length;
  items[index].focus();
}

function ResourceTagEditor({
  tags,
  draft,
  history,
  onTagsChange,
  onDraftChange,
  onDeleteHistory,
}: {
  tags: string[];
  draft: string;
  history: string[];
  onTagsChange: (tags: string[]) => void;
  onDraftChange: (draft: string) => void;
  onDeleteHistory: (tag: string) => void;
}) {
  const addTags = (values: Iterable<string>) => {
    onTagsChange(normalizeResourceTags([...tags, ...values]));
  };
  const commitDraft = () => {
    if (!draft.trim()) return;
    addTags([draft]);
    onDraftChange("");
  };
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter" || event.key === "," || event.key === "，") {
      event.preventDefault();
      commitDraft();
    } else if (event.key === "Backspace" && !draft && tags.length) {
      onTagsChange(tags.slice(0, -1));
    }
  };
  const selectedLabels = new Set(
    tags.map((tag) => resourceTagLabel(tag).toLocaleLowerCase("zh-CN")),
  );
  const suggestionLabels = new Set<string>();
  const suggestions = history.filter((tag) => {
    const label = resourceTagLabel(tag).toLocaleLowerCase("zh-CN");
    if (selectedLabels.has(label) || suggestionLabels.has(label)) return false;
    suggestionLabels.add(label);
    return true;
  });
  return (
    <div className="library-tag-editor">
      <label htmlFor="library-tag-input">{uiText("标签")}</label>
      <div className="library-tag-field" onClick={event => {
        if (event.target === event.currentTarget) event.currentTarget.querySelector("input")?.focus();
      }}>
        {tags.map((tag) => (
          <span
            key={tag}
            title={resourceTagLabel(tag) === tag ? tag : `${resourceTagLabel(tag)}（${tag}）`}
            className="library-tag-chip"
          >
            <span className="max-w-40 truncate">{resourceTagLabel(tag)}</span>
            <button
              type="button"
              aria-label={uiText`删除标签 ${tag}`}
              onClick={() =>
                onTagsChange(tags.filter((value) => value !== tag))
              }
              className="library-chip-remove"
            >
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          id="library-tag-input" aria-label={uiText("输入标签")} aria-describedby="library-tag-help"
          value={draft}
          disabled={tags.length >= 20}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={tags.length ? uiText("继续输入标签") : uiText("输入标签后按回车")}
          className="library-tag-input"
        />
      </div>
      <span id="library-tag-help" className="library-tag-help">{uiText("最多可添加 20 个标签。")}</span>
      {suggestions.length ? (
        <div
          aria-label={uiText("历史标签快捷选择")}
          className="library-tag-history"
        >
          <span>{uiText("历史标签")}</span>
          {suggestions.slice(0, 12).map((tag) => (
            <span
              key={tag}
              title={resourceTagLabel(tag) === tag ? tag : `${resourceTagLabel(tag)}（${tag}）`}
              className="library-tag-suggestion"
            >
            <button
              key={tag}
              type="button"
              aria-label={uiText`添加历史标签 ${tag}`}
              disabled={tags.length >= 20}
              onClick={() => addTags([tag])}
              className="library-history-tag-button"
            >
              + {resourceTagLabel(tag)}
            </button>
            <button type="button" aria-label={uiText`删除历史标签 ${tag}`} title={uiText("从历史标签中删除")} onClick={() => onDeleteHistory(tag)} className="library-chip-remove"><X size={11}/></button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export type ResourceFileCategory =
  | "folder"
  | "image"
  | "video"
  | "audio"
  | "document"
  | "spreadsheet"
  | "presentation"
  | "archive"
  | "code"
  | "link"
  | "file";
export type ResourcePreviewKind =
  "image" | "video" | "audio" | "embedded" | "unsupported";

export function resolveCardDropMode(input: {
  folderTarget: boolean;
  viewMode: LibraryViewMode;
  horizontalRatio: number;
  verticalRatio: number;
  sourceIndex: number;
  targetIndex: number;
}): CardDropMode {
  const { folderTarget, viewMode, horizontalRatio, verticalRatio } = input;
  const insideFolder =
    viewMode === "grid"
      ? horizontalRatio >= 0.3 &&
        horizontalRatio <= 0.7 &&
        verticalRatio >= 0.25 &&
        verticalRatio <= 0.75
      : verticalRatio >= 0.25 && verticalRatio <= 0.75;
  if (folderTarget && insideFolder) return "inside";
  return viewMode === "grid"
    ? horizontalRatio < 0.5
      ? "before"
      : "after"
    : verticalRatio < 0.5
      ? "before"
      : "after";
}

export function resolveManualDropBeforeId(
  cards: Array<{
    id: string;
    left: number;
    top: number;
    right: number;
    bottom: number;
  }>,
  clientX: number,
  clientY: number,
): string | null {
  if (!cards.length) return null;
  const rows: (typeof cards)[] = [];
  for (const card of cards) {
    const centerY = (card.top + card.bottom) / 2;
    const row = rows.find((candidate) => {
      const first = candidate[0];
      if (!first) return false;
      const rowCenterY = (first.top + first.bottom) / 2;
      return (
        Math.abs(rowCenterY - centerY) <=
        Math.max(8, (first.bottom - first.top) * 0.35)
      );
    });
    if (row) row.push(card);
    else rows.push([card]);
  }
  rows.sort((left, right) => (left[0]?.top ?? 0) - (right[0]?.top ?? 0));
  for (const row of rows) row.sort((left, right) => left.left - right.left);

  let rowIndex = rows.findIndex((row) => {
    const first = row[0];
    if (!first) return false;
    return clientY < (first.top + first.bottom) / 2;
  });
  if (rowIndex < 0) rowIndex = rows.length - 1;
  const row = rows[rowIndex] ?? [];
  const card = row.find(
    (candidate) => clientX < (candidate.left + candidate.right) / 2,
  );
  if (card) return card.id;
  return rows[rowIndex + 1]?.[0]?.id ?? null;
}

export function librarySelectionIntersects(
  selection: { left: number; top: number; right: number; bottom: number },
  item: { left: number; top: number; right: number; bottom: number },
): boolean {
  return (
    selection.left <= item.right &&
    selection.right >= item.left &&
    selection.top <= item.bottom &&
    selection.bottom >= item.top
  );
}

export function resourceFolderDescendantIds(
  items: ResourceLibraryItem[],
  folderId: string,
): Set<string> {
  const result = new Set<string>();
  const pending = [folderId];
  while (pending.length) {
    const parentId = pending.shift()!;
    for (const item of items) {
      if (item.parentId !== parentId || result.has(item.id)) continue;
      result.add(item.id);
      if (isFolder(item)) pending.push(item.id);
    }
  }
  return result;
}

export function resourceFolderPathLabel(
  item: ResourceLibraryItem,
  items: ResourceLibraryItem[],
): string {
  const names = [item.name];
  const seen = new Set([item.id]);
  let parentId = item.parentId;
  while (parentId) {
    const parent = items.find((candidate) => candidate.id === parentId);
    if (!parent || seen.has(parent.id)) break;
    names.unshift(parent.name);
    seen.add(parent.id);
    parentId = parent.parentId;
  }
  return uiText`资料库 / ${names.join(" / ")}`;
}

export function buildResourceFolderTree(
  items: ResourceLibraryItem[],
): ResourceFolderTreeNode[] {
  const folders = items.filter((item) => isFolder(item));
  const folderIds = new Set(folders.map((folder) => folder.id));
  const childrenByParent = new Map<string | null, ResourceLibraryItem[]>();
  for (const folder of folders) {
    const parentId =
      folder.parentId && folderIds.has(folder.parentId)
        ? folder.parentId
        : null;
    const siblings = childrenByParent.get(parentId) ?? [];
    siblings.push(folder);
    childrenByParent.set(parentId, siblings);
  }
  const sortFolders = (left: ResourceLibraryItem, right: ResourceLibraryItem) =>
    (left.sortOrder ?? 0) - (right.sortOrder ?? 0) ||
    left.name.localeCompare(right.name, "zh-CN", {
      numeric: true,
      sensitivity: "base",
    });
  for (const siblings of childrenByParent.values()) siblings.sort(sortFolders);

  const visited = new Set<string>();
  const toNode = (
    item: ResourceLibraryItem,
    ancestors: Set<string>,
  ): ResourceFolderTreeNode | undefined => {
    if (ancestors.has(item.id) || visited.has(item.id)) return undefined;
    visited.add(item.id);
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(item.id);
    return {
      item,
      children: (childrenByParent.get(item.id) ?? [])
        .map((child) => toNode(child, nextAncestors))
        .filter((child): child is ResourceFolderTreeNode => Boolean(child)),
    };
  };

  const roots = (childrenByParent.get(null) ?? [])
    .map((folder) => toNode(folder, new Set()))
    .filter((node): node is ResourceFolderTreeNode => Boolean(node));
  for (const folder of folders.sort(sortFolders)) {
    if (visited.has(folder.id)) continue;
    const orphan = toNode(folder, new Set());
    if (orphan) roots.push(orphan);
  }
  return roots;
}

export function topLevelResourceSelection(
  items: ResourceLibraryItem[],
  itemIds: Iterable<string>,
): ResourceLibraryItem[] {
  const selectedIds = new Set(itemIds);
  return items.filter((item) => {
    if (!selectedIds.has(item.id)) return false;
    const seen = new Set<string>();
    let parentId = item.parentId;
    while (parentId && !seen.has(parentId)) {
      if (selectedIds.has(parentId)) return false;
      seen.add(parentId);
      parentId =
        items.find((candidate) => candidate.id === parentId)?.parentId ?? null;
    }
    return true;
  });
}

export function resourceFileCategory(
  item: Pick<ResourceLibraryItem, "kind" | "name" | "target">,
): ResourceFileCategory {
  if (item.kind === "folder" || item.kind === "local_folder") return "folder";
  const source = (item.target ?? item.name).split(/[?#]/u)[0] ?? "";
  const extension = source.match(/\.([^.\\/]+)$/u)?.[1]?.toLowerCase() ?? "";
  if (
    [
      "png",
      "jpg",
      "jpeg",
      "gif",
      "webp",
      "svg",
      "bmp",
      "avif",
      "ico",
      "tif",
      "tiff",
      "heic",
    ].includes(extension)
  )
    return "image";
  if (
    ["mp4", "mov", "avi", "mkv", "webm", "m4v", "ogv", "flv"].includes(
      extension,
    )
  )
    return "video";
  if (["mp3", "wav", "flac", "aac", "m4a", "ogg", "wma"].includes(extension))
    return "audio";
  if (["xls", "xlsx", "csv", "ods"].includes(extension)) return "spreadsheet";
  if (["ppt", "pptx", "key", "odp"].includes(extension)) return "presentation";
  if (["zip", "rar", "7z", "tar", "gz", "bz2"].includes(extension))
    return "archive";
  if (
    [
      "js",
      "jsx",
      "ts",
      "tsx",
      "html",
      "css",
      "scss",
      "json",
      "xml",
      "yaml",
      "yml",
      "py",
      "java",
      "cpp",
      "c",
      "cs",
      "go",
      "rs",
      "sh",
      "ps1",
    ].includes(extension)
  )
    return "code";
  if (
    [
      "pdf",
      "doc",
      "docx",
      "txt",
      "md",
      "markdown",
      "rtf",
      "pages",
      "log",
    ].includes(extension)
  )
    return "document";
  return item.kind === "url" ? "link" : "file";
}

export function resourcePreviewKind(
  item: Pick<ResourceLibraryItem, "kind" | "name" | "target">,
): ResourcePreviewKind {
  if (item.kind === "folder" || item.kind === "local_folder")
    return "unsupported";
  const source = (item.target ?? item.name).split(/[?#]/u)[0] ?? "";
  const extension = source.match(/\.([^.\\/]+)$/u)?.[1]?.toLowerCase() ?? "";
  if (
    [
      "png",
      "jpg",
      "jpeg",
      "gif",
      "webp",
      "svg",
      "bmp",
      "avif",
      "ico",
      "tif",
      "tiff",
      "heic",
    ].includes(extension)
  )
    return "image";
  if (["mp4", "webm", "m4v", "mov", "ogv"].includes(extension)) return "video";
  if (["mp3", "wav", "flac", "aac", "m4a", "ogg", "oga"].includes(extension))
    return "audio";
  if (
    [
      "pdf",
      "txt",
      "md",
      "markdown",
      "json",
      "csv",
      "tsv",
      "html",
      "htm",
      "xml",
      "yaml",
      "yml",
      "log",
    ].includes(extension)
  )
    return "embedded";
  return "unsupported";
}

export function resourceTypeLabel(
  item: Pick<ResourceLibraryItem, "kind" | "name" | "target">,
): string {
  if (item.kind === "folder") return uiText("虚拟文件夹");
  if (item.kind === "local_folder") return uiText("本地文件夹");
  switch (resourceFileCategory(item)) {
    case "image":
      return uiText("图片");
    case "video":
      return uiText("视频");
    case "audio":
      return uiText("音频");
    case "document":
      return uiText("文档");
    case "spreadsheet":
      return uiText("表格");
    case "presentation":
      return uiText("演示文稿");
    case "archive":
      return uiText("压缩包");
    case "code":
      return uiText("代码");
    case "link":
      return uiText("在线文件");
    default:
      return uiText("文件");
  }
}

export function resourceTagLabel(tag: string): string {
  if (tag === ASSISTANT_TASK_DIRECTORY_TAG || tag === ASSISTANT_TASK_SPACE_TAG) return uiText("任务空间");
  if (tag === ASSISTANT_DOWNLOAD_DIRECTORY_TAG) return uiText("下载");
  if (tag === `${ASSISTANT_TASK_SPACE_SOURCE_TAG_PREFIX}created`) return uiText("新建");
  if (tag === `${ASSISTANT_TASK_SPACE_SOURCE_TAG_PREFIX}local`) return uiText("本地");
  if (tag === `${ASSISTANT_TASK_SPACE_SOURCE_TAG_PREFIX}library`) return uiText("资料库");
  return tag;
}

function resourceTagLabels(tags: readonly string[]): string[] {
  return [...new Set(tags.map(resourceTagLabel))];
}

function isFolder(item: ResourceLibraryItem) {
  return item.kind === "folder" || item.kind === "local_folder";
}

const timeFormatters = Object.fromEntries(["zh-CN", "en-US"].map(locale => [locale, new Intl.DateTimeFormat(locale, {
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
})]));
const textOrders = Object.fromEntries(["zh-CN", "en-US"].map(locale => [locale, new Intl.Collator(locale, { numeric: true, sensitivity: "base" })]));

export function formatResourceTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return timeFormatters[intlLocale()].format(date);
}

export function sortResourceLibraryItems(
  items: ResourceLibraryItem[],
  mode: LibrarySortMode,
): ResourceLibraryItem[] {
  if (mode === "manual") return [...items];
  const [field, direction] = mode.split("-") as [
    LibrarySortField,
    LibrarySortDirection,
  ];
  const order = direction === "desc" ? -1 : 1;
  const compareText = textOrders[intlLocale()].compare;
  const compareOptionalText = (
    left: string | null | undefined,
    right: string | null | undefined,
  ) => {
    if (!left && !right) return 0;
    if (!left) return 1;
    if (!right) return -1;
    return order * compareText(left, right);
  };
  const compareOptionalTime = (
    left: string | null | undefined,
    right: string | null | undefined,
  ) => {
    const leftTime = Date.parse(left ?? "");
    const rightTime = Date.parse(right ?? "");
    const leftValid = Number.isFinite(leftTime);
    const rightValid = Number.isFinite(rightTime);
    if (!leftValid && !rightValid) return 0;
    if (!leftValid) return 1;
    if (!rightValid) return -1;
    return order * (leftTime - rightTime);
  };
  return [...items].sort((left, right) => {
    const folderOrder = Number(isFolder(right)) - Number(isFolder(left));
    // Name and date sorts compare every entry on the chosen dimension.
    if ((field === "type" || field === "path") && folderOrder) return folderOrder;
    const result =
      field === "name"
        ? order * compareText(left.name, right.name)
        : field === "type"
          ? order *
            compareText(resourceFileCategory(left), resourceFileCategory(right))
          : field === "path"
            ? compareOptionalText(left.target, right.target)
            : field === "modified"
              ? compareOptionalTime(
                  left.fileModifiedAt ?? left.fileCreatedAt,
                  right.fileModifiedAt ?? right.fileCreatedAt,
                )
              : compareOptionalTime(left.createdAt, right.createdAt);
    return result || compareText(left.name, right.name);
  });
}

export function toggleLibrarySortMode(
  current: LibrarySortMode,
  field: LibrarySortField,
): LibrarySortMode {
  const ascending = `${field}-asc` as LibrarySortMode;
  return current === ascending
    ? (`${field}-desc` as LibrarySortMode)
    : ascending;
}

export function resourceItemTooltip(item: ResourceLibraryItem): string {
  const kindLabel =
    item.kind === "folder"
      ? uiText("虚拟文件夹")
      : item.kind === "local_folder"
        ? uiText("本地文件夹映射")
        : item.kind === "url"
          ? uiText("在线文件")
          : uiText("本地文件");
  return [
    item.name,
    uiText`类型：${kindLabel}`,
    item.target ? uiText`位置：${item.target}` : "",
    uiText`文件修改：${formatResourceTime(item.fileModifiedAt ?? item.fileCreatedAt)}`,
    uiText`添加到资料库：${formatResourceTime(item.createdAt)}`,
    item.tags.length ? uiText`标签：${resourceTagLabels(item.tags).join("、")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function drawThumbnailCanvas(
  media: HTMLImageElement | HTMLVideoElement,
): HTMLCanvasElement | undefined {
  const sourceWidth =
    media instanceof HTMLVideoElement ? media.videoWidth : media.naturalWidth;
  const sourceHeight =
    media instanceof HTMLVideoElement ? media.videoHeight : media.naturalHeight;
  if (!sourceWidth || !sourceHeight) return undefined;
  const size = 96;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return undefined;
  const scale = Math.max(size / sourceWidth, size / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  try {
    context.drawImage(
      media,
      (size - width) / 2,
      (size - height) / 2,
      width,
      height,
    );
    if (typeof context.getImageData === "function") {
      const pixels = context.getImageData(0, 0, size, size).data;
      if (!thumbnailPixelsHaveVisualContent(pixels)) return undefined;
    }
    return canvas;
  } catch {
    return undefined;
  }
}

export function createMediaThumbnailDataUrl(media: HTMLImageElement | HTMLVideoElement): string | undefined {
  const canvas = drawThumbnailCanvas(media);
  if (!canvas) return undefined;
  try {
    const result = canvas.toDataURL("image/webp", 0.78);
    return result.startsWith("data:image/") && result.length <= 262_144
      ? result
      : undefined;
  } catch {
    return undefined;
  }
}

export function thumbnailPixelsHaveVisualContent(
  pixels: Uint8ClampedArray,
): boolean {
  const pixelCount = Math.floor(pixels.length / 4);
  if (pixelCount === 0) return false;
  let visibleCount = 0;
  let minimumLuma = 255;
  let maximumLuma = 0;
  let lumaTotal = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3] ?? 0;
    if (alpha < 24) continue;
    const red = pixels[index] ?? 0;
    const green = pixels[index + 1] ?? 0;
    const blue = pixels[index + 2] ?? 0;
    const luma = (red * 3 + green * 6 + blue) / 10;
    visibleCount += 1;
    lumaTotal += luma;
    minimumLuma = Math.min(minimumLuma, luma);
    maximumLuma = Math.max(maximumLuma, luma);
  }
  if (visibleCount < Math.max(1, pixelCount * 0.08)) return false;
  const meanLuma = lumaTotal / visibleCount;
  return maximumLuma - minimumLuma >= 10 || (meanLuma > 8 && meanLuma < 247);
}

export function videoThumbnailSeekTimes(duration: number): number[] {
  if (!Number.isFinite(duration) || duration <= 0) return [0.001];
  const lastDecodableTime = Math.max(0.001, duration - 1 / 30);
  const candidates = [
    Math.min(2, Math.max(0.5, duration * 0.08)),
    duration * 0.25,
    duration * 0.5,
    duration * 0.75,
  ].map((value) => Math.min(lastDecodableTime, Math.max(0.001, value)));
  return candidates.filter(
    (value, index) =>
      candidates.findIndex(
        (candidate) => Math.abs(candidate - value) < 0.001,
      ) === index,
  );
}

function ResourceMediaThumbnailProbe({
  item,
  onReady,
  onError,
}: {
  item: ResourceLibraryItem;
  onReady: (
    media: HTMLImageElement | HTMLVideoElement,
  ) => boolean | Promise<boolean>;
  onError: () => void;
}) {
  const videoAttemptRef = useRef(0);
  const capturePendingRef = useRef(false);
  const previewUrl = resourceLibraryPreviewUrl(item);
  const category = resourceFileCategory(item);
  if (!previewUrl || item.kind !== "local_file") return null;
  const probeClassName =
    "pointer-events-none fixed -left-[9999px] top-0 size-px opacity-0";
  if (category === "image") {
    return (
      <img
        data-resource-thumbnail-probe={item.id}
        src={previewUrl}
        alt=""
        decoding="async"
        onLoad={(event) =>
          void Promise.resolve(onReady(event.currentTarget)).then(
            (accepted) => {
              if (!accepted) onError();
            },
          )
        }
        onError={onError}
        className={probeClassName}
      />
    );
  }
  if (category === "video") {
    const captureDecodedFrame = (video: HTMLVideoElement) => {
      if (video.seeking || capturePendingRef.current) return;
      capturePendingRef.current = true;
      const capture = () => {
        void Promise.resolve(onReady(video)).then((accepted) => {
          capturePendingRef.current = false;
          if (accepted) return;
          const times = videoThumbnailSeekTimes(video.duration);
          videoAttemptRef.current += 1;
          const nextTime = times[videoAttemptRef.current];
          if (nextTime === undefined) {
            onError();
            return;
          }
          video.currentTime = nextTime;
        });
      };
      // `seeked` already means the requested frame is decoded. Registering a
      // video-frame callback only after that event can wait forever on a
      // paused probe, so allow two paint turns before drawing the canvas.
      window.requestAnimationFrame(() => window.requestAnimationFrame(capture));
    };
    return (
      <video
        data-resource-thumbnail-probe={item.id}
        src={previewUrl}
        preload="metadata"
        muted
        playsInline
        onLoadedMetadata={(event) => {
          const video = event.currentTarget;
          videoAttemptRef.current = 0;
          video.currentTime =
            videoThumbnailSeekTimes(video.duration)[0] ?? 0.001;
        }}
        onLoadedData={(event) => captureDecodedFrame(event.currentTarget)}
        onSeeked={(event) => captureDecodedFrame(event.currentTarget)}
        onError={onError}
        className={probeClassName}
      />
    );
  }
  return null;
}

export function displayNameFromTarget(
  target: string,
  kind: "local_file" | "local_folder" | "url",
) {
  let value = target.trim();
  if (!value) return "";
  if (kind === "url") {
    try {
      const url = new URL(value);
      value = url.pathname.split("/").filter(Boolean).at(-1) ?? url.hostname;
      try {
        value = decodeURIComponent(value);
      } catch {
        /* keep the original URL segment */
      }
    } catch {
      value = value.split(/[/?#]/u).filter(Boolean).at(-1) ?? value;
    }
  } else {
    value =
      value
        .replace(/[\\/]+$/u, "")
        .split(/[\\/]/u)
        .at(-1) ?? value;
  }
  if (kind !== "local_folder") {
    const extensionIndex = value.lastIndexOf(".");
    if (extensionIndex > 0) value = value.slice(0, extensionIndex);
  }
  return value.trim();
}

export function LibraryPage() {
  const locale = useSyncExternalStore(subscribeLocale, getLocale, getLocale);
  const [items, setItems] = useState<ResourceLibraryItem[]>([]);
  const [indexStatuses, setIndexStatuses] = useState<
    Record<
      string,
      import("../lib/resource-library-api.js").ResourceLibraryIndexStatus
    >
  >({});
  const [folderId, setFolderId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(LIBRARY_FOLDER_KEY) || null;
  });
  const [createMode, setCreateMode] = useState<CreateMode>();
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [previewItem, setPreviewItem] = useState<ResourceLibraryItem>();
  const [assistantPermission, setAssistantPermission] = useState<"read_only" | "write" | null>(null);
  const [editingItem, setEditingItem] = useState<ResourceLibraryItem>();
  const [busy, setBusy] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  useEffect(() => {
    if (!initialLoading) window.dispatchEvent(new CustomEvent("moki:library-location", {detail: {itemId:previewItem?.id ?? folderId, previewing:Boolean(previewItem)}}));
  }, [initialLoading, folderId, previewItem?.id]);
  const [viewMode, setViewMode] = useState<LibraryViewMode>(() => {
    if (typeof window === "undefined") return "list";
    return window.localStorage.getItem(LIBRARY_VIEW_KEY) === "grid" ? "grid" : "list";
  });
  const columnWidths = useLibraryColumnWidths();
  const [sortMode, setSortMode] = useState<LibrarySortMode>(() => {
    if (typeof window === "undefined") return "manual";
    const stored = window.localStorage.getItem(LIBRARY_SORT_KEY);
    const normalized =
      stored === "type"
        ? "type-asc"
        : stored === "created-asc"
          ? "modified-asc"
          : stored === "created-desc"
            ? "modified-desc"
            : stored;
    return normalized &&
      LIBRARY_SORT_MODES.includes(normalized as LibrarySortMode)
      ? (normalized as LibrarySortMode)
      : "manual";
  });
  const [message, setMessage] = useState("");
  const [name, setName] = useState("");
  const [newFolderColor, setNewFolderColor] = useState<FolderColor>("violet");
  const [kind, setKind] = useState<"local_file" | "local_folder" | "url">(
    "local_file",
  );
  const [target, setTarget] = useState("");
  const [fileFormat, setFileFormat] = useState<
    "markdown" | "csv" | "docx" | "xlsx" | "pptx" | "univer"
  >("markdown");
  const [univerUnitKind, setUniverUnitKind] = useState<
    "sheet" | "doc" | "slide" | "base" | "board"
  >("sheet");
  const [fileContent, setFileContent] = useState("");
  const [query, setQuery] = usePageState('library.query', "");
  const searchInputRef = useRef<HTMLInputElement>(null);
  function clearSearch() {
    setQuery("");
    searchInputRef.current?.focus();
  }
  const deferredQuery = useDeferredValue(query);
  const [tagFilter, setTagFilter] = usePageState('library.tagFilter', "");
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [tagHistory, setTagHistory] = useState<string[]>(storedTagHistory);
  const [hiddenTagHistory, setHiddenTagHistory] = useState<string[]>(() => storedTagHistory(LIBRARY_HIDDEN_TAG_HISTORY_KEY));
  const [parentIdDraft, setParentIdDraft] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const dropPending = useRef(false);
  const [draggedItemId, setDraggedItemId] = useState("");
  const nativeDragSource = useRef("");
  const suppressClickAfterFileDrag = useRef(false);
  const [cardDropTarget, setCardDropTarget] = useState<{
    id: string;
    mode: CardDropMode;
  }>();
  const [breadcrumbDropId, setBreadcrumbDropId] = useState<string>();
  const [cardMenuId, setCardMenuId] = useState("");
  const [contextMenu, setContextMenu] = useState<LibraryContextMenu>();
  const [folderColorMenu, setFolderColorMenu] = useState<{
    itemId: string;
    left: number;
    right: number;
    top: number;
  }>();
  const [moveDialogItems, setMoveDialogItems] = useState<ResourceLibraryItem[]>(
    [],
  );
  const [moveTargetId, setMoveTargetId] = useState("");
  const [expandedMoveFolderIds, setExpandedMoveFolderIds] = useState<
    Set<string>
  >(new Set());
  const [selectedItemIds, setSelectedItemIds] = usePageState<Set<string>>('library.selectedItemIds',
    () => new Set(),
  );
  const [selectionRect, setSelectionRect] = useState<LibrarySelectionRect>();
  const selectionGesture = useRef<LibrarySelectionGesture | null>(null);
  const highlightedItemIds = selectionRect?.selected ?? selectedItemIds;
  const [libraryClipboard, setLibraryClipboard] = usePageState<LibraryClipboard>('library.libraryClipboard');
  const [renamingItemId, setRenamingItemId] = useState("");
  const [renameDraft, setRenameDraft] = useState("");
  const [thumbnailFailures, setThumbnailFailures] = useState<Set<string>>(
    () => new Set(),
  );
  const autoNameRef = useRef("");
  const filePickerRef = useRef<HTMLInputElement | null>(null);
  const copiedItemRef = useRef<ResourceLibraryItem | undefined>(undefined);
  const capturedThumbnailRef = useRef(new Set<string>());
  const validatedThumbnailRef = useRef(new Map<string, string>());
  const renameElementRef = useRef<HTMLInputElement | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const createMenuRef = useRef<HTMLDivElement | null>(null);
  const createMenuSurfaceRef = useRef<HTMLDivElement | null>(null);
  const [createMenuAnchor, setCreateMenuAnchor] = useState<{ x: number; y: number }>();
  useLayoutEffect(() => {
    if (!createMenuOpen) { setCreateMenuAnchor(undefined); return; }
    const place = () => {
      const rect = createMenuRef.current?.getBoundingClientRect();
      if (rect) setCreateMenuAnchor({ x: rect.left, y: rect.bottom + 8 });
    };
    place();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(place);
    if (createMenuRef.current) observer?.observe(createMenuRef.current);
    window.addEventListener('resize', place);
    return () => { observer?.disconnect(); window.removeEventListener('resize', place); };
  }, [createMenuOpen]);
  useContextMenuPosition(createMenuSurfaceRef, createMenuAnchor);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const folderColorMenuRef = useRef<HTMLDivElement | null>(null);
  const folderColorTriggerRef = useRef<HTMLButtonElement | null>(null);
  const selectionSurfaceRef = useRef<HTMLDivElement | null>(null);
  const selectedItemIdsRef = useRef<Set<string>>(new Set());
  const catalogLoad = useRef<{ pending?: Promise<void>; dirty: boolean }>({ dirty: false });
  const quickEntryItemIdRef = useRef(
    typeof window === "undefined"
      ? ""
      : (new URLSearchParams(window.location.search).get("itemId") ?? ""),
  );

  useEffect(() => {
    if (createMode !== "mapping" || editingItem) {
      autoNameRef.current = "";
      return;
    }
    const suggestedName = displayNameFromTarget(target, kind);
    if (!suggestedName) return;
    if (!name.trim() || name === autoNameRef.current) {
      autoNameRef.current = suggestedName;
      if (name !== suggestedName) setName(suggestedName);
    }
  }, [createMode, editingItem, kind, name, target]);

  const refresh = useCallback(() => {
    const load = catalogLoad.current;
    load.dirty = true;
    if (!load.pending) {
      load.pending = (async () => {
        try {
          while (load.dirty) {
            load.dirty = false;
            try {
              setItems(await getResourceLibraryItems("deferred"));
            } catch (error) {
              if (!load.dirty) throw error;
            }
          }
        } finally {
          load.pending = undefined;
        }
      })();
    }
    return load.pending;
  }, []);
  useEffect(() => {
    const onChange = () => { void refresh().catch(error => setMessage(error.message)); };
    window.addEventListener("moki:catalog-updated", onChange);
    return () => window.removeEventListener("moki:catalog-updated", onChange);
  }, [refresh]);
  useEffect(() => {
    void refresh()
      .catch((error) =>
        setMessage(error instanceof Error ? error.message : uiText("资料库加载失败")),
      )
      .finally(() => setInitialLoading(false));
  }, [refresh]);
  useEffect(() => {
    if (initialLoading || !quickEntryItemIdRef.current) return;
    const item = items.find(
      (value) => value.id === quickEntryItemIdRef.current,
    );
    quickEntryItemIdRef.current = "";
    if (!item) {
      setMessage(uiText("快速入口对应的资料库内容已不存在"));
      return;
    }
    if (isFolder(item)) setFolderId(item.id);
    else {
      setFolderId(item.parentId ?? null);
      void showPreview(item);
    }
    const url = new URL(window.location.href);
    url.searchParams.delete("itemId");
    window.history.replaceState(
      {},
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }, [initialLoading, items]);
  useEffect(() => {
    window.localStorage.setItem(LIBRARY_VIEW_KEY, viewMode);
  }, [viewMode]);
  useEffect(() => {
    window.localStorage.setItem(LIBRARY_SORT_KEY, sortMode);
  }, [sortMode]);
  useEffect(() => {
    if (folderId) window.localStorage.setItem(LIBRARY_FOLDER_KEY, folderId);
    else window.localStorage.removeItem(LIBRARY_FOLDER_KEY);
  }, [folderId]);
  useEffect(() => {
    if (
      !initialLoading &&
      folderId &&
      !items.some((item) => item.id === folderId && isFolder(item))
    ) {
      setFolderId(null);
    }
  }, [folderId, initialLoading, items]);
  const current = useMemo(() => folderId ? items.find(item => item.id === folderId) : undefined, [folderId, items]);
  const currentPath = useMemo(() => resourceLibraryPath(current, items), [current, items, locale]);
  const localFolderId = current?.kind === "local_folder" ? current.id : undefined;
  useEffect(() => {
    if (!localFolderId) return;
    let disposed = false;
    let timer: number | undefined;
    const poll = async () => {
      let status:
        | import("../lib/resource-library-api.js").ResourceLibraryIndexStatus
        | undefined;
      try {
        status = await getResourceLibraryIndexStatus(localFolderId);
      } catch {
        return;
      }
      if (disposed) return;
      setIndexStatuses((current) => ({
        ...current,
        [status!.itemId]: status!,
      }));
      if (status.status === "completed" || status.status === "error") {
        if (status.added || status.updated || status.removed) window.dispatchEvent(new Event("moki:check-catalog"));
        return;
      }
      timer = window.setTimeout(() => void poll(), 1200);
    };
    void poll();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [localFolderId]);
  useEffect(() => {
    if (!cardMenuId) return;
    const closeMenu = () => setCardMenuId("");
    window.addEventListener("pointerdown", closeMenu);
    return () => window.removeEventListener("pointerdown", closeMenu);
  }, [cardMenuId]);
  useEffect(() => {
    if (!contextMenu) return;
    const closeMenu = () => {
      setContextMenu(undefined);
      setFolderColorMenu(undefined);
      setCardMenuId("");
    };
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && (
        contextMenuRef.current?.contains(target) || folderColorMenuRef.current?.contains(target)
      )) return;
      if (cardMenuId && target instanceof Element) {
        const trigger = target.closest<HTMLButtonElement>('button[aria-haspopup="menu"]');
        if (trigger?.closest<HTMLElement>('[data-resource-id]')?.dataset.resourceId === cardMenuId) return;
      }
      closeMenu();
    };
    const closeOnKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (folderColorMenuRef.current) setFolderColorMenu(undefined);
        else {
          if (cardMenuId && contextMenuRef.current?.contains(document.activeElement)) {
            pageRef.current?.querySelector<HTMLButtonElement>(`[data-resource-id="${CSS.escape(cardMenuId)}"] button[aria-haspopup="menu"]`)?.focus();
          }
          closeMenu();
        }
      }
    };
    const closeOnScroll = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && (
        contextMenuRef.current?.contains(target) || folderColorMenuRef.current?.contains(target)
      )) return;
      closeMenu();
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeOnScroll, true);
    window.addEventListener("keydown", closeOnKey);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeOnScroll, true);
      window.removeEventListener("keydown", closeOnKey);
    };
  }, [contextMenu, cardMenuId]);
  useLayoutEffect(() => {
    if (!contextMenu || !contextMenuRef.current) return;
    const menu = contextMenuRef.current;
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    menu.style.left = `${Math.max(8, Math.min(contextMenu.x, window.innerWidth - width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(contextMenu.y, window.innerHeight - height - 8))}px`;
    menu.style.visibility = "visible";
  }, [contextMenu]);
  useLayoutEffect(() => {
    if (!folderColorMenu || !folderColorMenuRef.current) return;
    const menu = folderColorMenuRef.current;
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    const opensLeft = folderColorMenu.right + 4 + width > window.innerWidth - 8;
    const x = opensLeft ? folderColorMenu.left - width - 4 : folderColorMenu.right + 4;
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(folderColorMenu.top, window.innerHeight - height - 8))}px`;
    menu.style.visibility = "visible";
  }, [folderColorMenu]);
  useEffect(() => {
    if (!createMenuOpen) return;
    const closeOnPointer = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        createMenuRef.current?.contains(target)
      )
        return;
      setCreateMenuOpen(false);
    };
    const closeOnKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCreateMenuOpen(false);
        createMenuRef.current?.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOnPointer);
    document.addEventListener("keydown", closeOnKey);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointer);
      document.removeEventListener("keydown", closeOnKey);
    };
  }, [createMenuOpen]);
  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const active = document.activeElement;
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLSelectElement ||
        (active instanceof HTMLElement && active.isContentEditable)
      )
        return;
      event.preventDefault();
      if (libraryClipboard?.itemIds.length) {
        void pasteIntoFolder(folderId);
        return;
      }
      const data = event.clipboardData;
      if (data?.files.length) {
        void importTransfer(data, folderId);
        return;
      }
      const resources = clipboardTextResources(
        data?.getData("text/uri-list") || data?.getData("text/plain") || "",
      );
      if (resources.length) {
        void addPastedResources(resources, folderId);
        return;
      }
      void pasteExternalClipboard(folderId);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      const active = document.activeElement;
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLSelectElement ||
        (active instanceof HTMLElement && active.isContentEditable)
      )
        return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        setSelectedItemIds(
          new Set(
            items
              .filter((item) => item.parentId === folderId)
              .map((item) => item.id),
          ),
        );
      } else if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "c" &&
        selectedItemIds.size
      ) {
        event.preventDefault();
        copyOrCutItems(undefined, "copy");
      } else if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "x" &&
        selectedItemIds.size
      ) {
        event.preventDefault();
        copyOrCutItems(undefined, "cut");
      } else if (
        (event.key === "Delete" || event.key === "Backspace") &&
        selectedItemIds.size
      ) {
        event.preventDefault();
        void removeOperationItems();
      }
    };
    window.addEventListener("paste", handlePaste);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("paste", handlePaste);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [folderId, items, libraryClipboard, selectedItemIds]);
  useLayoutEffect(() => {
    if (!renamingItemId) return;
    const input = renameElementRef.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    input.select();
  }, [renamingItemId]);
  useEffect(() => {
    if (!renamingItemId) return;
    const commitOnOutsidePointer = (event: PointerEvent) => {
      const input = renameElementRef.current;
      const target = event.target;
      if (!input || !(target instanceof Node) || input.contains(target)) return;
      // Some Electron/Chromium surfaces do not naturally move focus when the
      // user clicks a non-focusable blank area. Explicitly blurring here keeps
      // the existing onBlur save path reliable across the whole app window.
      input.blur();
    };
    document.addEventListener("pointerdown", commitOnOutsidePointer, true);
    return () =>
      document.removeEventListener("pointerdown", commitOnOutsidePointer, true);
  }, [renamingItemId]);
  const currentFolderSearchEntries = useMemo(
    () =>
      sortResourceLibraryItems(items.filter(item => item.parentId === folderId), sortMode).map(item => {
        const labels = resourceTagLabels(item.tags);
        const corpus = [item.name, item.target ?? "", item.kind, item.tags.join(" "), labels.join(" ")]
          .join("\n").toLocaleLowerCase("zh-CN");
        return { item, labels, corpus };
      }),
    [folderId, items, sortMode, locale],
  );
  const availableTags = useMemo(
    () =>
      [
        ...new Set(currentFolderSearchEntries.flatMap(({ labels }) => labels)),
      ].sort((left, right) => left.localeCompare(right, "zh-CN")),
    [currentFolderSearchEntries],
  );
  const historicalTags = useMemo(
    () =>
      normalizeResourceTags(
        [...tagHistory, ...items.flatMap((item) => item.tags)].filter(tag => !hiddenTagHistory.some(hidden => hidden.toLocaleLowerCase("zh-CN") === tag.toLocaleLowerCase("zh-CN"))),
        60,
      ),
    [hiddenTagHistory, items, tagHistory],
  );
  const folderOptions = useMemo(
    () => items.filter((item) => isFolder(item)),
    [items],
  );
  const moveFolderOptions = useMemo(() => {
    if (!moveDialogItems.length) return [];
    const excluded = new Set<string>();
    for (const item of moveDialogItems) {
      excluded.add(item.id);
      if (isFolder(item)) {
        for (const descendantId of resourceFolderDescendantIds(items, item.id))
          excluded.add(descendantId);
      }
    }
    return folderOptions
      .filter((folder) => !excluded.has(folder.id))
      .sort((left, right) =>
        resourceFolderPathLabel(left, items).localeCompare(
          resourceFolderPathLabel(right, items),
          "zh-CN",
        ),
      );
  }, [folderOptions, items, moveDialogItems, locale]);
  const moveFolderTree = useMemo(
    () => buildResourceFolderTree(moveFolderOptions),
    [moveFolderOptions],
  );
  useEffect(() => {
    if (!moveDialogItems.length) return;
    setExpandedMoveFolderIds(new Set());
  }, [moveDialogItems]);
  const visible = useMemo(() => {
    const normalized = deferredQuery
      .trim()
      .toLocaleLowerCase("zh-CN")
      .replace(/^#/u, "");
    return currentFolderSearchEntries
      .filter(({ labels, corpus }) => {
        if (tagFilter && !labels.includes(tagFilter)) return false;
        return !normalized || corpus.includes(normalized);
      })
      .map(({ item }) => item);
  }, [currentFolderSearchEntries, deferredQuery, tagFilter]);
  useLayoutEffect(() => {
    if (selectionSurfaceRef.current) selectionSurfaceRef.current.scrollTop = 0;
  }, [folderId, deferredQuery, tagFilter, sortMode, viewMode]);

  function renderThumbnailProbe(nearby: ResourceLibraryItem[]) {
    if (previewItem) return null;
    const candidate = nearby.find(item => item.kind === "local_file" && !item.hasThumbnail &&
      !item.thumbnailDataUrl && !thumbnailFailures.has(item.id) && ["image", "video"].includes(resourceFileCategory(item)));
    return candidate ? <ResourceMediaThumbnailProbe key={candidate.id} item={candidate}
      onReady={media => persistThumbnail(candidate, media)} onError={() => markThumbnailFailure(candidate.id)} /> : null;
  }
  const breadcrumbs = useMemo(() => {
    const result: ResourceLibraryItem[] = [];
    let cursor = current;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      result.unshift(cursor);
      cursor = cursor.parentId
        ? items.find((item) => item.id === cursor!.parentId)
        : undefined;
    }
    return result;
  }, [current, items]);

  useEffect(() => {
    selectedItemIdsRef.current = selectedItemIds;
  }, [selectedItemIds]);

  useEffect(() => {
    if (previewItem) return;
    const selectedItems = items.filter((item) => selectedItemIds.has(item.id));
    if (selectedItems.length === 0) {
      clearWorkbenchSelectionContext("library");
      return;
    }
    publishWorkbenchSelectionContext({
      source: "library",
      label: uiText`资料库已选 ${selectedItems.length} 项`,
      itemCount: selectedItems.length,
      content: JSON.stringify(
        {
          totalSelected: selectedItems.length,
          selectedIds: selectedItems.map(item => item.id),
          selectedItems: selectedItems.slice(0, 100).map((item) => ({
            id: item.id,
            parentId: item.parentId,
            kind: item.kind,
            name: item.name,
            target: item.target,
            tags: item.tags,
          })),
        },
        null,
        2,
      ),
    });
  }, [items, selectedItemIds, previewItem]);
  useEffect(() => () => {
    // Navigation to the assistant preserves the exact selection for the first
    // message; other destinations should not inherit a stale library target.
    if (window.location.pathname !== "/assistant") clearWorkbenchSelectionContext("library");
  }, []);
  useEffect(() => {
    if (initialLoading) return;
    setSelectedItemIds((selected) => {
      const existing = new Set(items.map((item) => item.id));
      const next = new Set([...selected].filter((id) => existing.has(id)));
      return next.size === selected.size ? selected : next;
    });
  }, [items, initialLoading]);

  function resetDialog() {
    setCreateMode(undefined);
    setEditingItem(undefined);
    setAssistantPermission(null);
    setName("");
    setNewFolderColor("violet");
    setTarget("");
    setKind("local_file");
    setFileFormat("markdown");
    setUniverUnitKind("sheet");
    setFileContent("");
    setTags([]);
    setTagDraft("");
    setParentIdDraft("");
    setMessage("");
  }
  function startCreate(mode: CreateMode, format: typeof fileFormat = "markdown") {
    setCreateMenuOpen(false);
    setContextMenu(undefined);
    resetDialog();
    setParentIdDraft(folderId ?? "");
    setCreateMode(mode);
    setFileFormat(format);
  }
  function createMenuItems() {
    return <>
      <button type="button" role="menuitem" className="library-menu-item" onClick={() => startCreate("folder")}>
        <FolderPlus size={16} aria-hidden="true" />{uiText("新建文件夹")}</button>
      <div role="separator" className="moki-menu-divider" />
      {LIBRARY_FILE_TYPES.map(({ format, label, icon: Icon }) => (
        <button key={format} type="button" role="menuitem" className="library-menu-item" onClick={() => startCreate("file", format)}>
          <Icon size={16} aria-hidden="true" />{label}
        </button>
      ))}
    </>;
  }
  function beginEdit(item: ResourceLibraryItem) {
    setCardMenuId("");
    setContextMenu(undefined);
    setEditingItem(item);
    setAssistantPermission(item.assistantPermission ?? null);
    if (item.kind !== "folder") setKind(item.kind);
    setName(item.name);
    setTarget(item.target ?? "");
    setTags(item.tags);
    setTagDraft("");
    setParentIdDraft(item.parentId ?? "");
    setMessage("");
  }

  function operationItems(item?: ResourceLibraryItem): ResourceLibraryItem[] {
    if (!item) return topLevelResourceSelection(items, selectedItemIds);
    if (selectedItemIds.has(item.id))
      return topLevelResourceSelection(items, selectedItemIds);
    return [item];
  }

  function operationItemIds(item?: ResourceLibraryItem): string[] {
    return operationItems(item).map((candidate) => candidate.id);
  }

  function beginMove(item?: ResourceLibraryItem) {
    const targets = operationItems(item);
    if (!targets.length) return;
    setCardMenuId("");
    setContextMenu(undefined);
    setMoveDialogItems(targets);
    setMoveTargetId(
      targets.every((target) => target.parentId === targets[0]?.parentId)
        ? (targets[0]?.parentId ?? "")
        : "",
    );
    setMessage("");
  }

  function toggleMoveFolder(folderId: string) {
    setExpandedMoveFolderIds((expanded) => {
      const next = new Set(expanded);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }

  function renderMoveFolderNodes(nodes: ResourceFolderTreeNode[], depth = 1) {
    return nodes.map((node) => {
      const expanded = expandedMoveFolderIds.has(node.item.id);
      const hasChildren = node.children.length > 0;
      const selected = moveTargetId === node.item.id;
      const iconStyle = folderColorStyle(node.item);
      return (
        <div key={node.item.id}>
          <div
            role="treeitem"
            aria-level={depth + 1}
            aria-selected={selected}
            aria-expanded={hasChildren ? expanded : undefined}
            className={`flex h-9 min-w-0 items-center rounded-xl pr-2 transition ${selected ? "bg-[#292f47] text-white" : "text-[#565c72] hover:bg-[#f4f5f8]"}`}
            style={{ paddingLeft: `${Math.min(depth, 8) * 18 + 6}px` }}
          >
            {hasChildren ? (
              <button
                type="button"
                aria-label={`${expanded ? uiText("收起") : uiText("展开")}${node.item.name}`}
                onClick={() => toggleMoveFolder(node.item.id)}
                className={`grid size-7 shrink-0 place-items-center rounded-lg ${selected ? "hover:bg-white/15" : "hover:bg-[#e9e8f8]"}`}
              >
                {expanded ? (
                  <ChevronDown size={13} />
                ) : (
                  <ChevronRight size={13} />
                )}
              </button>
            ) : (
              <span className="block size-7 shrink-0" />
            )}
            <button
              type="button"
              onClick={() => setMoveTargetId(node.item.id)}
              className="flex h-full min-w-0 flex-1 items-center gap-2 text-left text-[0.6875rem] font-bold"
            >
              <Folder size={14} className={`shrink-0 ${iconStyle ? "library-folder-icon-ink" : ""}`} style={iconStyle} />
              <span className="truncate">{node.item.name}</span>
            </button>
          </div>
          {hasChildren && expanded ? (
            <div role="group">
              {renderMoveFolderNodes(node.children, depth + 1)}
            </div>
          ) : null}
        </div>
      );
    });
  }

  function toggleSelection(itemId: string, force?: boolean) {
    setSelectedItemIds((selected) => {
      const next = new Set(selected);
      const shouldSelect = force ?? !next.has(itemId);
      if (shouldSelect) next.add(itemId);
      else next.delete(itemId);
      selectedItemIdsRef.current = next;
      return next;
    });
  }

  function beginBoxSelection(event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0 || !event.isPrimary || busy || previewItem) return;
    if (selectionGesture.current && selectionGesture.current.pointerId !== event.pointerId) return;
    const target = event.target;
    if (!(target instanceof Element) || target.closest("button,label,input,select,textarea,a,[contenteditable='true'],[role='separator'],[role='dialog'],.library-list-header,.dsh-library-commandbar,.dsh-library-tags,.dsh-selection-toolbar")) return;
    const row = target.closest("article[data-resource-id]");
    if (row && (viewMode !== "list" || event.pointerType !== "mouse" || event.altKey || target.closest(".library-list-icon,[data-resource-name]"))) return;
    const surface = event.currentTarget;
    const scroll = selectionSurfaceRef.current;
    if (!scroll) return;
    const scrollBounds = scroll.getBoundingClientRect();
    if (target === scroll && (event.clientX >= scrollBounds.left + scroll.clientLeft + scroll.clientWidth || event.clientY >= scrollBounds.top + scroll.clientTop + scroll.clientHeight)) return;
    if (target === surface) {
      const bounds = surface.getBoundingClientRect();
      if (event.clientX >= bounds.left + surface.clientLeft + surface.clientWidth ||
          event.clientY >= bounds.top + surface.clientTop + surface.clientHeight) return;
    }
    event.preventDefault();
    // Keep a stationary press on its row so the usual click or modifier-click still runs.
    target.closest<HTMLElement>(".library-list-row-content[role='button']")?.focus({preventScroll:true});
    (row ? target : surface).setPointerCapture(event.pointerId);
    const { x, y } = boxSelectionPoint(event);
    selectionGesture.current = {
      pointerId: event.pointerId, startX: x, startY: y, pendingRowClick: !!row,
      base: event.ctrlKey || event.metaKey ? selectedItemIdsRef.current : new Set<string>(),
    };
  }

  function updateBoxSelection(event: ReactPointerEvent<HTMLElement>, commit = false) {
    const gesture = selectionGesture.current;
    if (gesture?.pointerId !== event.pointerId) return;
    const { x, y } = boxSelectionPoint(event);
    const { startX, startY } = gesture;
    if (gesture.pendingRowClick) {
      if (commit) {
        selectionGesture.current = null;
        return;
      }
      if (Math.max(Math.abs(x - startX), Math.abs(y - startY)) < 4) return;
      // The surface now owns pointerup and click, so finishing the box cannot open the file.
      event.currentTarget.setPointerCapture(event.pointerId);
      gesture.pendingRowClick = false;
    }
    const scroll = selectionSurfaceRef.current;
    if (!scroll) return;
    const viewport = scroll.getBoundingClientRect();
    const contentTop = Math.max(viewport.top, scroll.querySelector('.library-list-header')?.getBoundingClientRect().bottom ?? viewport.top);
    const bounds = {
      left: Math.max(Math.min(startX, x), viewport.left),
      top: Math.max(Math.min(startY, y), contentTop),
      right: Math.min(Math.max(startX, x), viewport.left + scroll.clientWidth),
      bottom: Math.min(Math.max(startY, y), viewport.top + scroll.clientHeight),
    };
    const selected = new Set(gesture.base);
    for (const element of event.currentTarget.querySelectorAll<HTMLElement>(
      "[data-resource-id]",
    )) {
      if (bounds.right > bounds.left && bounds.bottom > bounds.top && librarySelectionIntersects(bounds, element.getBoundingClientRect()))
        selected.add(element.dataset.resourceId!);
    }
    // Keep the bulk toolbar and the item positions stable until the gesture commits.
    if (commit) {
      selectionGesture.current = null;
      setSelectedItemIds(selected);
      setSelectionRect(undefined);
    } else {
      setSelectionRect({ startX, startY, currentX: x, currentY: y, selected });
    }
  }

  function cancelBoxSelection(event: ReactPointerEvent<HTMLElement>) {
    if (selectionGesture.current?.pointerId !== event.pointerId) return;
    if (event.type === "lostpointercapture" && event.currentTarget.hasPointerCapture(event.pointerId)) return;
    selectionGesture.current = null;
    setSelectionRect(undefined);
  }

  function showContextMenu(
    event: ReactMouseEvent<HTMLElement>,
    item?: ResourceLibraryItem,
  ) {
    event.preventDefault();
    event.stopPropagation();
    setCardMenuId("");
    setFolderColorMenu(undefined);
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      ...(item ? { item } : {}),
    });
  }

  function showItemMenuAtAnchor(
    event: ReactMouseEvent<HTMLButtonElement>,
    item: ResourceLibraryItem,
  ) {
    event.stopPropagation();
    if (cardMenuId === item.id && contextMenu?.item?.id === item.id) {
      setCardMenuId("");
      setContextMenu(undefined);
      setFolderColorMenu(undefined);
      return;
    }
    const anchor = event.currentTarget.getBoundingClientRect();
    if (event.detail === 0) requestAnimationFrame(() => contextMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus());
    setCardMenuId(item.id);
    setFolderColorMenu(undefined);
    setContextMenu({
      x: anchor.right - 160,
      y: anchor.bottom + 4,
      item,
    });
  }

  async function copyItemPath(item: ResourceLibraryItem) {
    try {
      await navigator.clipboard.writeText(resourceLibraryPath(item, items));
      copiedItemRef.current = item;
      setLibraryClipboard(undefined);
      setMessage(uiText`已复制“${item.name}”的路径`);
    } catch {
      setMessage(uiText("无法写入系统剪贴板，请检查客户端剪贴板权限"));
    }
    setCardMenuId("");
    setContextMenu(undefined);
  }

  async function copyActualFile(item: ResourceLibraryItem) {
    setContextMenu(undefined);
    setCardMenuId("");
    const targets = operationItems(item);
    if (targets.some(target => target.kind !== "local_file" || !target.target)) {
      setMessage(uiText("请选择本地文件"));
      return;
    }
    try {
      await copyLibraryFile(targets.map(target => target.id));
      setLibraryClipboard(undefined);
      setMessage(targets.length === 1 ? uiText`已复制文件“${item.name}”` : uiText`已复制 ${targets.length} 个文件，可在资源管理器中粘贴`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : uiText("复制文件失败"));
    }
  }

  function resetDrop() {
    setDragActive(false);
    setCardDropTarget(undefined);
    setBreadcrumbDropId(undefined);
  }

  function startFileDrag(event: DragEvent<HTMLElement>, item: ResourceLibraryItem) {
    event.preventDefault();
    event.stopPropagation();
    resetDrop();
    if (busy || renamingItemId === item.id) return;
    suppressClickAfterFileDrag.current = true;
    if (nativeFileDrag) { nativeDragSource.current=item.id; setDraggedItemId(item.id); }
    void exportDraggedFiles(operationItems(item)).catch(error => setMessage(error.message)).finally(()=>{
      if (nativeDragSource.current === item.id) { nativeDragSource.current=""; setDraggedItemId(""); resetDrop(); }
    });
  }

  async function setFolderColor(item: ResourceLibraryItem, color: FolderColor) {
    try {
      await updateResourceLibraryItem(item.id, { folderColor: color });
      await refresh();
      setContextMenu(undefined);
      setFolderColorMenu(undefined);
      setCardMenuId("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : uiText("文件夹颜色保存失败"));
    }
  }

  function openFolderColorMenu(item: ResourceLibraryItem, trigger: HTMLElement) {
    const bounds = trigger.getBoundingClientRect();
    setFolderColorMenu({ itemId: item.id, left: bounds.left, right: bounds.right, top: bounds.top });
  }

  async function saveItemAs(item: ResourceLibraryItem) {
    const folder = isFolder(item);
    const desktop = window.mokiDesktop;
    const destination = folder
      ? await desktop?.selectLocalFolder?.()
      : await desktop?.selectSavePath?.(resourceLibraryAttachmentName(item));
    if (!destination) {
      if (
        !desktop ||
        (folder ? !desktop.selectLocalFolder : !desktop.selectSavePath)
      ) {
        setMessage(uiText("请在 MOKI 客户端中使用另存为"));
      }
      return;
    }
    setBusy(true);
    setCardMenuId("");
    setContextMenu(undefined);
    setMessage("");
    try {
      const result = await exportResourceLibraryItem(item.id, {
        destination,
        mode: folder ? "folder" : "file",
      });
      setMessage(
        folder
          ? uiText`已另存为“${result.path}”（${result.files} 个文件）`
          : uiText`已另存为“${result.path}”`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : uiText("资料另存为失败"));
    } finally {
      setBusy(false);
    }
  }

  async function openInExplorer(item: ResourceLibraryItem) {
    setCardMenuId("");
    setContextMenu(undefined);
    try {
      if (item.kind === "local_folder") await openResourceLibraryItem(item.id);
      else await revealResourceLibraryFolder(item.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : uiText("打开路径失败"));
    }
  }

  function startFolderReindex(item: ResourceLibraryItem) {
    setCardMenuId("");
    setContextMenu(undefined);
    void reindexResourceLibraryFolder(item.id)
      .then(() => getResourceLibraryIndexStatus(item.id))
      .then((status) =>
        setIndexStatuses((current) => ({ ...current, [item.id]: status })),
      )
      .catch((error) =>
        setMessage(error instanceof Error ? error.message : uiText("索引启动失败")),
      );
  }

  async function cloneResourceTree(
    source: ResourceLibraryItem,
    parentId: string | null,
    topLevel: boolean,
  ): Promise<void> {
    const created = await createResourceLibraryItem({
      parentId,
      kind: source.kind,
      name: topLevel ? uiText`${source.name} 副本` : source.name,
      ...(source.target ? { target: source.target } : {}),
      tags: source.tags,
      ...(isFolder(source) ? { folderColor: source.folderColor ?? null } : {}),
    });
    if (!isFolder(source)) return;
    const children = items
      .filter((item) => item.parentId === source.id)
      .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0));
    for (const child of children)
      await cloneResourceTree(child, created.id, false);
  }

  function copyOrCutItems(
    item: ResourceLibraryItem | undefined,
    mode: LibraryClipboard["mode"],
  ) {
    const targets = operationItems(item);
    if (!targets.length) return;
    setLibraryClipboard({ mode, itemIds: targets.map((target) => target.id) });
    setCardMenuId("");
    setContextMenu(undefined);
    if (mode === "copy" && targets.every(target=>target.kind === "local_file")) {
      void copyLibraryFile(targets.map(target=>target.id))
        .then(()=>setMessage(uiText`已复制 ${targets.length} 个文件，可以粘贴到其他应用`))
        .catch(error=>setMessage(uiText`已复制资料库条目，系统文件复制失败：${error.message}`));
      return;
    }
    setMessage(
      uiText`已${mode === "cut" ? uiText("剪切") : uiText("复制")} ${targets.length} 项，可在目标目录粘贴`,
    );
  }

  async function addPastedResources(
    resources: DesktopClipboardResource[],
    destinationParentId: string | null = folderId,
  ) {
    if (!resources.length) return false;
    setBusy(true);
    setMessage("");
    try {
      for (const resource of resources) {
        await createResourceLibraryItem({
          parentId: destinationParentId,
          kind: resource.kind,
          name:
            resource.name ||
            displayNameFromTarget(resource.target, resource.kind) ||
            resource.target,
          target: resource.target,
          tags: [],
        });
      }
      await refresh();
      setMessage(uiText`已通过粘贴添加 ${resources.length} 项资料`);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : uiText("剪贴板资料添加失败"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function pasteExternalClipboard(
    destinationParentId: string | null = folderId,
  ) {
    const desktopReader = window.mokiDesktop?.readClipboardResources;
    if (desktopReader) {
      try {
        const resources = await desktopReader();
        if (resources.length)
          return addPastedResources(resources, destinationParentId);
      } catch {
        // Browser text fallback below still supports copied links and paths.
      }
    }
    let clipboardText = "";
    try {
      clipboardText = (await navigator.clipboard.readText()).trim();
    } catch {
      return setMessage(uiText("剪贴板中没有可添加的文件、文件夹或链接"));
    }
    const resources = clipboardTextResources(clipboardText);
    if (!resources.length)
      return setMessage(uiText("剪贴板中没有可添加的文件、文件夹或链接"));
    return addPastedResources(resources, destinationParentId);
  }

  async function pasteIntoFolder(
    destinationParentId: string | null = folderId,
  ) {
    setContextMenu(undefined);
    setCardMenuId("");
    if (libraryClipboard?.itemIds.length) {
      const sources = topLevelResourceSelection(
        items,
        libraryClipboard.itemIds,
      );
      if (!sources.length) {
        setLibraryClipboard(undefined);
        return setMessage(uiText("待粘贴的资料已不存在"));
      }
      if (
        sources.some(
          (source) =>
            source.id === destinationParentId ||
            (isFolder(source) &&
              resourceFolderDescendantIds(items, source.id).has(
                destinationParentId ?? "",
              )),
        )
      ) {
        return setMessage(uiText("不能将文件夹粘贴到自身或其子目录中"));
      }
      setBusy(true);
      setMessage("");
      try {
        if (libraryClipboard.mode === "cut") {
          for (const source of sources)
            await moveResourceLibraryItem(source.id, {
              parentId: destinationParentId,
              beforeId: null,
            });
          setLibraryClipboard(undefined);
          setSelectedItemIds(new Set());
        } else {
          for (const source of sources)
            await cloneResourceTree(source, destinationParentId, true);
        }
        await refresh();
        setMessage(
          uiText`已${libraryClipboard.mode === "cut" ? uiText("移动") : uiText("复制")} ${sources.length} 项到目标目录`,
        );
      } catch (error) {
        setMessage(error instanceof Error ? error.message : uiText("资料粘贴失败"));
      } finally {
        setBusy(false);
      }
      return;
    }
    let clipboardText = "";
    try {
      clipboardText = (await navigator.clipboard.readText()).trim();
    } catch {
      clipboardText = "";
    }
    const source =
      copiedItemRef.current?.target === clipboardText
        ? copiedItemRef.current
        : items.find(
            (item) => item.target === clipboardText && item.kind !== "folder",
          );
    if (source?.target && source.kind !== "folder") {
      setBusy(true);
      setMessage("");
      try {
        await createResourceLibraryItem({
          parentId: destinationParentId,
          kind: source.kind,
          name: source.name,
          target: source.target,
          tags: source.tags,
        });
        await refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : uiText("资料粘贴失败"));
      } finally {
        setBusy(false);
      }
      return;
    }
    await pasteExternalClipboard(destinationParentId);
  }

  async function pasteIntoCurrentFolder() {
    await pasteIntoFolder(folderId);
  }

  async function persistThumbnail(
    item: ResourceLibraryItem,
    media: HTMLImageElement | HTMLVideoElement,
  ): Promise<boolean> {
    if (item.hasThumbnail || item.thumbnailDataUrl || capturedThumbnailRef.current.has(item.id))
      return true;
    capturedThumbnailRef.current.add(item.id);
    const thumbnailDataUrl = createMediaThumbnailDataUrl(media);
    if (!thumbnailDataUrl) {
      capturedThumbnailRef.current.delete(item.id);
      return false;
    }
    try {
      const updated = await updateResourceLibraryItem(item.id, {
        thumbnailDataUrl,
      });
      setItems((currentItems) =>
        currentItems.map((candidate) =>
          candidate.id === updated.id ? updated : candidate,
        ),
      );
      setPreviewItem((currentItem) =>
        currentItem?.id === updated.id ? updated : currentItem,
      );
      return true;
    } catch (error) {
      capturedThumbnailRef.current.delete(item.id);
      setThumbnailFailures((current) => new Set(current).add(item.id));
      setMessage(
        error instanceof Error
          ? uiText`缩略图保存失败：${error.message}`
          : uiText("缩略图保存失败，可重新打开资料预览后重试"),
      );
      return false;
    }
  }

  async function repairBlankStoredThumbnail(
    item: ResourceLibraryItem,
    image: HTMLImageElement,
  ) {
    if ((!item.hasThumbnail && !item.thumbnailDataUrl) || capturedThumbnailRef.current.has(item.id) ||
        validatedThumbnailRef.current.get(item.id) === item.updatedAt)
      return;
    if (drawThumbnailCanvas(image)) {
      validatedThumbnailRef.current.set(item.id, item.updatedAt);
      return;
    }
    capturedThumbnailRef.current.add(item.id);
    try {
      const updated = await updateResourceLibraryItem(item.id, {
        thumbnailDataUrl: null,
      });
      setItems((currentItems) =>
        currentItems.map((candidate) =>
          candidate.id === updated.id ? updated : candidate,
        ),
      );
      setPreviewItem((currentItem) =>
        currentItem?.id === updated.id ? updated : currentItem,
      );
      setThumbnailFailures((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
    } catch (error) {
      setThumbnailFailures((current) => new Set(current).add(item.id));
      setMessage(
        error instanceof Error
          ? uiText`空白缩略图修复失败：${error.message}`
          : uiText("空白缩略图修复失败"),
      );
    } finally {
      capturedThumbnailRef.current.delete(item.id);
    }
  }

  function markThumbnailFailure(itemId: string) {
    capturedThumbnailRef.current.delete(itemId);
    setThumbnailFailures((current) => new Set(current).add(itemId));
  }
  function handlePickedFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] as
      (File & { path?: string }) | undefined;
    event.target.value = "";
    if (!file) return;
    let path = file.path;
    if (!path) {
      try {
        path = window.mokiDesktop?.getPathForFile?.(file);
      } catch {
        /* 浏览器预览没有绝对路径桥接 */
      }
    }
    if (!path) {
      setMessage(
        uiText("请在 MOKI 客户端中选择本地文件；浏览器无法读取文件的绝对路径。"),
      );
      return;
    }
    setKind("local_file");
    setTarget(path);
    const suggestedName = displayNameFromTarget(path, "local_file");
    if (!name.trim() || name === autoNameRef.current) {
      autoNameRef.current = suggestedName;
      setName(suggestedName);
    }
    setMessage("");
  }
  async function handlePickFolder() {
    if (!window.mokiDesktop?.selectLocalFolder) {
      setMessage(
        uiText("请在 MOKI 客户端中选择本地文件夹；浏览器无法读取文件夹的绝对路径。"),
      );
      return;
    }
    try {
      const path = await window.mokiDesktop.selectLocalFolder();
      if (!path) return;
      setKind("local_folder");
      setTarget(path);
      const suggestedName = displayNameFromTarget(path, "local_folder");
      if (!name.trim() || name === autoNameRef.current) {
        autoNameRef.current = suggestedName;
        setName(suggestedName);
      }
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : uiText("本地文件夹选择失败"));
    }
  }
  function parsedTags() {
    return normalizeResourceTags([...tags, tagDraft]);
  }
  function rememberTags(values: string[]) {
    const next = normalizeResourceTags([...values, ...tagHistory], 60);
    setTagHistory(next);
    window.localStorage.setItem(LIBRARY_TAG_HISTORY_KEY, JSON.stringify(next));
  }
  function deleteHistoricalTag(tag: string) {
    const key = tag.toLocaleLowerCase("zh-CN");
    const next = tagHistory.filter(value => value.toLocaleLowerCase("zh-CN") !== key);
    const hidden = normalizeResourceTags([...hiddenTagHistory, tag], Number.MAX_SAFE_INTEGER);
    setTagHistory(next);
    setHiddenTagHistory(hidden);
    window.localStorage.setItem(LIBRARY_TAG_HISTORY_KEY, JSON.stringify(next));
    window.localStorage.setItem(LIBRARY_HIDDEN_TAG_HISTORY_KEY, JSON.stringify(hidden));
  }
  async function saveDialog() {
    if (!name.trim()) return setMessage(uiText("请输入显示名称"));
    const nextTags = parsedTags();
    setBusy(true);
    setMessage("");
    try {
      if (editingItem) {
        await updateResourceLibraryItem(editingItem.id, {
          name: name.trim(),
          parentId: parentIdDraft || null,
          tags: nextTags,
          ...(editingItem.kind !== "folder" ? { target: target.trim() } : {}),
          ...(editingItem.kind === "local_folder" ? { assistantPermission } : {}),
        });
      } else if (createMode === "folder") {
        await createResourceLibraryItem({
          parentId: folderId,
          kind: "folder",
          name: name.trim(),
          folderColor: newFolderColor,
          tags: nextTags,
        });
      } else if (createMode === "file") {
        const created = await createGeneratedResourceLibraryFile({
          parentId: folderId,
          name: name.trim(),
          format: fileFormat,
          ...(fileFormat === "univer" ? { unitKind: univerUnitKind } : {}),
          content: fileContent,
          tags: nextTags,
        });
        void showPreview(created.item);
      } else {
        await createResourceLibraryItem({
          parentId: folderId,
          kind,
          name: name.trim(),
          target: target.trim(),
          tags: nextTags,
          ...(kind === "local_folder" ? { assistantPermission } : {}),
        });
      }
      rememberTags(nextTags);
      await refresh();
      resetDialog();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : uiText("资料保存失败"));
    } finally {
      setBusy(false);
    }
  }

  async function commitInlineRename(item: ResourceLibraryItem) {
    const nextName = renameDraft.trim();
    setRenamingItemId("");
    if (!nextName || nextName === item.name) {
      setRenameDraft("");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      await updateResourceLibraryItem(item.id, { name: nextName });
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : uiText("资料重命名失败"));
    } finally {
      setBusy(false);
      setRenameDraft("");
    }
  }

  function startInlineRename(item: ResourceLibraryItem) {
    setCardMenuId("");
    setContextMenu(undefined);
    setRenamingItemId(item.id);
    setRenameDraft(item.name);
    setMessage("");
  }

  async function remove(item: ResourceLibraryItem) {
    if (
      !window.confirm(uiText`仅从资料库移除“${item.name}”？不会删除磁盘或在线文件。`)
    )
      return;
    setBusy(true);
    try {
      await deleteResourceLibraryItem(item.id);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : uiText("资料删除失败"));
    } finally {
      setBusy(false);
    }
  }

  async function removeOperationItems(item?: ResourceLibraryItem) {
    const targets = operationItems(item);
    if (targets.length <= 1) {
      if (targets[0]) await remove(targets[0]);
      return;
    }
    if (
      !window.confirm(
        uiText`仅从资料库移除选中的 ${targets.length} 项？不会删除磁盘或在线文件。`,
      )
    )
      return;
    setBusy(true);
    try {
      for (const target of targets) await deleteResourceLibraryItem(target.id);
      setSelectedItemIds(new Set());
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : uiText("资料批量删除失败"));
    } finally {
      setBusy(false);
    }
  }

  async function permanentlyDeleteOperationItems(item: ResourceLibraryItem) {
    const targets = operationItems(item);
    if (busy || !targets.length || targets.some(target => !target.target || !["local_file", "local_folder"].includes(target.kind))) return;
    const containsFolder = targets.some(target => target.kind === "local_folder");
    const paths = targets.map(target => `${target.name}\n${target.target}`).join("\n\n");
    if (!window.confirm(uiText`彻底删除以下 ${targets.length} 项资料？\n\n${paths}\n\n将同时删除资料库记录和本地源文件${containsFolder ? uiText("，包括所选本地文件夹中的全部文件和子文件夹") : ""}。不经过回收站，无法撤销。`)) return;
    setBusy(true);
    let deleted = 0;
    try {
      for (const target of targets) {
        await permanentlyDeleteResourceLibraryItem(target.id, target.target!);
        deleted++;
      }
      setSelectedItemIds(new Set());
      setMessage(uiText`已彻底删除 ${deleted} 项资料及其本地源文件`);
    } catch (error) {
      setMessage(`${deleted ? uiText`已删除 ${deleted} 项；` : ""}${error instanceof Error ? error.message : uiText("彻底删除失败")}`);
    } finally {
      try {
        await refresh();
      } catch {
        setMessage(previous => uiText`${previous ? `${previous}；` : ""}资料列表刷新失败，请刷新页面查看最新状态`);
      } finally {
        setBusy(false);
      }
    }
  }

  async function importTransfer(
    dataTransfer: DataTransfer,
    destinationParentId = folderId,
  ) {
    resetDrop();
    if (busy || dropPending.current) return;
    // Chromium protects the drag store once the synchronous drop handler returns.
    const fileItems = Array.from(dataTransfer.items).filter(item => item.kind === "file");
    const files = Array.from(dataTransfer.files);
    const directories = fileItems.map(item => Boolean(item.webkitGetAsEntry?.()?.isDirectory));
    const textResources = clipboardTextResources(dataTransfer.getData("text/uri-list") || dataTransfer.getData("text/plain"));
    const destination = items.find(item => item.id === destinationParentId);
    const localFolder = destination?.kind === "local_folder";
    const directoryName = destination?.name || uiText("资料库");
    let mapped = 0, copied = 0;
    const failures: string[] = [];
    const seen = new Set<string>();
    dropPending.current = true;
    setBusy(true);
    setMessage("");
    async function addResource(resource: DesktopClipboardResource) {
      if (seen.has(resource.target)) return;
      seen.add(resource.target);
      if (localFolder && resource.kind !== "url") {
        await importLocalResourceIntoFolder(destination.id, resource.target);
        copied++;
      } else {
        await createResourceLibraryItem({parentId:destinationParentId, ...resource, tags:[]});
        mapped++;
      }
    }
    try {
      const paths = await pathsForDroppedFiles(files);
      for (const [index,file] of files.entries()) {
        try {
          const path = paths[index] || (file as File & {path?: string}).path;
          if (path) {
            const kind = directories[index] ? "local_folder" : "local_file";
            await addResource({kind, name:displayNameFromTarget(path, kind) || file.name, target:path});
          } else if (directories[index]) {
            failures.push(file.name + uiText("：请用「添加文件」选择此文件夹"));
          } else {
            await importDroppedFile(file, destinationParentId);
            copied++;
          }
        } catch (error) { failures.push(file.name + "：" + (error instanceof Error ? error.message : uiText("导入失败"))); }
      }
      for (const resource of textResources) {
        // Explorer can advertise the same local object as a File and as a URL.
        if (files.length && resource.kind !== "url") continue;
        try { await addResource(resource); }
        catch (error) { failures.push((resource.name || resource.target) + "：" + (error instanceof Error ? error.message : uiText("导入失败"))); }
      }
      if (mapped || copied) await refresh();
      const done = [mapped && uiText`映射 ${mapped} 项`, copied && uiText`复制 ${copied} 项`].filter(Boolean).join("、");
      const summary = done ? uiText`已向“${directoryName}”${done}` : "";
      setMessage([summary, ...failures].filter(Boolean).join("。") || uiText("未读取到可映射的本地文件或链接"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : uiText("资料导入失败"));
    } finally {
      dropPending.current = false;
      setBusy(false);
    }
  }

  async function handleDrop(
    event: DragEvent<HTMLElement>,
    destinationParentId = folderId,
  ) {
    event.preventDefault();
    await importTransfer(event.dataTransfer, destinationParentId);
  }

  function isInternalDrag(event: DragEvent<HTMLElement>) {
    if (nativeDragSource.current && event.dataTransfer.types.includes("Files")) return true;
    return Boolean(draggedItemId) && event.dataTransfer.types.includes(RESOURCE_DRAG_TYPE);
  }

  function acceptsExternalDrop(event: DragEvent<HTMLElement>) {
    return event.dataTransfer.types.some(type => ["Files", "text/uri-list", "text/plain"].includes(type));
  }

  function allowBreadcrumbDrop(event: DragEvent<HTMLElement>, id: string) {
    if (busy || (!isInternalDrag(event) && !acceptsExternalDrop(event))) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = isInternalDrag(event) && !nativeDragSource.current ? "move" : "copy";
    setDragActive(false);
    setCardDropTarget(undefined);
    setBreadcrumbDropId(id);
  }

  function dropOnBreadcrumb(
    event: DragEvent<HTMLElement>,
    destinationParentId: string | null,
  ) {
    event.preventDefault();
    event.stopPropagation();
    resetDrop();
    if (busy) return;
    if (isInternalDrag(event)) {
      const sourceId = nativeDragSource.current || event.dataTransfer.getData(RESOURCE_DRAG_TYPE);
      void moveItemsToParent(
        dragOperationItems(sourceId).map((item) => item.id),
        destinationParentId,
        null,
        true,
      );
    } else {
      void handleDrop(event, destinationParentId);
    }
  }

  function cardDropMode(
    event: DragEvent<HTMLElement>,
    item: ResourceLibraryItem,
  ): CardDropMode | undefined {
    const moving = dragOperationItems(draggedItemId);
    if (moving.some(source => source.id === item.id || (isFolder(source) && resourceFolderDescendantIds(items, source.id).has(item.id)))) return;
    if (sortMode !== "manual") return isFolder(item) ? "inside" : undefined;
    const bounds = event.currentTarget.getBoundingClientRect();
    return resolveCardDropMode({
      folderTarget: isFolder(item),
      viewMode,
      horizontalRatio:
        bounds.width > 0 ? (event.clientX - bounds.left) / bounds.width : 0.5,
      verticalRatio:
        bounds.height > 0 ? (event.clientY - bounds.top) / bounds.height : 0.5,
      sourceIndex: visible.findIndex(
        (candidate) => candidate.id === draggedItemId,
      ),
      targetIndex: visible.findIndex((candidate) => candidate.id === item.id),
    });
  }

  function manualDropBeforeId(
    clientX: number,
    clientY: number,
    sourceId = draggedItemId,
  ): string | null {
    const movingIds = new Set(
      dragOperationItems(sourceId).map((item) => item.id),
    );
    const cards = [
      ...(selectionSurfaceRef.current?.querySelectorAll<HTMLElement>(
        "[data-resource-id]",
      ) ?? []),
    ]
      .filter((element) => !movingIds.has(element.dataset.resourceId ?? ""))
      .map((element) => {
        const bounds = element.getBoundingClientRect();
        return {
          id: element.dataset.resourceId ?? "",
          left: bounds.left,
          top: bounds.top,
          right: bounds.right,
          bottom: bounds.bottom,
        };
      })
      .filter((card) => card.id);
    return resolveManualDropBeforeId(cards, clientX, clientY);
  }

  function dragOperationItems(itemId: string): ResourceLibraryItem[] {
    const source = items.find((item) => item.id === itemId);
    return source ? operationItems(source) : [];
  }

  async function moveItemsToParent(
    itemIds: string[],
    parentId: string | null,
    beforeId: string | null = null,
    dropped = false,
  ) {
    const targets = topLevelResourceSelection(items, itemIds);
    if (!targets.length) return;
    if (
      targets.some(
        (target) =>
          isFolder(target) &&
          (target.id === parentId || resourceFolderDescendantIds(items, target.id).has(parentId ?? "")),
      )
    ) {
      setMessage(uiText("不能将文件夹移动到自身或其子目录中"));
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const destinationFolder = items.find((item) => item.id === parentId);
      let copied = 0;
      for (const target of targets) {
        if (dropped && destinationFolder?.kind === "local_folder" && target.parentId !== parentId && target.target && (target.kind === "local_file" || target.kind === "local_folder")) {
          await importLocalResourceIntoFolder(destinationFolder.id, target.target);
          copied++;
        } else {
          await moveResourceLibraryItem(target.id, { parentId, beforeId });
        }
      }
      await refresh();
      const destination = parentId
        ? items.find((item) => item.id === parentId)?.name
        : uiText("资料库");
      setMessage(copied ? uiText`已向“${destination ?? uiText("资料库")}”复制 ${copied} 项本地资料` : uiText`已将 ${targets.length} 项移动到“${destination ?? uiText("资料库")}”`);
      setSelectedItemIds(new Set());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : uiText("资料移动失败"));
    } finally {
      setBusy(false);
      setDraggedItemId("");
      setCardDropTarget(undefined);
      setBreadcrumbDropId(undefined);
      setMoveDialogItems([]);
    }
  }

  async function moveItem(
    itemId: string,
    target: ResourceLibraryItem | undefined,
    mode: CardDropMode = "inside",
  ) {
    if (!itemId || itemId === target?.id) return;
    const parentId =
      mode === "inside"
        ? (target?.id ?? folderId)
        : (target?.parentId ?? folderId);
    let beforeId: string | null = null;
    if (target && mode !== "inside") {
      const movingIds = new Set(
        dragOperationItems(itemId).map((item) => item.id),
      );
      const siblings = items.filter(
        (item) => item.parentId === parentId && !movingIds.has(item.id),
      ).sort((a,b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
      const targetIndex = siblings.findIndex((item) => item.id === target.id);
      beforeId =
        mode === "before" ? target.id : (siblings[targetIndex + 1]?.id ?? null);
    }
    await moveItemsToParent(
      dragOperationItems(itemId).map((item) => item.id),
      parentId ?? null,
      beforeId,
      true,
    );
  }

  async function confirmMove() {
    if (!moveDialogItems.length) return;
    await moveItemsToParent(
      moveDialogItems.map((item) => item.id),
      moveTargetId || null,
    );
  }

  async function showPreview(item: ResourceLibraryItem, destination?: "sidebar") {
    if (window.parent === window || !new URLSearchParams(location.search).has("bridge")) {
      setPreviewItem(item);
      return;
    }
    try {
      const result = await requestParent<{destination?:string}>("open-preview", {id:item.id, name:item.name, destination}, 45000);
      if (result?.destination === "system") await openResourceLibraryItem(item.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : uiText("预览打开失败"));
    }
  }

  async function open(item: ResourceLibraryItem) {
    if (isFolder(item)) {
      if (item.kind === "local_folder") {
        setIndexStatuses((statuses) => ({
          ...statuses,
          [item.id]: {
            itemId: item.id,
            status: "queued",
            phase: "scanning",
            total: 0,
            processed: 0,
            added: 0,
            updated: 0,
            removed: 0,
            startedAt: new Date().toISOString(),
          },
        }));
      }
      setFolderId(item.id);
      return;
    }
    await showPreview(item);
  }

  function handleCardNameDoubleClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (!(event.target instanceof HTMLElement) || event.target.tagName !== "B")
      return;
    const card = event.target.closest<HTMLElement>("article[data-resource-id]");
    const item = card && visible.find(entry => entry.id === card.dataset.resourceId);
    if (!item) return;
    event.preventDefault();
    event.stopPropagation();
    setRenamingItemId(item.id);
    setRenameDraft(item.name);
    setMessage("");
  }

  function handleLibraryClickCapture(event: ReactMouseEvent<HTMLDivElement>) {
    if (event.detail > 0 && suppressClickAfterFileDrag.current) {
      suppressClickAfterFileDrag.current = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (
      event.target instanceof HTMLElement &&
      event.target.tagName === "INPUT" &&
      event.target.closest("article.group")
    ) {
      event.stopPropagation();
    }
  }

  const itemMenuButtonClass = "library-menu-item";
  function itemMenuItems(item: ResourceLibraryItem) {
    const targetCount = operationItems(item).length;
    const pasteDestination = isFolder(item) ? item.id : item.parentId;
    return (
      <>
        <button
          type="button"
          role="menuitem"
          disabled={targetCount > 1}
          onClick={() => {
            setCardMenuId("");
            setContextMenu(undefined);
            void open(item);
          }}
          className={itemMenuButtonClass}
        >
          <ExternalLink size={14} />{uiText("打开")}</button>
        {!isFolder(item) && <button type="button" role="menuitem" disabled={targetCount > 1} className={itemMenuButtonClass + " library-open-in-sidebar"}
          onClick={() => {setCardMenuId(""); setContextMenu(undefined); void showPreview(item, "sidebar");}}>
          <PanelRightOpen size={14}/>{uiText("在侧边工作区打开")}</button>}
        {(item.kind === "local_folder" || item.kind === "local_file") ? (
          <button
            type="button"
            role="menuitem"
            disabled={targetCount > 1}
            onClick={() => void openInExplorer(item)}
            className={itemMenuButtonClass}
          >
            <FolderOpen size={14} />{uiText("打开路径")}</button>
        ) : null}
        <button
          type="button"
          role="menuitem"
          disabled={targetCount > 1}
          onClick={() => void copyItemPath(item)}
          className={itemMenuButtonClass}
        >
          <Copy size={14} />{uiText("复制路径")}</button>
        {item.kind === "local_folder" ? <button type="button" role="menuitem" disabled={targetCount > 1 || busy} className={itemMenuButtonClass} onClick={() => beginEdit(item)}><ShieldCheck size={14} />{uiText("助手权限")}</button> : null}
        <div role="separator" className="moki-menu-divider" />
        {item.kind === "local_file" ? (
          <button type="button" role="menuitem" disabled={operationItems(item).some(target => target.kind !== "local_file")} onClick={() => void copyActualFile(item)} className={itemMenuButtonClass}>
            <Copy size={14} />{uiText("复制文件")}</button>
        ) : null}
        <button
          type="button"
          role="menuitem"
          disabled={targetCount > 1 || busy}
          onClick={() => void saveItemAs(item)}
          className={itemMenuButtonClass}
        >
          <Download size={14} />{uiText("另存为")}</button>
        <div role="separator" className="moki-menu-divider" />
        <button
          type="button"
          role="menuitem"
          disabled={targetCount > 1}
          onClick={() => beginEdit(item)}
          className={itemMenuButtonClass}
        >
          <Pencil size={14} />{uiText("编辑")}</button>
        <button
          type="button"
          role="menuitem"
          disabled={targetCount > 1}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => startInlineRename(item)}
          className={itemMenuButtonClass}
        >
          <TextCursorInput size={14} />{uiText("重命名")}</button>
        {isFolder(item) ? (
          <button
            ref={folderColorTriggerRef}
            type="button"
            role="menuitem"
            data-folder-color-trigger
            aria-haspopup="menu"
            aria-expanded={folderColorMenu?.itemId === item.id}
            aria-controls="library-folder-color-menu"
            onPointerEnter={(event) => openFolderColorMenu(item, event.currentTarget)}
            onClick={(event) => openFolderColorMenu(item, event.currentTarget)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") {
                event.preventDefault();
                openFolderColorMenu(item, event.currentTarget);
                window.requestAnimationFrame(() => folderColorMenuRef.current?.querySelector<HTMLButtonElement>("button")?.focus());
              }
            }}
            className={itemMenuButtonClass}
          >
            <Palette size={14} />{uiText("文件夹颜色")}<ChevronRight size={13} className="ml-auto" />
          </button>
        ) : null}
        {item.kind === "local_folder" ? (
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={() => startFolderReindex(item)}
            className={itemMenuButtonClass}
          >
            <FolderInput size={14} />{uiText("重新索引")}</button>
        ) : null}
        <div role="separator" className="moki-menu-divider" />
        <button
          type="button"
          role="menuitem"
          onClick={() => beginMove(item)}
          className={itemMenuButtonClass}
        >
          <FolderTree size={14} />{uiText("移动到")}</button>
        <button
          type="button"
          role="menuitem"
          onClick={() => copyOrCutItems(item, "copy")}
          className={itemMenuButtonClass}
        >
          <ClipboardCopy size={14} />{uiText("复制")}{targetCount > 1 ? ` (${targetCount})` : ""}
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={() => copyOrCutItems(item, "cut")}
          className={itemMenuButtonClass}
        >
          <Scissors size={14} />{uiText("剪切")}{targetCount > 1 ? ` (${targetCount})` : ""}
        </button>
        <button
          type="button"
          role="menuitem"
          disabled={busy}
          onClick={() => void pasteIntoFolder(pasteDestination ?? null)}
          className={itemMenuButtonClass}
        >
          <ClipboardPaste size={14} />{uiText("粘贴")}</button>
        <div role="separator" className="moki-menu-divider" />
        <button
          type="button"
          role="menuitem"
          disabled={busy}
          onClick={() => {
            setCardMenuId("");
            setContextMenu(undefined);
            void removeOperationItems(item);
          }}
          className={itemMenuButtonClass}
          data-tone="danger"
        >
          <Trash2 size={14} />{uiText("移除")}{targetCount > 1 ? ` (${targetCount})` : ""}
        </button>
        <button
          type="button"
          role="menuitem"
          disabled={busy || operationItems(item).some(target => !target.target || !["local_file", "local_folder"].includes(target.kind))}
          title={uiText("删除本地文件或文件夹及其资料库记录")}
          onClick={() => {
            setCardMenuId("");
            setContextMenu(undefined);
            void permanentlyDeleteOperationItems(item);
          }}
          className={itemMenuButtonClass}
          data-tone="danger"
        >
          <Trash2 size={14} />{uiText("彻底删除")}{targetCount > 1 ? ` (${targetCount})` : ""}
        </button>
      </>
    );
  }

  const dialogOpen = Boolean(createMode || editingItem);
  useEffect(() => {
    if (!message || dialogOpen || moveDialogItems.length) return;
    const timeout = window.setTimeout(() => setMessage(""), 5000);
    return () => window.clearTimeout(timeout);
  }, [dialogOpen, message, moveDialogItems.length]);
  const currentIndexStatus =
    current?.kind === "local_folder" ? indexStatuses[current.id] : undefined;
  const dropFolder = dragActive && cardDropTarget?.mode === "inside" ? items.find(item => item.id === cardDropTarget.id) : current;
  const currentIndexProgress = currentIndexStatus?.total
    ? Math.min(
        100,
        Math.round(
          (currentIndexStatus.processed / currentIndexStatus.total) * 100,
        ),
      )
    : 0;
  const currentFolderLoading =
    currentIndexStatus?.status === "queued" ||
    currentIndexStatus?.status === "indexing";
  const sortDirectionFor = (
    field: LibrarySortField,
  ): LibrarySortDirection | undefined => {
    if (sortMode === `${field}-asc`) return "asc";
    if (sortMode === `${field}-desc`) return "desc";
    return undefined;
  };
  const sortHeader = (
    field: LibrarySortField,
    label: string,
    className = "",
  ) => {
    const direction = sortDirectionFor(field);
    return (
      <span
        role="columnheader"
        data-library-column={field}
        aria-sort={
          direction === "asc"
            ? "ascending"
            : direction === "desc"
              ? "descending"
              : "none"
        }
        className={className}
      >
        <button
          type="button"
          aria-label={uiText`按${label}排序${direction ? uiText`，当前${direction === "asc" ? uiText("升序") : uiText("降序")}` : ""}`}
          onClick={() =>
            setSortMode((current) => toggleLibrarySortMode(current, field))
          }
          className={`library-list-sort-button flex h-6 min-h-0 w-full min-w-0 items-center gap-1 rounded-md text-left transition hover:text-[#625bc5] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#716acd] ${direction ? "text-[#625bc5]" : ""}`}
        >
          <span className="min-w-0 truncate">{label}</span>
          {direction === "asc" ? (
            <ArrowUp aria-hidden="true" className="shrink-0" size={11} />
          ) : direction === "desc" ? (
            <ArrowDown aria-hidden="true" className="shrink-0" size={11} />
          ) : null}
        </button>
        {columnWidths.renderHandle(field, label)}
      </span>
    );
  };
  return (
    <AppShell hideMainScrollbar fitMainContent
      onPointerDown={beginBoxSelection} onPointerMove={updateBoxSelection}
      onPointerUp={event => updateBoxSelection(event, true)}
      onPointerCancel={cancelBoxSelection} onLostPointerCapture={cancelBoxSelection}>
      <div
        id="resource-library-page"
        ref={pageRef}
        onPointerDownCapture={() => { suppressClickAfterFileDrag.current = false; }}
        onClickCapture={handleLibraryClickCapture}
        onDoubleClickCapture={handleCardNameDoubleClick}
        className="flex h-full w-full min-h-0 min-w-0 flex-col"
      >
        <div className="dsh-library-commandbar">
        <header className="dsh-library-tools">
          <LibraryPathBar path={currentPath} onUp={folderId ? () => setFolderId(current?.parentId ?? null) : undefined} onNavigate={(path) => {
            const item = resolveResourceLibraryPath(path, items);
            setQuery(""); setTagFilter("");
            if (item && isFolder(item)) void open(item);
            else setFolderId(item?.parentId ?? null);
            setSelectedItemIds(new Set(item && !isFolder(item) ? [item.id] : []));
          }}>
            <button
              type="button"
              onClick={() => setFolderId(null)}
              aria-current={!folderId ? "location" : undefined}
              onDragOver={(event) => allowBreadcrumbDrop(event, "root")}
              onDragLeave={() => setBreadcrumbDropId(undefined)}
              onDrop={(event) => dropOnBreadcrumb(event, null)}
              className={`flex h-8 min-h-0 shrink-0 items-center rounded-lg px-2 py-0 transition ${breadcrumbDropId === "root" ? "bg-[#dedcf9] text-[#5f58bd] ring-1 ring-[#716acd]" : "hover:bg-[#f1f0ff]"}`}
            >{uiText("资料库")}</button>
            {breadcrumbs.map((item) => (
              <span
                key={item.id}
                className="flex h-8 shrink-0 items-center gap-2"
              >
                <ChevronRight size={13} aria-hidden="true"/>
                <button
                  type="button"
                  onClick={() => void open(item)}
                  aria-current={item.id === folderId ? "location" : undefined}
                  onDragOver={(event) => allowBreadcrumbDrop(event, item.id)}
                  onDragLeave={() => setBreadcrumbDropId(undefined)}
                  onDrop={(event) => dropOnBreadcrumb(event, item.id)}
                  className={`flex h-8 min-h-0 items-center rounded-lg px-2 py-0 transition ${breadcrumbDropId === item.id ? "bg-[#dedcf9] text-[#5f58bd] ring-1 ring-[#716acd]" : "hover:bg-[#f1f0ff]"}`}
                >
                  {item.name}
                </button>
              </span>
            ))}
          </LibraryPathBar>
          <div className="dsh-library-create">
            <div ref={createMenuRef} className="relative shrink-0">
              <Button
                type="button"
                aria-label={uiText("新建")} title={uiText("新建")}
                aria-controls="library-create-menu"
                aria-expanded={createMenuOpen}
                aria-haspopup="menu"
                onKeyDown={event => {
                  if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
                  event.preventDefault();
                  setCreateMenuOpen(true);
                  const last = event.key === "ArrowUp";
                  requestAnimationFrame(() => {
                    const options = createMenuSurfaceRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)');
                    options?.[last ? options.length - 1 : 0]?.focus();
                  });
                }}
                onClick={() => setCreateMenuOpen((open) => !open)}
                size="compact"
              >
                <Plus size={15} />
                <span className="library-action-label">{uiText("新建")}</span>
                <ChevronDown
                  size={14}
                  className={`transition-transform ${createMenuOpen ? "rotate-180" : ""}`}
                />
              </Button>
              {createMenuOpen ? (
                <div
                  id="library-create-menu"
                  ref={createMenuSurfaceRef}
                  onKeyDown={navigateMenu}
                  role="menu"
                  aria-label={uiText("新建内容")}
                  className="moki-menu-surface library-menu fixed z-[100] w-60 max-h-[60vh] overflow-y-auto p-1.5"
                >
                  {createMenuItems()}
                </div>
              ) : null}
            </div>
            <Button
              type="button"
              onClick={() => {
                resetDialog();
                setParentIdDraft(folderId ?? "");
                setCreateMode("mapping");
              }}
              variant="primary" size="compact" aria-label={uiText("添加文件")} title={uiText("添加文件")}
            >
              <FileUp size={15} />
              <span className="library-action-label">{uiText("添加文件")}</span>
            </Button>
          </div>
        </header>
        <div className="dsh-library-filters">
          <div className="dsh-library-search">
            <Search
              size={14}
              aria-hidden="true"
              className="moki-ui-search-icon"
            />
            <Input
              ref={searchInputRef}
              aria-label={uiText("搜索资料库")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={event => {
                if (event.key !== "Escape" || !query || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
                event.preventDefault();
                event.stopPropagation();
                clearSearch();
              }}
              placeholder={uiText("搜索名称、标签或路径")}
              className="moki-ui-toolbar-search w-full"
            />
            {query && <button type="button" aria-label={uiText("清除搜索")} title={uiText("清除搜索")} className="library-search-clear" onClick={clearSearch}>
              <X size={14} aria-hidden="true" />
            </button>}
          </div>
          <div className="dsh-library-view-actions">
          <div className="library-sort-control" title={uiText("资料排序")}>
          <ArrowDownUp size={14} aria-hidden="true"/>
          <select
            id="library-sort"
            aria-label={uiText("资料排序")}
            value={sortMode}
            onChange={(event) =>
              setSortMode(event.target.value as LibrarySortMode)
            }
            className="library-toolbar-field h-10 shrink-0 rounded-xl border border-[#e1e3ec] bg-white px-3 text-[0.6875rem] font-bold text-[#656b7e] outline-none focus:border-[#8a83d9]"
          >
            <option value="manual">{uiText("自定义排序")}</option>
            <option value="name-asc">{uiText("名称：升序 A–Z")}</option>
            <option value="name-desc">{uiText("名称：降序 Z–A")}</option>
            <option value="type-asc">{uiText("类型：升序")}</option>
            <option value="type-desc">{uiText("类型：降序")}</option>
            <option value="path-asc">{uiText("路径：升序")}</option>
            <option value="path-desc">{uiText("路径：降序")}</option>
            <option value="modified-desc">{uiText("文件修改：由新到旧")}</option>
            <option value="modified-asc">{uiText("文件修改：由旧到新")}</option>
            <option value="added-desc">{uiText("添加时间：由新到旧")}</option>
            <option value="added-asc">{uiText("添加时间：由旧到新")}</option>
          </select>
          </div>
          <div
            className="library-toolbar-field flex h-10 shrink-0 items-center rounded-xl border border-[#e1e3ec] bg-white p-1"
            role="group"
            aria-label={uiText("资料显示模式")}
          >
            <button
              type="button"
              aria-label={uiText("卡片模式")}
              aria-pressed={viewMode === "grid"}
              onClick={() => setViewMode("grid")}
              className={`library-view-mode-button grid size-8 aspect-square min-h-0 shrink-0 place-items-center rounded-lg transition ${viewMode === "grid" ? "bg-[#292f47] text-white" : "text-[#858b9d] hover:bg-[#f1f0ff]"}`}
            >
              <Grid2X2 size={13} />
            </button>
            <button
              type="button"
              aria-label={uiText("列表模式")}
              aria-pressed={viewMode === "list"}
              onClick={() => setViewMode("list")}
              className={`library-view-mode-button grid size-8 aspect-square min-h-0 shrink-0 place-items-center rounded-lg transition ${viewMode === "list" ? "bg-[#292f47] text-white" : "text-[#858b9d] hover:bg-[#f1f0ff]"}`}
            >
              <List size={14} />
            </button>
            {viewMode === "list" && columnWidths.hasCustomWidths ? (
              <IconButton
                variant="ghost"
                aria-label={uiText("恢复默认列宽")}
                title={uiText("恢复默认列宽")}
                onClick={columnWidths.resetAll}
              >
                <RotateCcw size={14} />
              </IconButton>
            ) : null}
          </div>
        </div>
          </div>
        </div>
        <div className="dsh-library-tags">
          {availableTags.length ? (
            <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pb-0.5">
              <Tag size={13} className="shrink-0 text-[#716acd]" />
              <button
                type="button"
                onClick={() => setTagFilter("")}
                aria-pressed={!tagFilter}
                className={`library-filter-tag h-5 min-h-0 shrink-0 rounded-full px-2.5 py-0 text-[0.625rem] font-bold leading-5 ${!tagFilter ? "bg-[#292f47] text-white" : "bg-white text-[#6e7487]"}`}
              >{uiText("全部标签")}</button>
              {availableTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  title={tag}
                  aria-pressed={tagFilter === tag}
                  onClick={() => setTagFilter(tagFilter === tag ? "" : tag)}
                  className={`library-filter-tag h-5 min-h-0 shrink-0 rounded-full px-2.5 py-0 text-[0.625rem] font-bold leading-5 ${tagFilter === tag ? "bg-[#6d65cb] text-white" : "bg-white text-[#6e7487]"}`}
                >
                  {tag}
                </button>
              ))}
            </div>
          ) : (
            <span />
          )}
        </div>
        {selectedItemIds.size ? (
          <div
            className="dsh-selection-toolbar"
            role="toolbar"
            aria-label={uiText("资料多选操作")}
          >
            <span className="mr-auto">{uiText("已选择")}{selectedItemIds.size}{uiText("项")}</span>
            <button
              type="button"
              onClick={() =>
                setSelectedItemIds(new Set(visible.map((item) => item.id)))
              }
              className="rounded-lg px-2.5 py-1.5"
            >{uiText("全选当前结果")}</button>
            <button
              type="button"
              onClick={() => copyOrCutItems(undefined, "copy")}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5"
            >
              <ClipboardCopy size={13} />{uiText("复制")}</button>
            <button
              type="button"
              onClick={() => copyOrCutItems(undefined, "cut")}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5"
            >
              <Scissors size={13} />{uiText("剪切")}</button>
            <button
              type="button"
              onClick={() => beginMove()}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5"
            >
              <FolderTree size={13} />{uiText("移动到")}</button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void removeOperationItems()}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 dsh-remove disabled:opacity-40"
            >
              <Trash2 size={13} />{uiText("移除")}</button>
            <button
              type="button"
              aria-label={uiText("清除选择")}
              onClick={() => setSelectedItemIds(new Set())}
              className="grid size-7 place-items-center rounded-lg"
            >
              <X size={13} />
            </button>
          </div>
        ) : null}
        {message ? (
          <div
            role="status"
            className="library-feedback"
          >
            <span className="min-w-0 flex-1">{message}</span>
            <button
              type="button"
              aria-label={uiText("忽略提醒")}
              onClick={() => setMessage("")}
              className="library-dismiss"
            >
              <X size={14}/>
            </button>
          </div>
        ) : null}
        <section
          onContextMenu={(event) => {
            if ((event.target as HTMLElement).closest("article.group")) return;
            showContextMenu(event);
          }}
          onDragOver={(event) => {
            if (busy || (!isInternalDrag(event) && !acceptsExternalDrop(event))) return;
            event.preventDefault();
            if (isInternalDrag(event)) {
              event.dataTransfer.dropEffect = nativeDragSource.current ? "copy" : "move";
              const sourceId =
                event.dataTransfer.getData(RESOURCE_DRAG_TYPE) || draggedItemId;
              const beforeId =
                sortMode === "manual"
                  ? manualDropBeforeId(event.clientX, event.clientY, sourceId)
                  : null;
              setCardDropTarget(
                beforeId ? { id: beforeId, mode: "before" } : undefined,
              );
              setDragActive(false);
            } else {
              event.dataTransfer.dropEffect = "copy";
              setCardDropTarget(undefined);
              setDragActive(true);
            }
          }}
          onDragLeave={(event) => {
            if (
              !event.currentTarget.contains(event.relatedTarget as Node | null)
            )
              resetDrop();
          }}
          onDrop={(event) => {
            if (busy || (!isInternalDrag(event) && !acceptsExternalDrop(event))) return;
            if (isInternalDrag(event)) {
              event.preventDefault();
              resetDrop();
              const sourceId = nativeDragSource.current || event.dataTransfer.getData(RESOURCE_DRAG_TYPE);
              const beforeId =
                sortMode === "manual"
                  ? manualDropBeforeId(event.clientX, event.clientY, sourceId)
                  : null;
              if (sortMode !== "manual" && dragOperationItems(sourceId).every(item => item.parentId === folderId)) return;
              void moveItemsToParent(
                dragOperationItems(sourceId).map((item) => item.id),
                folderId,
                beforeId,
                true,
              );
              return;
            }
            void handleDrop(event);
          }}
          data-library-resource-surface
          data-drag-active={dragActive || undefined}
          className="moki-ui-card flex min-h-0 min-w-0 max-w-full flex-1 flex-col overflow-hidden"
        >
          {dragActive && <div className="library-drop-hint" role="status">
            {dropFolder?.kind === "local_folder" ? uiText`松开以复制到“${dropFolder.name}”` : uiText`松开以添加到“${dropFolder?.name || uiText("资料库")}”`}
          </div>}
          <div
            ref={selectionSurfaceRef}
            data-library-view={viewMode}
            data-page-scroll-key={`library:${folderId??"root"}`} aria-busy={initialLoading} className="library-resource-scroll relative min-h-0 min-w-0 max-w-full flex-1 touch-pan-y overflow-x-hidden overflow-y-auto p-4"
          >
            {selectionRect && (selectionRect.startX !== selectionRect.currentX || selectionRect.startY !== selectionRect.currentY) ? (
              createPortal(<div
                aria-hidden="true"
                className="library-selection-rect"
                style={{
                  position: 'fixed',
                  left: Math.min(selectionRect.startX, selectionRect.currentX),
                  top: Math.min(selectionRect.startY, selectionRect.currentY),
                  width: Math.abs(
                    selectionRect.currentX - selectionRect.startX,
                  ),
                  height: Math.abs(
                    selectionRect.currentY - selectionRect.startY,
                  ),
                }}
              />, document.body)
            ) : null}
            {currentFolderLoading ? (
              <div
                role="status"
                className="library-loading"
              >
                <div className="flex items-center justify-between gap-3 text-[0.6875rem] font-bold text-[#625bc5]">
                  <span className="flex items-center gap-2">
                    <LoaderCircle size={14} className="motion-safe:animate-spin" aria-hidden="true" />{uiText("正在读取“")}{current?.name}{uiText("”中的文件")}</span>
                  <span>
                    {currentIndexStatus?.total
                      ? `${currentIndexProgress}%`
                      : uiText("正在扫描")}
                  </span>
                </div>
                <div className="moki-loading-progress" role="progressbar" aria-label={uiText("文件夹读取进度")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={currentIndexStatus?.total ? currentIndexProgress : undefined} data-indeterminate={!currentIndexStatus?.total}>
                  <div
                    style={{
                      width: currentIndexStatus?.total ? `${currentIndexProgress}%` : undefined,
                    }}
                  />
                </div>
              </div>
            ) : null}
            {initialLoading ? (
              <PageFeedback title={uiText("正在加载资料库")} description={uiText("读取文件、文件夹与映射目录。")} skeleton="rows" />
            ) : visible.length ? (
              <div
                className={viewMode === "list" ? "library-list-table" : "contents"}
                style={viewMode === "list" ? columnWidths.style : undefined}
                data-resizing={viewMode === "list" && columnWidths.resizing ? "true" : undefined}
              >
                {viewMode === "list" ? (
                  <div
                    role="row"
                    className="library-list-header"
                    aria-label={uiText("资料列表列标题")}
                  >
                    <span aria-hidden="true" />
                    {sortHeader(
                      "name",
                      uiText("名称"),
                      "library-list-name-column",
                    )}
                    {sortHeader("type", uiText("类型"), "library-list-type-column")}
                    {sortHeader(
                      "path",
                      uiText("路径"),
                      "library-list-path-column",
                    )}
                    {sortHeader("modified", uiText("修改时间"), "library-list-modified-column")}
                    {sortHeader("added", uiText("添加时间"), "library-list-added-column")}
                  </div>
                ) : null}
                <LibraryResultWindow items={visible} viewMode={viewMode} scrollRef={selectionSurfaceRef}
                  draggedId={draggedItemId} renamingId={renamingItemId} loading={currentFolderLoading} renderProbe={renderThumbnailProbe}>
                  {(item) => {
                    const selected = highlightedItemIds.has(item.id);
                    const iconStyle = folderColorStyle(item);
                    const thumbnailUrl = resourceLibraryThumbnailUrl(item);
                    const indexStatus =
                      item.kind === "local_folder"
                        ? indexStatuses[item.id]
                        : undefined;
                    const indexProgress = indexStatus?.total
                      ? Math.min(
                          100,
                          Math.round(
                            (indexStatus.processed / indexStatus.total) * 100,
                          ),
                        )
                      : 0;
                    const dropMode =
                      cardDropTarget?.id === item.id
                        ? cardDropTarget.mode
                        : undefined;
                    return (
                      <article
                        key={item.id}
                        data-resource-id={item.id}
                        data-resource-selected={selected}
                        data-drop-mode={dropMode}
                        title={resourceItemTooltip(item)}
                        onContextMenu={(event) => showContextMenu(event, item)}
                        draggable={!busy && renamingItemId !== item.id}
                        onPointerEnter={item.kind === "local_file" && nativeFileDrag ? warmNativeFileDrag : undefined}
                        onPointerDownCapture={event => { if (event.altKey && item.kind === "local_file") prepareFileExport(operationItems(item)); }}
                        onDragStart={(event) => {
                          if (busy || renamingItemId === item.id) {
                            event.preventDefault();
                            return;
                          }
                          if (item.kind === "local_file" && (event.altKey || (nativeFileDrag && operationItems(item).every(target=>target.kind==="local_file")))) {
                            startFileDrag(event, item);
                            return;
                          }
                          event.dataTransfer.effectAllowed = "copyMove";
                          event.dataTransfer.setData(RESOURCE_DRAG_TYPE, item.id);
                          beginLibraryDrag(event.dataTransfer, operationItems(item));
                          setDraggedItemId(item.id);
                        }}
                        onDragEnd={() => {
                          setDraggedItemId("");
                          resetDrop();
                          endLibraryDrag();
                        }}
                        onDragOver={(event) => {
                          if (busy || (!isInternalDrag(event) && !acceptsExternalDrop(event))) return;
                          event.preventDefault();
                          event.stopPropagation();
                          const internal = isInternalDrag(event);
                          if (!internal) setDragActive(true);
                          const mode = internal
                            ? cardDropMode(event, item)
                            : isFolder(item)
                              ? "inside"
                              : undefined;
                          event.dataTransfer.dropEffect = internal && !mode ? "none" : internal && !nativeDragSource.current ? "move" : "copy";
                          setCardDropTarget(mode ? {id:item.id,mode} : undefined);
                        }}
                        onDragLeave={(event) => {
                          if (
                            !event.currentTarget.contains(
                              event.relatedTarget as Node | null,
                            )
                          )
                            setCardDropTarget(undefined);
                        }}
                        onDrop={(event) => {
                          if (busy || (!isInternalDrag(event) && !acceptsExternalDrop(event))) return;
                          event.preventDefault();
                          event.stopPropagation();
                          resetDrop();
                          if (isInternalDrag(event)) {
                            const mode = cardDropMode(event, item);
                            if (mode) void moveItem(nativeDragSource.current || event.dataTransfer.getData(RESOURCE_DRAG_TYPE), item, mode);
                          } else {
                            void handleDrop(
                              event,
                              isFolder(item) ? item.id : folderId,
                            );
                          }
                        }}
                        className={`group relative min-h-0 min-w-0 max-w-full ${cardMenuId === item.id ? "z-30 overflow-visible" : "z-0 overflow-hidden"} ${viewMode === "grid" ? "library-resource-card" : "library-resource-list-row w-full"} ${draggedItemId === item.id ? "opacity-45" : ""}`}
                      >
                        {dropMode === "before" || dropMode === "after" ? (
                          <span
                            aria-label={
                              dropMode === "before"
                                ? uiText`插入到 ${item.name} 前`
                                : uiText`插入到 ${item.name} 后`
                            }
                            data-card-insertion-indicator
                            className="library-insertion-mark"
                          />
                        ) : null}
                        <label
                          data-resource-select
                          className={`z-20 grid cursor-pointer place-items-center rounded-md border shadow-sm transition ${selected ? "dsh-checked !opacity-100" : "border-[#d9dbe5] bg-white text-transparent opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"} ${viewMode === "grid" ? "absolute left-2 top-2 size-5" : "library-list-select"}`}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            toggleSelection(item.id);
                          }}
                          title={
                            selected
                              ? uiText("取消选择")
                              : uiText("选择资料")
                          }
                        >
                          <input
                            type="checkbox"
                            aria-label={uiText`选择 ${item.name}`}
                            checked={selected}
                            readOnly
                            onKeyDown={(event) => {
                              if (event.key !== " ") return;
                              event.preventDefault();
                              event.stopPropagation();
                              if (!event.repeat) toggleSelection(item.id);
                            }}
                            className="pointer-events-none sr-only"
                          />
                          <Check size={12} strokeWidth={2.5} aria-hidden="true"/>
                        </label>
                        <div
                          role={
                            renamingItemId === item.id ? undefined : "button"
                          }
                          tabIndex={renamingItemId === item.id ? -1 : 0}
                          onDoubleClick={() => {
                            if (renamingItemId !== item.id) void open(item);
                          }}
                          onClick={(event) => {
                            if (renamingItemId === item.id) return;
                            if (
                              event.ctrlKey ||
                              event.metaKey ||
                              event.shiftKey ||
                              selectedItemIdsRef.current.size
                            )
                              toggleSelection(item.id);
                            else if (isFolder(item)) void open(item);
                            else void showPreview(item);
                          }}
                          onKeyDown={(event) => {
                            if (
                              renamingItemId === item.id ||
                              (event.key !== "Enter" && event.key !== " ")
                            )
                              return;
                            event.preventDefault();
                            if (selectedItemIdsRef.current.size)
                              toggleSelection(item.id);
                            else if (isFolder(item)) void open(item);
                            else void showPreview(item);
                          }}
                            className={`h-full min-w-0 w-full max-w-full cursor-pointer overflow-hidden text-left outline-none ${viewMode === "grid" ? "library-grid-entry" : "library-list-row-content"}`}
                        >
                          <ResourceFileIcon item={item} previewItem={item} size={viewMode === "grid" ? 40 : 32}
                            title={item.kind === "local_file" ? (nativeFileDrag ? uiText("拖到文件夹、DSH 对话或其他应用") : uiText("拖动到文件夹或 DSH 对话；按住 Alt 拖到其他应用")) : undefined}
                            className={`${viewMode === "list" ? "library-list-icon" : ""} ${iconStyle ? "library-folder-icon-colored" : ""}`}
                            style={iconStyle}
                          >
                            {thumbnailUrl &&
                            ["image", "video"].includes(
                              resourceFileCategory(item),
                            ) ? (
                              <img
                                src={thumbnailUrl}
                                loading="lazy"
                                decoding="async"
                                alt=""
                                onLoad={(event) =>
                                  void repairBlankStoredThumbnail(
                                    item,
                                    event.currentTarget,
                                  )
                                }
                                draggable={false} className="size-full object-cover"
                              />
                            ) : null}
                          </ResourceFileIcon>
                          <span
                            className={`min-w-0 max-w-full overflow-hidden ${viewMode === "grid" ? "library-grid-info" : "library-list-name-column flex flex-col"}`}
                          >
                            {renamingItemId === item.id ? (
                              <input
                                ref={renameElementRef}
                                aria-label={uiText`重命名 ${item.name}`}
                                value={renameDraft}
                                draggable={false}
                                onPointerDownCapture={(event) =>
                                  event.stopPropagation()
                                }
                                onMouseDown={(event) =>
                                  event.stopPropagation()
                                }
                                onClick={(event) => event.stopPropagation()}
                                onDoubleClick={(event) =>
                                  event.stopPropagation()
                                }
                                onChange={(event) =>
                                  setRenameDraft(event.currentTarget.value)
                                }
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    event.currentTarget.blur();
                                  } else if (event.key === "Escape") {
                                    event.preventDefault();
                                    setRenamingItemId("");
                                    setRenameDraft("");
                                  }
                                }}
                                onBlur={() => void commitInlineRename(item)}
                                className={`${viewMode === "grid" ? "mt-2" : ""} block w-full min-w-0 rounded-md border border-[#716acd] bg-white px-1 text-[0.8125rem] font-bold text-[#2b3045] outline-none ring-2 ring-[#716acd]/15`}
                              />
                            ) : (
                              <b
                                data-resource-name
                                title={item.name}
                                className={`${viewMode === "grid" ? "mt-2 w-full" : "w-fit"} block min-w-0 max-w-full truncate whitespace-nowrap text-[0.8125rem] text-[#2b3045]`}
                              >
                                {item.name}
                              </b>
                            )}
                            {viewMode === "grid" ? (
                              <span className="library-grid-type">
                                {resourceTypeLabel(item)}
                              </span>
                            ) : null}
                            {indexStatus &&
                            (indexStatus.status === "queued" ||
                              indexStatus.status === "indexing") ? (
                              <span
                                className="mt-2 w-full"
                                aria-label={uiText`文件夹索引进度 ${item.name}`}
                              >
                                <span className="flex items-center justify-between text-[0.5625rem] font-bold text-[#7068c5]">
                                  <span>
                                    {indexStatus.phase === "scanning"
                                      ? uiText("扫描中")
                                      : uiText("映射中")}
                                  </span>
                                  <span>
                                    {indexStatus.total
                                      ? `${indexProgress}%`
                                      : "…"}
                                  </span>
                                </span>
                                <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-[#e8e8f3]">
                                  <span
                                    className="block h-full rounded-full bg-[#716acd] transition-[width] duration-300"
                                    style={{
                                      width: `${indexStatus.total ? indexProgress : 18}%`,
                                    }}
                                  />
                                </span>
                              </span>
                            ) : null}
                            {indexStatus?.status === "error" ? (
                              <span
                                className="mt-2 block w-full truncate text-[0.5625rem] font-bold text-[#bd5570]"
                                title={indexStatus.error}
                              >{uiText("索引失败，可重试")}</span>
                            ) : null}
                            {item.tags.length ? (
                              <span className="mt-1 flex max-h-5 max-w-full shrink-0 items-center gap-1 overflow-hidden pb-0.5">
                                {resourceTagLabels(item.tags)
                                  .slice(0, viewMode === "grid" ? 2 : 4)
                                  .map((tag) => (
                                    <span
                                      key={tag}
                                      className="library-resource-tag truncate rounded-full bg-[#eeedff] px-2 py-0.5 text-[0.5625rem] font-bold leading-4 text-[#6760c2]"
                                      title={tag}
                                    >
                                      {tag}
                                    </span>
                                  ))}
                              </span>
                            ) : null}
                          </span>
                          {viewMode === "list" ? (
                            <span
                              className="library-list-type-column min-w-0 truncate"
                              title={resourceTypeLabel(item)}
                            >
                              {resourceTypeLabel(item)}
                            </span>
                          ) : null}
                          {viewMode === "list" ? (
                            <span
                              data-resource-path
                              className="library-list-path-column min-w-0 max-w-full truncate whitespace-nowrap"
                              title={item.target || uiText("无本地或在线路径")}
                            >
                              {item.target || "—"}
                            </span>
                          ) : null}
                          {viewMode === "grid" ? <span className="library-grid-dates">
                            <span className="truncate">{uiText("修改")}{" "}
                              {formatResourceTime(
                                item.fileModifiedAt ?? item.fileCreatedAt,
                              )}
                            </span>
                            <span className="truncate">{uiText("添加")}{" "}{formatResourceTime(item.createdAt)}
                            </span>
                          </span> : <>
                            <time data-resource-modified className="library-list-modified-column truncate" dateTime={item.fileModifiedAt ?? item.fileCreatedAt ?? undefined} title={formatResourceTime(item.fileModifiedAt ?? item.fileCreatedAt)}>
                              {formatResourceTime(item.fileModifiedAt ?? item.fileCreatedAt)}
                            </time>
                            <time data-resource-added className="library-list-added-column truncate" dateTime={item.createdAt} title={formatResourceTime(item.createdAt)}>
                              {formatResourceTime(item.createdAt)}
                            </time>
                          </>}
                        </div>
                        <div
                          className={viewMode === "list" ? "library-list-actions" : "contents"}
                        >
                          {item.kind === "local_file" && !busy && renamingItemId !== item.id ? (
                            <button type="button" draggable className="library-file-export"
                              aria-label={uiText`拖出文件 ${item.name}`}
                              title={selectedItemIds.has(item.id) && selectedItemIds.size > 1 ? (nativeFileDrag ? uiText("拖出或点击复制所选原文件") : uiText("将所选文件打包拖出为 ZIP，点击复制所选原文件")) : uiText("拖到资源管理器或其他应用，点击复制此文件")}
                              onPointerEnter={() => prepareFileExport(operationItems(item))}
                              onFocus={() => prepareFileExport(operationItems(item))}
                              onDragStart={event => startFileDrag(event, item)}
                              onClick={event => { event.stopPropagation(); void copyActualFile(item); }}>
                              <FileUp size={13} aria-hidden="true" />
                            </button>
                          ) : null}
                          <button
                            type="button"
                            aria-label={uiText`更多操作 ${item.name}`}
                            aria-haspopup="menu"
                            aria-expanded={
                              cardMenuId === item.id &&
                              contextMenu?.item?.id === item.id
                            }
                            onClick={(event) =>
                              showItemMenuAtAnchor(event, item)
                            }
                            className="library-more-action grid size-7 place-items-center transition"
                          >
                            <MoreHorizontal size={15} />
                          </button>
                        </div>
                      </article>
                    );
                  }}
                </LibraryResultWindow>
              </div>
            ) : currentFolderLoading ? null : (
              <div className="library-empty" data-empty-drop={!currentFolderSearchEntries.length || undefined} role="status">
                <div>
                  {currentFolderSearchEntries.length ? <Search size={26} aria-hidden="true"/> : <FolderInput size={28} aria-hidden="true"/>}
                  <b>
                    {currentFolderSearchEntries.length ? uiText("没有匹配的资料") : uiText("拖拽内容到此处添加到资料库")}
                  </b>
                  <p>
                    {currentFolderSearchEntries.length
                      ? uiText("尝试调整搜索词或标签筛选。")
                      : uiText("支持文件、文件夹和链接，也可点击「添加文件」。")}
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
      {contextMenu ? createPortal(
        <div
          ref={contextMenuRef}
          onKeyDown={navigateMenu}
          role="menu"
          aria-label={
            contextMenu.item
              ? uiText`${contextMenu.item.name} 操作`
              : uiText("资料库空白区域操作")
          }
          className="moki-menu-surface library-menu fixed z-[100] max-h-[calc(100vh-1rem)] w-60 overflow-y-auto p-1.5"
          style={{ left: contextMenu.x, top: contextMenu.y, visibility: "hidden" }}
          onPointerDown={(event) => event.stopPropagation()}
          onPointerOver={(event) => {
            if (folderColorMenu && event.target instanceof Element && !event.target.closest("[data-folder-color-trigger]")) {
              setFolderColorMenu(undefined);
            }
          }}
        >
          {contextMenu.item ? (
            itemMenuItems(contextMenu.item)
          ) : (
            <>
              {createMenuItems()}
              <div role="separator" className="moki-menu-divider" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  startCreate("mapping");
                }}
                className={itemMenuButtonClass}
              >
                <FileUp size={14} />{uiText("添加文件")}</button>
              <button
                type="button"
                role="menuitem"
                onClick={() => void pasteIntoCurrentFolder()}
                className={itemMenuButtonClass}
              >
                <ClipboardPaste size={14} />{uiText("粘贴文件 / 文件夹 / 链接")}</button>
            </>
          )}
        </div>,
        document.body,
      ) : null}
      {contextMenu?.item && folderColorMenu?.itemId === contextMenu.item.id ? createPortal(
        <div
          id="library-folder-color-menu"
          ref={folderColorMenuRef}
          role="menu"
          aria-label={uiText`${contextMenu.item.name} 文件夹颜色`}
          className="moki-menu-surface fixed z-[101] flex w-max items-center gap-2 p-2"
          style={{ left: folderColorMenu.right + 4, top: folderColorMenu.top, visibility: "hidden" }}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            navigateMenu(event);
            if (event.key === "Escape" || event.key === "ArrowLeft") {
              event.preventDefault();
              event.stopPropagation();
              setFolderColorMenu(undefined);
              folderColorTriggerRef.current?.focus();
            }
          }}
        >
          {FOLDER_COLORS.map((color) => (
            <button
              key={color.id}
              type="button"
              role="menuitemradio"
              aria-label={uiText`设置${contextMenu.item!.name}为${color.label}`}
              aria-checked={(contextMenu.item!.folderColor ?? "violet") === color.id}
              title={color.label}
              onClick={() => void setFolderColor(contextMenu.item!, color.id)}
              className="library-folder-color-swatch"
              style={folderPaletteStyle(color)}
            />
          ))}
        </div>,
        document.body,
      ) : null}
      {moveDialogItems.length ? (
        <LibraryDialog titleId="library-move-dialog-title" size="medium" onDismiss={() => setMoveDialogItems([])}>
          <section className="library-dialog-card">
            <header className="moki-dialog-header moki-dialog-header-inset-5 flex items-center justify-between gap-3">
              <div>
                <h2
                  id="library-move-dialog-title"
                  className="text-[1rem] font-black"
                >{uiText("移动到")}</h2>
                <p className="mt-1 text-[0.6875rem] text-[#8b91a3]">{uiText("将选中的")}{moveDialogItems.length}{uiText("项移动到其他资料目录。")}</p>
              </div>
              <button
                type="button"
                aria-label={uiText("关闭移动到")}
                onClick={() => setMoveDialogItems([])}
                className="grid size-8 place-items-center rounded-xl bg-[#f4f5f8]"
              >
                <X size={15} />
              </button>
            </header>
            <div className="library-dialog-body">
              <span>{uiText("目标目录")}</span>
              <div
                role="tree"
                aria-label={uiText("移动目标目录树")}
                className="mt-1.5 max-h-64 overflow-y-auto rounded-2xl border border-[#dedfea] bg-[#fafafe] p-1.5"
              >
                <div
                  role="treeitem"
                  aria-level={1}
                  aria-selected={moveTargetId === ""}
                  className={`flex h-9 items-center rounded-xl px-3 transition ${moveTargetId === "" ? "bg-[#292f47] text-white" : "text-[#565c72] hover:bg-[#f0effa]"}`}
                >
                  <button
                    type="button"
                    onClick={() => setMoveTargetId("")}
                    className="flex h-full min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <FolderTree size={14} className="shrink-0" />
                    <span className="truncate">{uiText("资料库根目录")}</span>
                  </button>
                </div>
                {renderMoveFolderNodes(moveFolderTree)}
              </div>
            </div>
            {message ? (
              <p role="alert" className="mt-3 text-[0.6875rem] text-[#b33c63]">
                {message}
              </p>
            ) : null}
            <footer className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setMoveDialogItems([])}
                className="rounded-xl bg-[#f4f5f8] px-4 py-2 text-[0.75rem] font-bold"
              >{uiText("取消")}</button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void confirmMove()}
                className="rounded-xl bg-[#242a40] px-4 py-2 text-[0.75rem] font-bold text-white disabled:opacity-50"
              >
                {busy ? uiText("移动中...") : uiText("确认移动")}
              </button>
            </footer>
          </section>
        </LibraryDialog>
      ) : null}
      {dialogOpen ? (
        <LibraryDialog titleId="library-dialog-title" onDismiss={resetDialog}>
          <section className="library-dialog-card library-edit-dialog">
            <header className="moki-dialog-header moki-dialog-header-inset-5 flex items-center justify-between">
              <div>
                <h2
                  id="library-dialog-title"
                  className="text-[1rem] font-black"
                >
                  {editingItem
                    ? uiText("编辑资料")
                    : createMode === "folder"
                      ? uiText("添加虚拟文件夹")
                      : createMode === "file"
                        ? uiText("新建文件")
                        : uiText("添加资料映射")}
                </h2>
                <p className="mt-1 text-[0.6875rem] text-[#8b91a3]">
                  {createMode === "file"
                    ? uiText("在当前资料目录创建可立即预览、编辑的真实文件。")
                    : uiText("只保存路径或链接，不上传文件内容。")}
                </p>
              </div>
              <button
                type="button"
                aria-label={uiText("关闭")}
                onClick={resetDialog}
                className="grid size-8 place-items-center rounded-xl bg-[#f4f5f8]"
              >
                <X size={15} />
              </button>
            </header>
            <div className="library-dialog-body">
              {!editingItem && createMode === "mapping" ? (
                <label className="grid gap-1.5 text-[0.6875rem] font-bold">{uiText("映射类型")}<select
                    value={kind}
                    onChange={(event) =>
                      setKind(event.target.value as typeof kind)
                    }
                    className="h-10 rounded-xl border border-[#dedfea] px-3"
                  >
                    <option value="local_file">{uiText("本地文件")}</option>
                    <option value="local_folder">{uiText("本地文件夹")}</option>
                    <option value="url">{uiText("在线文件")}</option>
                  </select>
                </label>
              ) : null}
              {(editingItem?.kind === "local_folder" || !editingItem && createMode === "mapping" && kind === "local_folder") ? <div className="moki-ui-card grid gap-2 p-3" data-surface="inner">
                <label className="grid gap-2 text-sm font-bold">{uiText("DSH 文件夹权限")}<PermissionSelect value={assistantPermission ?? "inherit"} disabled={busy} onChange={event => setAssistantPermission(event.target.value === "inherit" ? null : event.target.value as "read_only" | "write")}>
                    <option value="inherit">{uiText("跟随上级（未授权时只读）")}</option>
                    <option value="read_only">{uiText("只读，操作时请求确认")}</option>
                    <option value="write">{uiText("可写入并操作")}</option>
                  </PermissionSelect>
                </label>
                <p className="moki-ui-muted text-xs leading-5">{uiText("“可写入并操作”允许助手直接创建、修改、移动和删除文件夹内的内容及子文件夹。保存后生效；本地文件夹完全操作权限开启时优先按完全权限执行。")}</p>
              </div> : null}
              {!editingItem && createMode === "file" ? (
                <label className="grid gap-1.5 text-[0.6875rem] font-bold">{uiText("文件类型")}<select
                    value={fileFormat}
                    onChange={(event) =>
                      setFileFormat(event.target.value as typeof fileFormat)
                    }
                    className="h-10 rounded-xl border border-[#dedfea] px-3"
                  >
                    <option value="markdown">Markdown (.md)</option>
                    <option value="csv">{uiText("CSV 表格 (.csv)")}</option>
                    <option value="docx">Word (.docx)</option>
                    <option value="xlsx">Excel (.xlsx)</option>
                    <option value="pptx">PowerPoint (.pptx)</option>
                    <option value="univer">{uiText("Univer 多 Unit (.univer)")}</option>
                  </select>
                </label>
              ) : null}
              {!editingItem && createMode === "file" && fileFormat === "univer" ? (
                <label className="grid gap-1.5 text-[0.6875rem] font-bold">{uiText("初始组件")}<select
                    value={univerUnitKind}
                    onChange={(event) => setUniverUnitKind(event.target.value as typeof univerUnitKind)}
                    className="h-10 rounded-xl border border-[#dedfea] px-3"
                  >
                    <option value="sheet">{uiText("表格")}</option>
                    <option value="doc">{uiText("文档")}</option>
                    <option value="slide">{uiText("幻灯片")}</option>
                    <option value="base">{uiText("Base 数据库")}</option>
                    <option value="board">{uiText("白板")}</option>
                  </select>
                </label>
              ) : null}
              {createMode === "mapping" ||
              (editingItem && editingItem.kind !== "folder") ? (
                <label className="grid gap-1.5 text-[0.6875rem] font-bold">
                  {kind === "url" || editingItem?.kind === "url"
                    ? uiText("在线链接")
                    : uiText("本地路径")}
                  <div className="flex gap-2">
                    <input
                      value={target}
                      onChange={(event) => setTarget(event.target.value)}
                      placeholder={
                        kind === "url"
                          ? "https://example.com/file.pdf"
                          : kind === "local_folder"
                            ? uiText("C:\\Projects\\资料文件夹")
                            : uiText("C:\\Projects\\资料.pdf")
                      }
                      className="h-10 min-w-0 flex-1 rounded-xl border border-[#dedfea] px-3"
                    />
                    {kind === "local_file" && !editingItem ? (
                      <>
                        <input
                          ref={filePickerRef}
                          type="file"
                          className="hidden"
                          onChange={handlePickedFile}
                        />
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              const path = await window.mokiDesktop?.selectLibraryFile?.();
                              if (path) { setKind("local_file"); setTarget(path); }
                            } catch (error) { setMessage(error instanceof Error ? error.message : uiText("文件选择失败")); }
                          }}
                          className="library-pick-path"
                        >
                          <FileUp size={14} />{uiText("选择文件")}</button>
                      </>
                    ) : null}
                    {kind === "local_folder" && !editingItem ? (
                      <button
                        type="button"
                        onClick={() => void handlePickFolder()}
                        className="library-pick-path"
                      >
                        <FolderInput size={14} />{uiText("选择文件夹")}</button>
                    ) : null}
                  </div>
                  {kind === "local_file" ? (
                    <span className="font-normal text-[#999fb0]">{uiText("可粘贴文件的完整路径。")}</span>
                  ) : kind === "local_folder" ? (
                    <span className="font-normal text-[#999fb0]">{uiText("保存后同步映射文件夹内的层级和文件；不会复制或上传文件内容。")}</span>
                  ) : null}
                </label>
              ) : null}
              <label className="grid gap-1.5 text-[0.6875rem] font-bold">{uiText("显示名称")}<input
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={
                    createMode === "file" ? uiText("例如：项目方案") : undefined
                  }
                  className="h-10 rounded-xl border border-[#dedfea] px-3"
                />
              </label>
              {!editingItem && createMode === "folder" ? (
                <fieldset className="grid gap-2" disabled={busy}>
                  <legend className="mb-2 text-[0.6875rem] font-bold">{uiText("文件夹颜色")}</legend>
                  <div className="flex flex-wrap items-center gap-2">
                    {FOLDER_COLORS.map((color) => (
                      <button key={color.id} type="button" aria-label={color.label}
                        aria-pressed={newFolderColor === color.id}
                        title={color.label} onClick={() => setNewFolderColor(color.id)}
                        className="library-folder-color-option library-folder-icon-colored" style={folderPaletteStyle(color)}>
                        <Folder size={18} aria-hidden="true" />
                      </button>
                    ))}
                    <span className="text-xs">{FOLDER_COLORS.find(color => color.id === newFolderColor)?.label}</span>
                  </div>
                </fieldset>
              ) : null}
              {!editingItem && createMode === "file" && fileFormat !== "univer" ? (
                <label className="grid gap-1.5 text-[0.6875rem] font-bold">{uiText("初始内容")}<textarea
                    value={fileContent}
                    onChange={(event) => setFileContent(event.target.value)}
                    rows={7}
                    placeholder={
                      fileFormat === "csv"
                        ? uiText("每行使用逗号分隔；含逗号或换行的单元格请使用双引号")
                        : fileFormat === "xlsx"
                        ? uiText("每行将成为一行单列表格")
                        : fileFormat === "pptx"
                          ? uiText("每行将成为首张幻灯片的一个文本块")
                          : uiText("可留空，创建后继续编辑")
                    }
                    className="resize-y rounded-xl border border-[#dedfea] px-3 py-2 font-mono text-xs leading-6 outline-none focus:border-[#8a83d9]"
                  />
                  <span className="font-normal text-[#999fb0]">{uiText("创建后会自动打开统一预览编辑器。")}</span>
                </label>
              ) : !editingItem && createMode === "file" ? (
                <p className="rounded-xl bg-[#f5f4ff] px-3 py-2 text-[0.6875rem] leading-5 text-[#625bc5]">{uiText("将由官方 Gateway 创建原生工作区；进入编辑器后可继续增加文档、表格、幻灯片、Base 和白板 Unit。")}</p>
              ) : null}
              {editingItem ? (
                <label className="grid gap-1.5 text-[0.6875rem] font-bold">{uiText("所在虚拟目录")}<select
                    value={parentIdDraft}
                    onChange={(event) => setParentIdDraft(event.target.value)}
                    className="h-10 rounded-xl border border-[#dedfea] px-3"
                  >
                    <option value="">{uiText("资料库根目录")}</option>
                    {folderOptions
                      .filter((folder) => folder.id !== editingItem.id)
                      .map((folder) => (
                        <option key={folder.id} value={folder.id}>
                          {folder.name}
                        </option>
                      ))}
                  </select>
                </label>
              ) : null}
              <ResourceTagEditor
                tags={tags}
                draft={tagDraft}
                history={historicalTags}
                onTagsChange={setTags}
                onDraftChange={setTagDraft}
                onDeleteHistory={deleteHistoricalTag}
              />
            </div>
            {message ? (
              <p role="alert" className="mt-3 text-[0.6875rem] text-[#b33c63]">
                {message}
              </p>
            ) : null}
            <footer className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={resetDialog}
                className="rounded-xl bg-[#f4f5f8] px-4 py-2 text-[0.75rem] font-bold"
              >{uiText("取消")}</button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void saveDialog()}
                className="rounded-xl bg-[#242a40] px-4 py-2 text-[0.75rem] font-bold text-white disabled:opacity-50"
              >
                {busy ? uiText("保存中...") : uiText("保存")}
              </button>
            </footer>
          </section>
        </LibraryDialog>
      ) : null}
      {previewItem ? (
        <div className="dsh-file-view"><ResourceLibraryPreviewer
          key={previewItem.id} displayMode="embedded"
          item={previewItem}
          onClose={() => setPreviewItem(undefined)}
          onOpen={(item) => openResourceLibraryItem(item.id)}
          onThumbnail={(item, media) => persistThumbnail(item, media)}
        /></div>
      ) : null}
    </AppShell>
  );
}

import { l as uiText, intlLocale } from '../../../../src/i18n.js';
import {textChange} from '../../../../src/edit-review.js';
import {EditReviewBar,ReviewTextEditor,type TextReview,type ReviewEntry,type ReviewChange} from './edit-review.js';
import {flushSync} from 'react-dom';
import { SpreadsheetPreview } from "./spreadsheet-preview.js";
import {ExtraFilePreview,useFilePreviewInfo} from './resource-extra-preview.js';
import {readPreviewSelection,previewLocation,selectionLabel,capturePreviewVisual,type PreviewSelection,type VisualSnapshot} from './resource-preview-selection.js';
import {PreviewRegionSelection} from './resource-region-selection.js';
import {SelectionChatAction} from './selection-chat-action.js';
import { Button, IconButton } from "./ui-controls.js";
import "./resource-preview-header.css";
import { apiFetch, panelUrl } from "../lib/api-fetch.js";
import "@extend-ai/react-pptx/styles.css";
import powerpointWasmUrl from "@extend-ai/react-pptx/pptx_wasm_bg.wasm?url";
import { applyTextDraftPatches } from '../../shared/text-draft-patch.js';
import {
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  FileText,
  LoaderCircle,
  FileOutput,
  Undo2,
  CircleAlert,
  Minus,
  Move,
  Pause,
  Pencil,
  Play,
  RotateCcw,
  ScanText,
  Scan,
  Save,
  Plus,
  Trash2,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type FocusEvent as ReactFocusEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type WheelEvent } from "react";
import type { ResourceLibraryItem } from "../../shared/resource-library-contract.js";
import { isUniverLibraryImageName } from "../../shared/univer-image-contract.js";
import {
  getResourceLibraryTextContent,
  getResourceLibraryStructuredPreview,
  getResourceLibraryItems,
  insertResourceLibraryUniverImage,
  discardResourceLibraryUniverSession,
  openResourceLibraryUniverSession,
  ResourceLibrarySystemOfficeEditRequiredError,
  recognizeResourceLibraryPdf,
  resourceLibraryPreviewUrl,
  saveResourceLibraryUniverSession,
  saveAsResourceLibraryUniverSession,
  saveResourceLibraryTextContent,
  type ResourceLibraryUniverSession,
  type ResourceLibraryStructuredPreview,
} from "../lib/resource-library-api.js";
import { MarkdownRenderer } from "./markdown-renderer.js";
import { LibraryDialog } from "./library-dialog.js";
import { ResourceLibraryPickerDialog } from "./resource-library-picker-dialog.js";
import { clearWorkbenchSelectionContext, closeMokiEditorAssistance, publishWorkbenchSelectionContext, readWorkbenchSelectionContext, requestMokiAssistance } from "../lib/workbench-selection-context.js";
import { WORKBENCH_DATA_UPDATED_EVENT, type WorkbenchDataUpdatedDetail } from "../lib/workbench-events.js";
import { useWorkspaceEditor } from '../lib/use-workspace-editor.js';
import { exportResourceLibraryItem, saveAsResourceLibraryText } from '../lib/resource-library-api.js';
import type { WorkspaceEditorCommand, WorkspaceEditorResult, WorkspaceEditorState } from '../../shared/workspace-editor-contract.js';

type PreviewKind = "image" | "video" | "audio" | "text" | "embedded" | "web" | "document" | "spreadsheet" | "presentation" | "workspace" | "unsupported" | "extra" | "pending";
type OfficeEditorFocus =
  | { kind: "document"; paragraph: number }
  | { kind: "spreadsheet"; row: number; column: number }
  | { kind: "presentation"; slide: number; paragraph: number };
const PdfPreview=lazy(()=>import('./resource-pdf-preview.js'));

function moveListItem<T>(values: T[], from: number, to: number): void {
  if (from < 0 || from >= values.length || to < 0 || to >= values.length || from === to) return;
  const [value] = values.splice(from, 1);
  if (value !== undefined) values.splice(to, 0, value);
}
import { patchPowerPointWasmPreviewLimits } from '../../shared/powerpoint-preview-limits.js';
export { patchPowerPointWasmPreviewLimits } from '../../shared/powerpoint-preview-limits.js';

let powerPointRuntimePromise: Promise<void> | undefined;

async function configurePowerPointRuntime(module: typeof import("@extend-ai/react-pptx")): Promise<void> {
  powerPointRuntimePromise ??= (async () => {
    const response = await fetch(powerpointWasmUrl);
    if (!response.ok) throw new Error(`PowerPoint parser runtime could not be loaded (${response.status}).`);
    module.setWasmSource(patchPowerPointWasmPreviewLimits(await response.arrayBuffer()));
  })();
  await powerPointRuntimePromise;
}

const PowerPointViewer = lazy<import('react').ComponentType<import('@extend-ai/react-pptx').ReactPptxViewerProps>>(async () => {
  const module = await import("@extend-ai/react-pptx");
  try {
    if (typeof module.setWasmSource === "function") await configurePowerPointRuntime(module);
  } catch (cause) {
    const error = new module.PptxViewerError('parse-failed', uiText("完整预览初始化失败，请重试或调用系统应用打开原稿"), { cause });
    return { default: function FailedPowerPointRuntime(props: import('@extend-ai/react-pptx').ReactPptxViewerProps) {
      useEffect(() => { props.onError?.(error); }, [props.onError]);
      return props.renderError?.(error) ?? <p role="alert">{error.message}</p>;
    } };
  }
  if(typeof module.parsePresentation === 'function') {
    const complete = await import('./powerpoint-complete-viewer.js');
    return { default: complete.PowerPointCompleteViewer };
  }
  return { default: module.ReactPptxViewer };
});
const VIDEO_PREVIEW_FPS = 30;
const VIDEO_VOLUME_STORAGE_KEY = "moki.resource-library.video-volume";
const POWERPOINT_MAX_PREVIEW_BYTES = Number.POSITIVE_INFINITY;

type VideoVolumePreference = {
  volume: number;
  muted: boolean;
};

function readVideoVolumePreference(): VideoVolumePreference {
  if (typeof window === "undefined") return { volume: 1, muted: false };
  try {
    const stored = JSON.parse(window.localStorage.getItem(VIDEO_VOLUME_STORAGE_KEY) ?? "null") as Partial<VideoVolumePreference> | null;
    const volume = Number(stored?.volume);
    if (!Number.isFinite(volume)) return { volume: 1, muted: false };
    return {
      volume: Math.max(0, Math.min(1, volume)),
      muted: Boolean(stored?.muted),
    };
  } catch {
    return { volume: 1, muted: false };
  }
}

function saveVideoVolumePreference(preference: VideoVolumePreference): void {
  try {
    window.localStorage.setItem(VIDEO_VOLUME_STORAGE_KEY, JSON.stringify(preference));
  } catch {
    // Playback still works when storage is unavailable.
  }
}

export function formatVideoPreviewTime(value: number): string {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export function videoPreviewFramePosition(currentTime: number, duration: number): {
  current: number;
  total: number;
} {
  const total = Math.max(1, Math.round(Math.max(0, Number.isFinite(duration) ? duration : 0) * VIDEO_PREVIEW_FPS));
  const current = Math.min(total, Math.max(1, Math.floor(Math.max(0, Number.isFinite(currentTime) ? currentTime : 0) * VIDEO_PREVIEW_FPS) + 1));
  return { current, total };
}

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "log", "json", "html", "htm", "xml", "yaml", "yml",
  "js", "jsx", "ts", "tsx", "css", "scss", "less", "py", "java", "c", "cpp", "h", "hpp", "cs", "go", "rs", "sql", "sh", "ps1",
]);

export function resourcePreviewExtension(item: Pick<ResourceLibraryItem, "name" | "target">): string {
  const source = (item.target ?? item.name).split(/[?#]/u)[0] ?? "";
  return source.match(/\.([^.\\/]+)$/u)?.[1]?.toLowerCase() ?? "";
}

export function enhancedResourcePreviewKind(item: Pick<ResourceLibraryItem, "kind" | "name" | "target">): PreviewKind {
  const extension = resourcePreviewExtension(item);
  if (item.kind === "folder") return "unsupported";
  if (item.kind === "local_folder" && !["key", "pages", "numbers"].includes(extension)) return "unsupported";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "ico"].includes(extension)) return "image";
  if (["mp4", "webm", "m4v", "mov", "ogv"].includes(extension)) return "video";
  if (["mp3", "wav", "flac", "aac", "m4a", "ogg"].includes(extension)) return "audio";
  if (["doc", "docx", "pages"].includes(extension)) return "document";
  if (["xlsx", "csv", "tsv", "numbers"].includes(extension)) return "spreadsheet";
  if (["ppt", "pptx", "key"].includes(extension)) return "presentation";
  if (extension === "univer") return "workspace";
  if (TEXT_EXTENSIONS.has(extension) && item.kind === "local_file") return "text";
  if (["pdf"].includes(extension)) return "embedded";
  if (item.kind === "url") return "web";
  return "unsupported";
}

/**
 * Univer can import/edit the OOXML PowerPoint format (.pptx), but the legacy
 * binary .ppt and .doc formats are preview-only. Keep this capability check in one place
 * so the toolbar and assistant commands cannot open an editor that the server
 * will reject with 415.
 */
export function isOfficeEditorSupportedExtension(extension: string): boolean {
  return ["docx", "xlsx", "csv", "tsv", "pptx", "univer"].includes(extension.toLowerCase());
}

export function onlinePreviewSandbox(
  target: string,
  currentOrigin = typeof window === "undefined" ? "" : window.location.origin,
): string {
  const base = "allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-scripts allow-top-navigation-by-user-activation";
  try {
    return new URL(target, currentOrigin || undefined).origin === currentOrigin
      ? base
      : `${base} allow-same-origin`;
  } catch {
    return base;
  }
}

export function parseDelimitedText(content: string, delimiter: "," | "\t"): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index] ?? "";
    if (character === '"') {
      if (quoted && content[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && content[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (cell || row.length || !rows.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export function serializeDelimitedRows(rows: string[][], delimiter: "," | "\t"): string {
  return rows.map((row) => row.map((cell) => {
    if (!cell.includes(delimiter) && !/["\r\n]/u.test(cell)) return cell;
    return `"${cell.replace(/"/gu, '""')}"`;
  }).join(delimiter)).join("\n");
}

async function copyCanvas(canvas: HTMLCanvasElement): Promise<void> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob || !navigator.clipboard?.write || typeof ClipboardItem === "undefined") throw new Error(uiText("当前环境不支持复制图像"));
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

function presentationSourceUrl(item: ResourceLibraryItem, revision = ""): string {
  const path = item.kind === "local_file"
    ? resourceLibraryPreviewUrl(item)
    : panelUrl(`/api/library/items/${encodeURIComponent(item.id)}/attachment`);
  if (!path) return "";
  if (typeof window === "undefined") return path;
  const url = new URL(path, window.location.origin);
  if (revision) url.searchParams.set("revision", revision);
  return url.toString();
}

const POWERPOINT_THUMBNAIL_ROW_ESTIMATE = 123;

export function synchronizePowerPointThumbnailRail(root: ParentNode | null, slideIndex: number): boolean {
  const filmstrip = root?.querySelector<HTMLElement>(".rpv-filmstrip");
  if (!filmstrip) return false;

  const index = Math.max(0, Math.floor(slideIndex));
  const rowStart = index * POWERPOINT_THUMBNAIL_ROW_ESTIMATE;
  const rowEnd = rowStart + POWERPOINT_THUMBNAIL_ROW_ESTIMATE;
  const viewportHeight = filmstrip.clientHeight;
  let nextScrollTop = filmstrip.scrollTop;

  if (index === 0 || rowStart < nextScrollTop) {
    nextScrollTop = rowStart;
  } else if (viewportHeight > 0 && rowEnd > nextScrollTop + viewportHeight) {
    nextScrollTop = Math.max(0, rowEnd - viewportHeight);
  }

  if (Math.abs(filmstrip.scrollTop - nextScrollTop) > 0.5) {
    filmstrip.scrollTop = nextScrollTop;
  }

  // The thumbnail rail is virtualized. A newly mounted rail can keep the
  // virtualizer's old offset even though the DOM scroll position is zero.
  const EventConstructor = filmstrip.ownerDocument.defaultView?.Event ?? Event;
  filmstrip.dispatchEvent(new EventConstructor("scroll"));
  return true;
}

function StructuredPresentationSlides({
  preview,
}: {
  preview: Extract<ResourceLibraryStructuredPreview, { kind: "presentation" }>;
}) {
  return <div className="library-slide-overview grid size-full gap-4 overflow-auto p-5 md:grid-cols-2">
    {preview.slides.map((slide) => <article key={slide.number} data-moki-location={JSON.stringify({kind:"slide",page:slide.number})} className="relative aspect-video overflow-auto rounded-lg bg-white p-8 shadow-sm">
      <span className="absolute bottom-2 right-3 text-[0.625rem] font-bold text-[#a0a5b5]">{slide.number}</span>
      {slide.paragraphs.map((paragraph, index) => <p key={index} className={`${index === 0 ? "mb-5 text-xl font-black" : "mb-3 text-sm leading-6"} text-[#30364b]`}>{paragraph}</p>)}
    </article>)}
  </div>;
}

type Props = {
  item: ResourceLibraryItem;
  onClose: () => void;
  onOpen: (item: ResourceLibraryItem) => void | Promise<void>;
  onThumbnail?: (item: ResourceLibraryItem, media: HTMLImageElement | HTMLVideoElement) => void | boolean | Promise<void | boolean>;
  layerClassName?: string;
  displayMode?: "modal" | "embedded";
  contained?: boolean;
  headerActions?: import("react").ReactNode;
  resumeOffice?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  active?: boolean;
  onCheckpointReady?: (checkpoint: (() => Promise<void>) | undefined) => void;
  onCloseRequestReady?: (requestClose: (() => void) | undefined) => void;
};
type UniverImageSelection =
  | { kind: "slide"; unitId: string; slideId: string; page?: number; slideName?: string; selectedElementIds?: string[]; elements?: {id:string;name:string;type:string;transform?:Record<string,number>;text:string}[]; selectedText?: string; truncated?: boolean; textSelection?: {elementId:string;startOffset:number;endOffset:number;segmentId:string;collapsed:boolean;indexUnit:'utf16';scope:'shape-text'} }
  | { kind: "document"; unitId: string; startOffset: number; endOffset: number; segmentId: string; selectedText?: string; collapsed?: boolean; page?: number; line?: number }
  | { kind: "sheet"; unitId: string; sheetId: string; sheetName?: string; range?: string; ranges?: string[]; row: number; column: number; endRow?: number; endColumn?: number; selectedText?:string; values?:unknown[][]; formulas?:unknown[][]; truncated?:boolean }
  | { kind: "board"; unitId: string; pageId: string };

export function normalizeUniverImageSelection(value: unknown): UniverImageSelection | undefined {
  if (!value || typeof value !== "object") return undefined;
  const selection = value as Record<string, unknown>;
  if (typeof selection.unitId !== "string" || !selection.unitId) return undefined;
  if (selection.kind === "slide" && typeof selection.slideId === "string" && selection.slideId) {
    const elements = Array.isArray(selection.elements) ? selection.elements.slice(0,25).filter(value => value && typeof value.id === 'string').map(value => ({
      id:value.id, name:typeof value.name==='string'?value.name.slice(0,256):'', type:typeof value.type==='string'?value.type:'',
      text:typeof value.text==='string'?value.text.slice(0,8000):'',
      transform:value.transform&&typeof value.transform==='object'?Object.fromEntries(['left','top','width','height','rotation'].filter(key=>Number.isFinite(value.transform[key])).map(key=>[key,Number(value.transform[key])])):undefined,
    })) : [];
    const range = selection.textSelection as Record<string,unknown>|undefined;
    return { kind: "slide", unitId: selection.unitId, slideId: selection.slideId,
      page:Number.isInteger(selection.page)&&Number(selection.page)>0?Number(selection.page):undefined,
      slideName:typeof selection.slideName==='string'?selection.slideName.slice(0,256):undefined,
      elements,selectedElementIds:elements.map(element=>element.id),
      selectedText:typeof selection.selectedText==='string'?selection.selectedText.slice(0,8000):undefined,truncated:selection.truncated===true,
      textSelection:range&&typeof range.elementId==='string'&&elements.some(element=>element.id===range.elementId)&&Number.isInteger(range.startOffset)&&Number(range.startOffset)>=0&&Number.isInteger(range.endOffset)&&Number(range.endOffset)>=Number(range.startOffset)
        ?{elementId:range.elementId,startOffset:Number(range.startOffset),endOffset:Number(range.endOffset),segmentId:typeof range.segmentId==='string'?range.segmentId:'',collapsed:range.startOffset===range.endOffset,indexUnit:'utf16',scope:'shape-text'}:undefined,
    };
  }
  if (selection.kind === "document"
    && Number.isInteger(selection.startOffset)
    && Number.isInteger(selection.endOffset)
    && Number(selection.startOffset) >= 0
    && Number(selection.endOffset) >= 0
    && typeof selection.segmentId === "string") {
    return {
      kind: "document",
      unitId: selection.unitId,
      startOffset: Number(selection.startOffset),
      endOffset: Number(selection.endOffset),
      segmentId: selection.segmentId,
      selectedText: typeof selection.selectedText === "string" ? selection.selectedText.slice(0, 8000) : undefined,
      collapsed: selection.startOffset === selection.endOffset,
      page: typeof selection.page === "number" ? selection.page : undefined,
      line: typeof selection.line === "number" ? selection.line : undefined,
    };
  }
  if (selection.kind === "sheet"
    && typeof selection.sheetId === "string"
    && selection.sheetId
    && Number.isInteger(selection.row)
    && Number.isInteger(selection.column)
    && Number(selection.row) >= 0
    && Number(selection.column) >= 0) {
    return {
      kind: "sheet",
      unitId: selection.unitId,
      sheetId: selection.sheetId,
      row: Number(selection.row),
      column: Number(selection.column),
      sheetName: typeof selection.sheetName === "string" ? selection.sheetName : undefined,
      range: typeof selection.range === "string" ? selection.range : undefined,
      ranges: Array.isArray(selection.ranges) ? selection.ranges.filter((range): range is string => typeof range === "string") : undefined,
      endRow: Number.isInteger(selection.endRow) ? Number(selection.endRow) : undefined,
      endColumn: Number.isInteger(selection.endColumn) ? Number(selection.endColumn) : undefined,
      selectedText:typeof selection.selectedText==='string'?selection.selectedText.slice(0,8000):undefined,
      values:Array.isArray(selection.values)?selection.values.slice(0,50).filter(Array.isArray).map(row=>row.slice(0,20)):undefined,
      formulas:Array.isArray(selection.formulas)?selection.formulas.slice(0,50).filter(Array.isArray).map(row=>row.slice(0,20)):undefined,
      truncated:selection.truncated===true,
    };
  }
  if (selection.kind === "board") {
    return {
      kind: "board",
      unitId: selection.unitId,
      pageId: typeof selection.pageId === "string" ? selection.pageId : "",
    };
  }
  return undefined;
}

export function isUniverInsertableLibraryImage(item: ResourceLibraryItem): boolean {
  if (item.kind !== "local_file") return false;
  return isUniverLibraryImageName(item.target || item.name);
}

type EditorExitIntent = "close" | "cancel";

function editableCaretPosition(element: HTMLInputElement | HTMLTextAreaElement): { x: number; y: number } {
  const bounds = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  const mirror = document.createElement("div");
  const marker = document.createElement("span");
  const properties = [
    "fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing", "lineHeight",
    "textTransform", "textIndent", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "boxSizing",
  ] as const;
  Object.assign(mirror.style, {
    position: "fixed",
    visibility: "hidden",
    pointerEvents: "none",
    left: `${bounds.left}px`,
    top: `${bounds.top}px`,
    width: `${bounds.width}px`,
    minHeight: `${bounds.height}px`,
    whiteSpace: element instanceof HTMLInputElement ? "pre" : "pre-wrap",
    overflowWrap: "break-word",
  });
  for (const property of properties) mirror.style[property] = style[property];
  mirror.textContent = element.value.slice(0, element.selectionStart ?? element.value.length);
  marker.textContent = "\u200b";
  mirror.append(marker);
  document.body.append(mirror);
  const markerBounds = marker.getBoundingClientRect();
  mirror.remove();
  const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.4 || 20;
  const measuredX = markerBounds.left || bounds.left + Number.parseFloat(style.paddingLeft || "0");
  const measuredY = markerBounds.bottom || bounds.top + Number.parseFloat(style.paddingTop || "0") + lineHeight;
  return {
    x: Math.max(12, Math.min(window.innerWidth - 340, measuredX - element.scrollLeft)),
    y: Math.max(12, Math.min(window.innerHeight - 96, measuredY - element.scrollTop + 8)),
  };
}

function contentEditableCaretPosition(element: HTMLElement): { x: number; y: number } {
  const selection = window.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : undefined;
  const caret = range && typeof range.getBoundingClientRect === "function" ? range.getBoundingClientRect() : undefined;
  const bounds = element.getBoundingClientRect();
  const x = caret && (caret.width || caret.height) ? caret.right : bounds.left + Math.min(80, bounds.width / 2);
  const y = caret && (caret.width || caret.height) ? caret.bottom : bounds.top + Math.min(80, bounds.height / 2);
  return { x: Math.round(x), y: Math.round(y) };
}

export function ResourceLibraryPreviewer({ item, onClose, onOpen, onThumbnail, layerClassName = "z-[80]", displayMode = "modal", contained = false, onDirtyChange, active = true, onCheckpointReady, onCloseRequestReady, headerActions, resumeOffice }: Props) {
  const fileState=useFilePreviewInfo(item),info=fileState?.info;
  const [compatibleMedia,setCompatibleMedia]=useState(false);
  const extension = info?.extension ?? resourcePreviewExtension(item);
  const originalKind = enhancedResourcePreviewKind(item);
  const kind:PreviewKind = item.kind!=='local_file'?originalKind:!fileState?'pending':
    info?.textPaged || ['archive','model','font','ofd','moki'].includes(info?.kind??'')?'extra':
    info && ['image','video','audio','embedded'].includes(info.kind)?info.kind as PreviewKind:originalKind;
  const previewUrl = compatibleMedia ? panelUrl(`/api/library/items/${item.id}/preview-media`) : info?.converted ? panelUrl(`/api/library/items/${item.id}/preview-image`) : resourceLibraryPreviewUrl(item);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [textContent, setTextContent] = useState("");
  const [textSourceVersion, setTextSourceVersion] = useState<string>();
  const [savedTextContent, setSavedTextContent] = useState("");
  const [editingText, setEditingText] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [exitIntent, setExitIntent] = useState<EditorExitIntent>();
  const textDraftActiveRef = useRef(false);
  textDraftActiveRef.current = editingText || dirty;
  const [textHistory, setTextHistory] = useState<{undo:string[];redo:string[]}>({undo:[],redo:[]});
  const [textReviews,setTextReviews]=useState<TextReview[]>([]);
  const textReviewSequence=useRef(0);
  const [officeReviews,setOfficeReviews]=useState<ReviewEntry[]>([]);
  const [officeReviewHighlights,setOfficeReviewHighlights]=useState<ReviewChange[]>([]);
  const [reviewPreparing,setReviewPreparing]=useState(false);
  const [officeReviewLocked,setOfficeReviewLocked]=useState(false);
  const [reviewRemoteBusy,setReviewRemoteBusy]=useState(false);
  const [reviewResolving,setReviewResolving]=useState(false);
  const pendingReviews=textReviews.length+officeReviews.length;
  const reviewBusy=reviewPreparing||reviewRemoteBusy||reviewResolving;
  const reviewEntries:ReviewEntry[]=editingText?textReviews.map((entry,index)=>{
    const change=textChange(entry.before,textReviews[index+1]?.before??textContent);
    return {...entry,changes:change?[change]:[],count:change?1:0};
  }):officeReviews;
  const embedded = displayMode === "embedded";
  const onDirtyChangeRef = useRef(onDirtyChange);
  onDirtyChangeRef.current = onDirtyChange;
  const [renderedTextPreview, setRenderedTextPreview] = useState(["md", "markdown", "html", "htm", "json"].includes(extension));
  const [structuredPreview, setStructuredPreview] = useState<ResourceLibraryStructuredPreview>();
  const [savedStructuredPreview, setSavedStructuredPreview] = useState<ResourceLibraryStructuredPreview>();
  const [editingOffice, setEditingOffice] = useState(false);
  const [univerSession, setUniverSession] = useState<ResourceLibraryUniverSession>();
  const [libraryImagePickerOpen, setLibraryImagePickerOpen] = useState(false);
  const [libraryImageItems, setLibraryImageItems] = useState<ResourceLibraryItem[]>([]);
  const [libraryImageLoading, setLibraryImageLoading] = useState(false);
  const [libraryImageError, setLibraryImageError] = useState("");
  const [insertingLibraryImage, setInsertingLibraryImage] = useState(false);
  const libraryImageSelectionRef = useRef<UniverImageSelection | undefined>(undefined);
  const [officeRevision, setOfficeRevision] = useState("");
  const [pdfTextOpen, setPdfTextOpen] = useState(false);
  const [ocrProgress, setOcrProgress] = useState<{ currentPage: number; totalPages: number; phase: "rendering" | "recognizing" }>();
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);
  const [tableMode, setTableMode] = useState(extension === "csv" || extension === "tsv");
  const [imageScale, setImageScale] = useState(1);
  const [imageOffset, setImageOffset] = useState({ x: 0, y: 0 });
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const initialVideoVolumePreference = useMemo(readVideoVolumePreference, []);
  const [videoVolume, setVideoVolume] = useState(initialVideoVolumePreference.volume);
  const [videoMuted, setVideoMuted] = useState(initialVideoVolumePreference.muted);
  const [volumeControlOpen, setVolumeControlOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const imageDragRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | undefined>(undefined);
  const presentationPreviewRef = useRef<HTMLDivElement>(null);
  const [presentationPosition, setPresentationPosition] = useState({ itemId: item.id, slideIndex: 0 });
  const presentationSlideIndex = presentationPosition.itemId === item.id ? presentationPosition.slideIndex : 0;
  const presentationFallbackRequestedRef = useRef(false);
  const mokiAssistancePendingRef = useRef(false);
  const mokiEditorAssistantOpenedRef = useRef(false);
  const univerSessionRef = useRef<ResourceLibraryUniverSession | undefined>(undefined);
  const editorRevision = useRef({ signature: '', value: 0 });
  const editorSignature = JSON.stringify([textContent, editingText, editingOffice, univerSession?.sessionId,textHistory.undo.length,textHistory.redo.length,pendingReviews]);
  if (editorRevision.current.signature !== editorSignature) editorRevision.current = { signature: editorSignature, value: editorRevision.current.value + 1 };
  const officeEditable = kind !== 'pending' && isOfficeEditorSupportedExtension(extension);
  const editorOperations: WorkspaceEditorState['operations'] = loading || saving ? [] : [
    ...(kind === 'text' || officeEditable ? ['edit' as const] : []),
    ...(editingText || editingOffice ? ['save' as const] : []),
    ...(editingText ? ['read_text' as const, 'replace_text' as const, 'replace_range' as const, 'patch_text' as const] : []),
    ...(editingText && textHistory.undo.length ? ['undo' as const] : []),
    ...(editingText && textHistory.redo.length ? ['redo' as const] : []),
    ...(editingText || editingOffice ? ['discard' as const] : []),
    'save_as',
  ];
  useWorkspaceEditor(embedded && item.kind === 'local_file', {
    id: item.id, name: item.name, active, mode: editingOffice ? 'office' : editingText ? 'text' : 'preview',
    sessionId: univerSession?.sessionId, dirty, revision: editorRevision.current.value, operations: editorOperations,reviewCapable:true,pendingReviews,
  }, executeWorkspaceCommand);
  const [autosaveStatus, setAutosaveStatus] = useState('');
  const autosavePending = useRef<Promise<void>>(Promise.resolve());
  const lastTextCheckpoint = useRef('');
  const checkpointState = useRef({textContent,textSourceVersion,editingText,dirty,saving,session:univerSession,review:textReviews});
  checkpointState.current = {textContent,textSourceVersion,editingText,dirty,saving,session:univerSession,review:textReviews};
  async function draftRequest<T extends Record<string,unknown> = Record<string,unknown>>(path:string, method='GET', body?:unknown):Promise<T> {
    const response=await apiFetch(`/api/library/items/${encodeURIComponent(item.id)}/${path}`,{
      method,
      ...(body===undefined ? {} : {headers:{'content-type':'application/json'},body:JSON.stringify(body)}),
      ...(method === 'DELETE' ? {headers:{'x-moki-retryable-write':'true'}} : {}),
    });
    const responseText=await response.text();
    let result:Record<string,unknown>={};
    if(responseText) {
      try { result=JSON.parse(responseText) as Record<string,unknown>; }
      catch { result={error:responseText}; }
    }
    if(!response.ok)throw new Error(typeof result.error === 'string' ? uiText(result.error) : response.statusText || uiText("自动保存草稿失败"));
    return result as T;
  }
  function persistDraft(syncFrame=true): Promise<void> {
    const pending=autosavePending.current.catch(()=>undefined).then(async()=>{
      const current=checkpointState.current;
      if(current.saving) return;
      if(current.session) {
        if(!current.dirty) return;
        if(syncFrame) await prepareOfficeEditorSave(current.session);
        const saved=await draftRequest<{savedAt:string}>(`univer-session/${current.session.sessionId}/checkpoint`,'POST',{});
        setAutosaveStatus(uiText`草稿已自动保存 · ${new Date(saved.savedAt).toLocaleTimeString()}`);
      } else if(current.editingText || current.dirty) {
        const signature=JSON.stringify([current.textContent,current.textSourceVersion,current.review]);
        if(signature===lastTextCheckpoint.current)return;
        const saved=await draftRequest<{savedAt:string}>('draft','PUT',{content:current.textContent,version:current.textSourceVersion,review:current.review});
        lastTextCheckpoint.current=signature;
        setAutosaveStatus(uiText`草稿已自动保存 · ${new Date(saved.savedAt).toLocaleTimeString()}`);
      }
    });
    autosavePending.current=pending;
    return pending.catch(error=>{setAutosaveStatus(uiText`草稿自动保存失败：${error.message}`);throw error;});
  }
  const persistDraftRef=useRef(persistDraft);persistDraftRef.current=persistDraft;
  useEffect(()=>{
    onCheckpointReady?.(()=>persistDraftRef.current());
    const timer=window.setInterval(()=>{void persistDraftRef.current().catch(()=>undefined);},15000);
    return ()=>{window.clearInterval(timer);onCheckpointReady?.(undefined);void persistDraftRef.current(false).catch(()=>undefined);};
  },[item.id]);
  useEffect(()=>{
    if(!editingText && !dirty)return;
    const timer=window.setTimeout(()=>{void persistDraftRef.current().catch(()=>undefined);},1200);
    return ()=>window.clearTimeout(timer);
  },[textContent,editingText,dirty]);

  const discardingSessions = useRef(new Map<string, Promise<unknown>>());
  function discardOfficeSession(session: ResourceLibraryUniverSession): Promise<unknown> {
    const existing = discardingSessions.current.get(session.sessionId);
    if (existing) return existing;
    const pending = discardResourceLibraryUniverSession(session.itemId, session.sessionId).catch((error: unknown) => {
      discardingSessions.current.delete(session.sessionId);
      throw error;
    });
    discardingSessions.current.set(session.sessionId, pending);
    return pending;
  }
  const previewWindowRef = useRef<HTMLElement>(null);
  const selectedPreview = useRef<PreviewSelection>({});
  const [selectingRegion,setSelectingRegion]=useState(false);
  function previewContent(){return previewWindowRef.current?.querySelector<HTMLElement>('.dsh-preview-content')??null}
  function publishPreviewSelection(detail?:PreviewSelection){
    const next=detail??readPreviewSelection(previewContent(),undefined,editingText?textContent:undefined);
    if(next)selectedPreview.current=next;
    const selected=selectedPreview.current;
    const location={...previewLocation(previewContent()),...selected.location};
    const current={
      source:'library' as const,label:uiText`资料库${editingText||univerSession?uiText("编辑"):uiText("预览")}：${item.name}${selectionLabel(location)?' · '+selectionLabel(location):''}`,itemCount:1,
      content:JSON.stringify({file:{id:item.id,name:item.name,type:info?.extension||kind,previewKind:kind},...selected,location,
        mode:univerSession?'office-editor':editingText?'text-editor':'preview',revision:editorRevision.current.value,
        ...(univerSession?{unsavedDraft:{editor:'univer',sessionId:univerSession.sessionId,unitId:univerSession.unitId,kind:univerSession.kind}}:{})})
    };
    publishWorkbenchSelectionContext(current);return current;
  }
  function rememberSnapshot(snapshot:VisualSnapshot){
    const token=crypto.randomUUID();
    window.dispatchEvent(new CustomEvent('moki:preview-snapshot',{detail:{token,data:snapshot.data,mediaType:snapshot.mediaType,width:snapshot.width,height:snapshot.height}}));
    selectedPreview.current={selectedText:null,location:snapshot.location,visual:{token,width:snapshot.width,height:snapshot.height}};
  }
  const selectionPublisher=useRef(publishPreviewSelection);selectionPublisher.current=publishPreviewSelection;
  const officeEditorFrameRef = useRef<HTMLIFrameElement>(null);
  const officeReviewStamp=useRef('');
  async function refreshOfficeReview() {
    const session=univerSessionRef.current;if(!session)return;
    const result=await draftRequest<{entries:ReviewEntry[];highlights:ReviewChange[];busy:boolean;stamp:string;unchanged?:boolean;session:Partial<ResourceLibraryUniverSession>}>(`univer-session/${session.sessionId}/review?after=${officeReviewStamp.current}`);
    if(univerSessionRef.current?.sessionId!==session.sessionId)return;
    if(result.unchanged)return;
    officeReviewStamp.current=result.stamp;
    setOfficeReviews(result.entries);setOfficeReviewHighlights(result.highlights);setReviewRemoteBusy(result.busy);
    if(result.session.viewerUrl!==session.viewerUrl){const next={...session,...result.session};univerSessionRef.current=next;setUniverSession(next);}
    if(result.entries.length)setDirty(true);
    return result;
  }
  const refreshReviewRef=useRef(refreshOfficeReview);refreshReviewRef.current=refreshOfficeReview;
  useEffect(()=>{
    if(!univerSession?.sessionId)return;
    let stopped=false,timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{try{await refreshReviewRef.current()}catch{}if(!stopped)timer=setTimeout(poll,1000);};
    void poll();return()=>{stopped=true;clearTimeout(timer);};
  },[univerSession?.sessionId]);
  function postOfficeReview(locate?:ReviewChange) {
    const frame=officeEditorFrameRef.current;if(!frame?.contentWindow)return;
    frame.contentWindow.postMessage({type:'moki:univer-review',changes:officeReviewHighlights,locate},new URL(frame.src).origin);
  }
  useEffect(()=>{postOfficeReview();},[officeReviewHighlights]);
  async function persistTextReview(content:string,review:TextReview[]) {
    const pending=autosavePending.current.catch(()=>undefined).then(()=>draftRequest('draft','PUT',{content,version:textSourceVersion,review}));
    autosavePending.current=pending.then(()=>undefined);await pending;
    lastTextCheckpoint.current=JSON.stringify([content,textSourceVersion,review]);
  }
  async function resolveEditReview(action:'accept'|'reject',expectedId:string) {
    if(reviewBusy)return;
    setReviewResolving(true);
    try {
      if(editingText) {
        const latest=textReviews.at(-1);if(latest?.id!==expectedId)throw new Error(uiText('待确认版本已变化，请查看最新修改后再操作'));
        const content=action==='reject'?latest.before:textContent;
        const entries=action==='reject'?textReviews.slice(0,-1):[];
        await persistTextReview(content,entries);
        setTextContent(content);setTextReviews(entries);setDirty(content!==savedTextContent);setTextHistory({undo:[],redo:[]});
      } else {
        const session=univerSessionRef.current;if(!session)return;
        await draftRequest(`univer-session/${session.sessionId}/review`,'POST',{action,expectedId});
        await refreshOfficeReview();setOfficeReviewLocked(false);
      }
      setNotice(action==='accept'?uiText('已采纳 AI 修改，可继续编辑或保存'):uiText('已取消最新一次 AI 修改，之前的内容已保留'));
    } catch(error) {setNotice(error instanceof Error?error.message:String(error));}
    finally {setReviewResolving(false);}
  }
  function locateReview(change:ReviewChange) {
    if(univerSession){postOfficeReview(change.kind==='document'?officeReviewHighlights.find(current=>current.unitId===change.unitId&&current.kind==='document')??change:change);return;}
    const textarea=previewWindowRef.current?.querySelector<HTMLTextAreaElement>('.moki-review-text-editor textarea');
    if(textarea){const current=textChange(textReviews[0]?.before??textContent,textContent);const start=textContent.slice(0,current?.start??0).replace(/\r\n?/g,'\n').length,end=textContent.slice(0,current?.end??0).replace(/\r\n?/g,'\n').length;textarea.focus();textarea.setSelectionRange(start,end);textarea.scrollTop=Math.max(0,(textarea.value.slice(0,start).split('\n').length-3)*24);textarea.dispatchEvent(new Event('scroll'));}
  }
  const previewResizeRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    width: number;
    height: number;
  } | undefined>(undefined);
  const [previewSize, setPreviewSize] = useState<{ width: number; height: number }>();
  const [officeEditorFocus, setOfficeEditorFocus] = useState<OfficeEditorFocus>();

  useEffect(() => {
    if (!active || kind !== "presentation" || editingOffice) return;
    const root = presentationPreviewRef.current;
    if (!root) return;
    const synchronize = () => synchronizePowerPointThumbnailRail(root, presentationSlideIndex);
    synchronize();
    const animationFrame = window.requestAnimationFrame(synchronize);
    const delayed = window.setTimeout(synchronize, 120);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.clearTimeout(delayed);
    };
  }, [active, editingOffice, item.id, item.updatedAt, kind, officeRevision, presentationSlideIndex]);

  useEffect(() => {
    if(!embedded||!active)return;
    selectedPreview.current={};selectionPublisher.current({});
    let timer:ReturnType<typeof setTimeout>;
    const publish=(event:Event)=>{const target=event.target;clearTimeout(timer);timer=setTimeout(()=>{
      const content=previewContent(),input=document.activeElement;
      if(input instanceof HTMLTextAreaElement&&input.getAttribute('aria-label')===uiText("资料文本编辑器")&&content?.contains(input))selectionPublisher.current();
      else {const selected=readPreviewSelection(content,event.type!=='selectionchange'?target:undefined);if(selected)selectionPublisher.current(selected)}
    },60)};
    const changed=()=>{selectedPreview.current={};selectionPublisher.current({})};
    document.addEventListener('selectionchange',publish);
    previewWindowRef.current?.addEventListener('pointerup',publish);
    previewWindowRef.current?.addEventListener('keyup',publish);
    window.addEventListener('moki:preview-location-changed',changed);
    return()=>{clearTimeout(timer);document.removeEventListener('selectionchange',publish);previewWindowRef.current?.removeEventListener('pointerup',publish);previewWindowRef.current?.removeEventListener('keyup',publish);window.removeEventListener('moki:preview-location-changed',changed);
      const previous=readWorkbenchSelectionContext();try{if(previous&&JSON.parse(previous.content).file?.id===item.id)clearWorkbenchSelectionContext('library')}catch{}
    };
  },[embedded,active,item.id]);
  useEffect(()=>{if(embedded&&active)selectionPublisher.current()},[kind,editingText,textContent,univerSession,activeSheetIndex,presentationSlideIndex]);
  useEffect(() => () => {
    if (mokiEditorAssistantOpenedRef.current) {
      mokiEditorAssistantOpenedRef.current = false;
      closeMokiEditorAssistance();
    }
    const session = univerSessionRef.current;
    if (!session) return;
    univerSessionRef.current = undefined;
    // The checkpoint cleanup preserves this session for recovery; explicit Cancel discards it.
  }, []);

  async function copyText(text: string, successNotice: string) {
    try {
      const desktopCopy = window.mokiDesktop?.copyText;
      if (desktopCopy) {
        if (!await desktopCopy(text)) throw new Error("Desktop clipboard rejected the text");
      } else {
        if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
        await navigator.clipboard.writeText(text);
      }
      setNotice(successNotice);
    } catch {
      setNotice(uiText("当前环境无法访问剪贴板"));
    }
  }

  useEffect(() => {
    setNotice("");
    setCompatibleMedia(false);
    setTextContent("");
    setTextHistory({undo:[],redo:[]});
    setTextReviews([]);setOfficeReviews([]);setOfficeReviewHighlights([]);officeReviewStamp.current='';setOfficeReviewLocked(false);setReviewPreparing(false);setReviewRemoteBusy(false);
    setSavedTextContent("");
    setTextSourceVersion(undefined);
    setEditingText(false);
    setDirty(false);
    setRenderedTextPreview(["md", "markdown", "html", "htm", "json"].includes(extension));
    setStructuredPreview(undefined);
    setSavedStructuredPreview(undefined);
    setEditingOffice(false);
    const previousUniverSession = univerSessionRef.current;
    univerSessionRef.current = undefined;
    setUniverSession(undefined);
    if (previousUniverSession) {
      void discardOfficeSession(previousUniverSession).catch(() => undefined);
    }
    setOfficeRevision("");
    setPdfTextOpen(false);
    setOcrProgress(undefined);
    setActiveSheetIndex(0);
    setTableMode(extension === "csv" || extension === "tsv");
    setImageScale(1);
    setImageOffset({ x: 0, y: 0 });
    setVideoPlaying(false);
    setVideoCurrentTime(0);
    setVideoDuration(0);
    const savedVolume = readVideoVolumePreference();
    setVideoVolume(savedVolume.volume);
    setVideoMuted(savedVolume.muted);
    setVolumeControlOpen(false);
    setPreviewSize(undefined);
    presentationFallbackRequestedRef.current = false;
    if (["document", "spreadsheet"].includes(kind) || extension === "key") {
      let cancelled = false;
      setLoading(true);
      void getResourceLibraryStructuredPreview(item.id)
        .then((result) => {
          if (!cancelled) {
            setStructuredPreview(result);
            setSavedStructuredPreview(result);
            if (extension === "doc") setNotice(uiText("DOC 文本预览：不保留原始分页、图片和复杂排版，原文件不会被修改。"));
            if (result.kind === "spreadsheet") setActiveSheetIndex(Math.max(0, result.sheets.findIndex(sheet => !sheet.layout?.hidden)));
          }
        })
        .catch((error) => { if (!cancelled) setNotice(error instanceof Error ? error.message : uiText("Office 文件预览失败")); })
        .finally(() => { if (!cancelled) setLoading(false); });
      return () => { cancelled = true; };
    }
    if (kind !== "text") return undefined;
    let cancelled = false;
    setLoading(true);
    void getResourceLibraryTextContent(item.id)
      .then((result) => {
        if (cancelled) return;
        setTextContent(result.content);
        setSavedTextContent(result.content);
        setTextSourceVersion(result.version);
        void draftRequest<{draft?:{content:string;version?:string;savedAt?:string;review?:TextReview[]}}>('draft').then(({draft})=>{
          if(cancelled || !draft)return;
          setTextContent(draft.content);setTextSourceVersion(draft.version ?? result.version);
          setTextReviews(draft.review??[]);textReviewSequence.current=Math.max(0,...(draft.review??[]).map(entry=>entry.sequence));
          setEditingText(true);setDirty(draft.content!==result.content);
          setNotice(uiText("已恢复上次自动保存的草稿；原文件未被覆盖"));
        }).catch(error=>{if(!cancelled)setNotice(String(error));});
      })
      .catch((error) => { if (!cancelled) setNotice(error instanceof Error ? error.message : uiText("文本读取失败")); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [extension, item.id, kind]);

  useEffect(() => { onDirtyChangeRef.current?.(dirty); }, [dirty]);
  useEffect(() => () => onDirtyChangeRef.current?.(false), []);

  useEffect(() => {
    let cancelled = false;
    const handleUpdate = (event: Event) => {
      const detail = (event as CustomEvent<WorkbenchDataUpdatedDetail>).detail;
      if ((!mokiAssistancePendingRef.current && !embedded) || detail?.resource !== "resource_library" || detail.itemId !== item.id) return;
      mokiAssistancePendingRef.current = false;
      const activeSession = univerSessionRef.current;
      if (activeSession) {
        setDirty(true);
        setAutosaveStatus("");
        setNotice(uiText("DSH 已更新草稿"));
        return;
      }
      if (kind === "text" && textDraftActiveRef.current) {
        setNotice(uiText("原文件已更新，当前编辑草稿已保留。保存前请核对最新文件，或将草稿另存为。"));
        return;
      }
      setLoading(true);
      if (kind === "text") {
        void getResourceLibraryTextContent(item.id)
          .then((result) => {
            if (cancelled || textDraftActiveRef.current) return;
            setTextContent(result.content);
            setSavedTextContent(result.content);
            setTextSourceVersion(result.version);
            setDirty(false);
            setNotice(uiText("已同步 DSH 的编辑结果"));
          })
          .catch((error) => setNotice(error instanceof Error ? error.message : uiText("DSH 编辑结果同步失败")))
          .finally(() => setLoading(false));
        return;
      }
      void getResourceLibraryStructuredPreview(item.id)
        .then((result) => {
          setStructuredPreview(result);
          setSavedStructuredPreview(structuredClone(result));
          setDirty(false);
          setOfficeRevision(new Date().toISOString());
          setNotice(uiText("已同步 DSH 的编辑结果"));
        })
        .catch((error) => setNotice(error instanceof Error ? error.message : uiText("DSH 编辑结果同步失败")))
        .finally(() => setLoading(false));
    };
    window.addEventListener(WORKBENCH_DATA_UPDATED_EVENT, handleUpdate);
    return () => { cancelled = true; window.removeEventListener(WORKBENCH_DATA_UPDATED_EVENT, handleUpdate); };
  }, [embedded, item.id, kind]);

  function loadPresentationFallback(): void {
    if (!["ppt", "pptx"].includes(extension) || presentationFallbackRequestedRef.current) return;
    presentationFallbackRequestedRef.current = true;
    setLoading(true);
    void getResourceLibraryStructuredPreview(item.id)
      .then((result) => {
        setStructuredPreview(result);
        setSavedStructuredPreview(result);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    const video = videoRef.current;
    if (kind !== "video" || !video) return;
    if (video.volume !== videoVolume) video.volume = videoVolume;
    if (video.muted !== videoMuted) video.muted = videoMuted;
  }, [item.id, kind, videoMuted, videoVolume]);

  const delimiter = extension === "tsv" ? "\t" as const : "," as const;
  const tableRows = useMemo(() => tableMode ? parseDelimitedText(textContent, delimiter) : [], [delimiter, tableMode, textContent]);
  const tableCellCount = tableRows.reduce((total, row) => total + row.length, 0);
  const renderEditableTable = editingText && !pendingReviews && !reviewBusy && tableMode && tableCellCount <= 12_000;
  const renderReadOnlyTable = !editingText && tableMode && tableCellCount <= 12_000;

  async function copySource() {
    await copyText(item.target || previewUrl || item.name, uiText("已复制文件位置"));
  }

  async function copyImageOrFrame(media: HTMLImageElement | HTMLVideoElement | null) {
    if (!media) return void copySource();
    const width = media instanceof HTMLVideoElement ? media.videoWidth : media.naturalWidth;
    const height = media instanceof HTMLVideoElement ? media.videoHeight : media.naturalHeight;
    if (!width || !height) return void copySource();
    try {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d")?.drawImage(media, 0, 0, width, height);
      await copyCanvas(canvas);
      setNotice(media instanceof HTMLVideoElement ? uiText("已复制当前帧") : uiText("已复制图片"));
    } catch {
      await copySource();
    }
  }

  async function openVideoContextMenu(
    event: ReactMouseEvent<HTMLVideoElement>,
  ) {
    event.preventDefault();
    const video = event.currentTarget;
    const showNativeMenu = window.mokiDesktop?.showMediaContextMenu;
    if (!showNativeMenu) {
      await copyImageOrFrame(video);
      return;
    }
    const action = await showNativeMenu({
      canCopyFrame: video.videoWidth > 0 && video.videoHeight > 0,
      hasPath: Boolean(item.target || previewUrl || item.name),
      canOpen: true,
    });
    if (action === "copy-frame") await copyImageOrFrame(video);
    else if (action === "copy-path") await copySource();
    else if (action === "open") await onOpen(item);
  }

  function stepVideo(direction: -1 | 1) {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    const duration = Number.isFinite(video.duration) ? video.duration : Number.POSITIVE_INFINITY;
    video.currentTime = Math.max(0, Math.min(duration, video.currentTime + direction / VIDEO_PREVIEW_FPS));
    setVideoCurrentTime(video.currentTime);
    setVideoPlaying(false);
  }

  function toggleVideoPlayback() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play();
    else video.pause();
  }

  function seekVideo(value: number) {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, Math.min(videoDuration || 0, value));
    setVideoCurrentTime(video.currentTime);
  }

  function changeVideoVolume(value: number) {
    const video = videoRef.current;
    if (!video) return;
    const volume = Math.max(0, Math.min(1, value));
    video.volume = volume;
    video.muted = volume === 0;
    setVideoVolume(volume);
    setVideoMuted(video.muted);
    saveVideoVolumePreference({ volume, muted: video.muted });
  }

  function toggleVideoMuted() {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setVideoMuted(video.muted);
    saveVideoVolumePreference({ volume: video.volume, muted: video.muted });
  }

  useEffect(() => {
    if (kind !== "video") return undefined;
    const handleVideoShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const contentEditableRoot = target?.closest("[contenteditable]");
      const isEditableTarget = target?.isContentEditable
        || Boolean(contentEditableRoot && contentEditableRoot.getAttribute("contenteditable") !== "false")
        || target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement
        || (target instanceof HTMLInputElement && target.type !== "range");
      if (isEditableTarget) return;

      if (event.key === " " || event.code === "Space") {
        if (event.repeat) return;
        event.preventDefault();
        toggleVideoPlayback();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        stepVideo(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        stepVideo(1);
      }
    };
    window.addEventListener("keydown", handleVideoShortcut);
    return () => window.removeEventListener("keydown", handleVideoShortcut);
  }, [item.id, kind]);

  async function saveText(propagate = false) {
    if(pendingReviews||reviewBusy){setNotice(uiText('请先采纳或取消 AI 修改，再保存文件'));if(propagate)throw new Error(uiText('请先采纳或取消 AI 修改，再保存文件'));return;}
    setSaving(true);
    setNotice("");
    try {
      await autosavePending.current.catch(()=>undefined);
      const saved = await saveResourceLibraryTextContent(item.id, textContent, textSourceVersion);
      await draftRequest('draft','DELETE');
      lastTextCheckpoint.current='';
      setAutosaveStatus('');
      checkpointState.current={...checkpointState.current,textContent,editingText:false,dirty:false,saving:false};
      setTextSourceVersion(saved.version);
      setSavedTextContent(textContent);
      setTextHistory({undo:[],redo:[]});
      setDirty(false);
      setEditingText(false);
      finishMokiEditorAssistance();
      setNotice(uiText("已保存到原文件"));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : uiText("文本保存失败"));
      if (propagate) throw error;
    } finally {
      setSaving(false);
    }
  }

  async function startOfficeEditing(propagate = false) {
    if (univerSessionRef.current) return univerSessionRef.current;
    if (!officeEditable) {
      setNotice(extension === "ppt"
        ? uiText("旧版 .ppt 仅支持预览，请另存为 .pptx 后编辑")
        : uiText("当前格式不支持 Office 编辑"));
      if (propagate) throw new Error(uiText("当前格式不支持 Office 编辑"));
      return;
    }
    setNotice("");
    setLoading(true);
    try {
      const session = await openResourceLibraryUniverSession(item.id);
      univerSessionRef.current = session;
      setUniverSession(session);
      setEditingOffice(true);
      setDirty(session.recoveredDraft === true);
      setNotice(session.recoveredDraft ? uiText("正在恢复上次自动保存的草稿…") : uiText("正在打开编辑器…"));
      return session;
    } catch (error) {
      if (error instanceof ResourceLibrarySystemOfficeEditRequiredError) {
        try {
          await onOpen(item);
          setNotice(uiText("内嵌编辑器无法安全载入此文件，已用系统应用打开原文件；请在系统应用中保存修改。"));
          return;
        } catch (openError) {
          setNotice(openError instanceof Error ? openError.message : uiText("系统应用打开失败"));
          if (propagate) throw openError;
          return;
        }
      }
      setNotice(error instanceof Error ? error.message : uiText("编辑器打开失败"));
      if (propagate) throw error;
    } finally {
      setLoading(false);
    }
  }

  async function cancelOfficeEditing(propagate = false) {
    const session = univerSessionRef.current;
    if (!session) return;
    setSaving(true);
    try {
      await discardOfficeSession(session);
      univerSessionRef.current = undefined;
      setUniverSession(undefined);
      setOfficeReviews([]);setOfficeReviewLocked(false);
      setStructuredPreview(savedStructuredPreview ? structuredClone(savedStructuredPreview) : undefined);
      setEditingOffice(false);
      finishMokiEditorAssistance();
      setDirty(false);
      setNotice(uiText("已放弃草稿，原文件没有被修改"));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : uiText("草稿放弃失败"));
      if (propagate) throw error;
    } finally {
      setSaving(false);
    }
  }

  function changeOfficePreview(updater: (current: Exclude<ResourceLibraryStructuredPreview, { kind: "pdf" }>) => Exclude<ResourceLibraryStructuredPreview, { kind: "pdf" }>) {
    setStructuredPreview((current) => {
      if (!current || current.kind === "pdf") return current;
      return updater(structuredClone(current));
    });
    setDirty(true);
  }

  async function prepareOfficeEditorSave(session: ResourceLibraryUniverSession): Promise<void> {
    const frame = officeEditorFrameRef.current;
    const target = frame?.contentWindow;
    if (!frame || !target) throw new Error(uiText("Office 编辑器尚未就绪，无法同步保存"));
    const expectedOrigin = new URL(session.viewerUrl, window.location.href).origin;
    const requestId = `save-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const synced = await new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (value: boolean) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        window.removeEventListener("message", handleMessage);
        resolve(value);
      };
      const handleMessage = (event: MessageEvent) => {
        if (event.source !== target || event.origin !== expectedOrigin) return;
        const payload = event.data as Record<string, unknown> | null;
        if (payload?.type !== "moki:univer-save-ready" || payload.requestId !== requestId) return;
        finish(payload.synced === true);
      };
      const timeout = window.setTimeout(() => finish(false), 10_000);
      window.addEventListener("message", handleMessage);
      target.postMessage({ type: "moki:univer-prepare-save", requestId }, expectedOrigin);
    });
    if (!synced) throw new Error(uiText("编辑内容仍在同步，请稍后再次保存"));
  }

  async function readUniverEditorSelection(session: ResourceLibraryUniverSession): Promise<UniverImageSelection | undefined> {
    const frame = officeEditorFrameRef.current;
    const target = frame?.contentWindow;
    if (!target) throw new Error(uiText("Office 编辑器尚未就绪"));
    const expectedOrigin = new URL(session.viewerUrl, window.location.href).origin;
    const requestId = `selection-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value?: UniverImageSelection) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        window.removeEventListener("message", handleMessage);
        resolve(value);
      };
      const handleMessage = (event: MessageEvent) => {
        if (event.source !== target || event.origin !== expectedOrigin) return;
        const payload = event.data as Record<string, unknown> | null;
        if (payload?.type !== "moki:univer-selection-response" || payload.requestId !== requestId) return;
        finish(normalizeUniverImageSelection(payload.selection));
      };
      const timeout = window.setTimeout(() => finish(), 2_000);
      window.addEventListener("message", handleMessage);
      target.postMessage({ type: "moki:univer-selection-request", requestId }, expectedOrigin);
    });
  }

  function syncOfficeTheme() {
    const frame = officeEditorFrameRef.current;
    if (!frame?.contentWindow) return;
    const root = document.documentElement;
    const style = getComputedStyle(root);
    const tokens = {surface:"bg-base",toolbar:"bg-layer-1",border:"border-l2",label:"label-primary",popover:"button-floating-fill",hover:"interactive-bg-hover"};
    const colors = Object.fromEntries(Object.entries(tokens).map(([key,token])=>[key,style.getPropertyValue("--dsw-alias-"+token).trim()]));
    frame.contentWindow.postMessage({type:"moki:univer-theme",dark:root.dataset.colorScheme === "dark",colors,locale:root.lang}, new URL(frame.src).origin);
  }
  const officeViewerUrl = useMemo(() => {
    if (!univerSession?.viewerUrl) return undefined;
    const url = new URL(univerSession.viewerUrl, window.location.href);
    url.searchParams.set("lang", intlLocale());
    if(officeReviews.length||officeReviewLocked)url.searchParams.set('editable','false');
    return url.href;
  }, [univerSession?.viewerUrl,Boolean(officeReviews.length||officeReviewLocked)]);
  useEffect(() => {
    if (!univerSession?.viewerUrl) return;
    const observer = new MutationObserver(syncOfficeTheme);
    observer.observe(document.documentElement,{attributes:true,attributeFilter:["data-color-scheme","style"]});
    syncOfficeTheme();
    return () => observer.disconnect();
  }, [univerSession?.viewerUrl]);

  async function openLibraryImagePicker(selection?: UniverImageSelection) {
    libraryImageSelectionRef.current = selection;
    setLibraryImagePickerOpen(true);
    setLibraryImageLoading(true);
    setLibraryImageError("");
    try {
      setLibraryImageItems(await getResourceLibraryItems());
    } catch (error) {
      setLibraryImageError(error instanceof Error ? error.message : uiText("资料库加载失败"));
    } finally {
      setLibraryImageLoading(false);
    }
  }

  async function insertLibraryImage(items: ResourceLibraryItem[]) {
    const image = items[0];
    const session = univerSessionRef.current;
    if (!image || !session) return;
    setLibraryImagePickerOpen(false);
    setInsertingLibraryImage(true);
    setNotice("");
    try {
      const selection = libraryImageSelectionRef.current ?? await readUniverEditorSelection(session);
      if (!selection?.unitId) throw new Error(uiText("无法确认当前编辑位置，请先在编辑器中点选插入位置后重试"));
      const selectionKind = selection.kind;
      const target = selection.kind === "slide"
        ? { unitId: selection.unitId, slideId: selection.slideId }
        : selection.kind === "document"
          ? { unitId: selection.unitId, startOffset: selection.startOffset, endOffset: selection.endOffset, segmentId: selection.segmentId }
          : selection.kind === "sheet"
            ? { unitId: selection.unitId, sheetId: selection.sheetId, row: selection.row, column: selection.column }
            : { unitId: selection.unitId };
      const result = await insertResourceLibraryUniverImage(item.id, session.sessionId, {
        imageId: image.id,
        ...target,
      });
      setDirty(true);
      setAutosaveStatus("");
      setNotice(result.optimization?.optimized
        ? uiText`已将“${result.image.name}”优化为 ${result.optimization.embeddedFormat.toUpperCase()} 并插入当前${selectionKind === "slide" ? uiText("幻灯片") : selectionKind === "sheet" ? uiText("工作表") : selectionKind === "document" ? uiText("文档") : uiText("白板")}`
        : uiText`已将“${result.image.name}”插入当前${selectionKind === "slide" ? uiText("幻灯片") : selectionKind === "sheet" ? uiText("工作表") : selectionKind === "document" ? uiText("文档") : uiText("白板")}，可继续调整位置和大小`);
      void persistDraftRef.current(false).catch(() => undefined);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : uiText("资料库图片插入失败"));
    } finally {
      setInsertingLibraryImage(false);
      libraryImageSelectionRef.current = undefined;
    }
  }

  async function saveOffice(propagate = false) {
    if(pendingReviews||reviewBusy){setNotice(uiText('请先采纳或取消 AI 修改，再保存文件'));if(propagate)throw new Error(uiText('请先采纳或取消 AI 修改，再保存文件'));return;}
    const session = univerSessionRef.current;
    if (!session) return;
    setSaving(true);
    setNotice("");
    try {
      await prepareOfficeEditorSave(session);
      const result = await saveResourceLibraryUniverSession(item.id, session.sessionId);
      univerSessionRef.current = undefined;
      setUniverSession(undefined);
      setEditingOffice(false);
      finishMokiEditorAssistance();
      setDirty(false);
      setOfficeRevision(result.updatedAt);
      setNotice(kind === "workspace" ? uiText("已确认合并 Univer 草稿，并原子保存到原生工作区文件") : uiText("已确认合并 Univer 草稿，并原子保存到原 Office 文件"));
      // The save response is authoritative. Rebuilding the read-only preview
      // can take much longer for rich Word files, so it must not keep the Save
      // button spinning after the source file has already been written.
      if (kind !== "workspace") {
        void getResourceLibraryStructuredPreview(item.id).then((preview) => {
          setStructuredPreview(preview);
          setSavedStructuredPreview(structuredClone(preview));
        }).catch(() => undefined);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : uiText("文件保存失败"));
      if (propagate) throw error;
    } finally {
      setSaving(false);
    }
  }

  async function saveOfficeAs(destinationOverride?: string, propagate = false) {
    if(pendingReviews||reviewBusy){setNotice(uiText('请先采纳或取消 AI 修改，再保存文件'));if(propagate)throw new Error(uiText('请先采纳或取消 AI 修改，再保存文件'));return;}
    const session = univerSessionRef.current;
    if (!session) return;
    const selectSavePath = window.mokiDesktop?.selectSavePath;
    const destination = destinationOverride ?? (selectSavePath ? await selectSavePath(item.name) : undefined);
    if (selectSavePath && !destination) return { cancelled: true as const };
    if (destination && sameSourcePath(destination)) {
      setNotice(uiText("另存为不能覆盖原文件，请选择其他路径"));
      if (propagate) throw new Error(uiText("另存为不能覆盖原文件"));
      return;
    }
    setSaving(true);
    setNotice("");
    try {
      await prepareOfficeEditorSave(session);
      const result = await saveAsResourceLibraryUniverSession(item.id, session.sessionId, item.name, destination ?? undefined);
      univerSessionRef.current = undefined;
      setUniverSession(undefined);
      setOfficeReviews([]);setOfficeReviewLocked(false);
      setStructuredPreview(savedStructuredPreview ? structuredClone(savedStructuredPreview) : undefined);
      setEditingOffice(false);
      finishMokiEditorAssistance();
      setDirty(false);
      setNotice(result.path ? uiText`已另存为“${result.path}”，原文件未修改` : uiText("已下载当前编辑内容，原文件未修改"));
      return result;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : uiText("文件另存为失败"));
      if (propagate) throw error;
    } finally {
      setSaving(false);
    }
  }

  function sameSourcePath(destination: string) {
    return destination.replace(/\\/gu,'/').toLowerCase() === (item.target ?? '').replace(/\\/gu,'/').toLowerCase();
  }

  function textHistoryStep(operation: 'undo' | 'redo') {
    if(pendingReviews||reviewBusy)throw new Error(uiText('请先在审阅栏采纳或取消 AI 修改'));
    const source = textHistory[operation];
    const previous = source.at(-1);
    if (previous === undefined) throw new Error(uiText("没有可回退的助手编辑"));
    setTextHistory(operation === 'undo'
      ? {undo:source.slice(0,-1),redo:[...textHistory.redo,textContent]}
      : {undo:[...textHistory.undo,textContent],redo:source.slice(0,-1)});
    setTextContent(previous);setDirty(previous !== savedTextContent);
    setNotice(operation === 'undo' ? uiText("已撤销助手编辑，原文件未修改") : uiText("已重做助手编辑，尚未保存"));
  }

  async function discardTextDraft(propagate = false) {
    setSaving(true);
    try {
      await autosavePending.current.catch(()=>undefined);
      await draftRequest('draft','DELETE');
      lastTextCheckpoint.current='';setAutosaveStatus('');
      checkpointState.current={...checkpointState.current,textContent:savedTextContent,editingText:false,dirty:false,saving:false};
      setTextContent(savedTextContent);setTextHistory({undo:[],redo:[]});
      setTextReviews([]);
      setDirty(false);setEditingText(false);finishMokiEditorAssistance();
      setRenderedTextPreview(['md','markdown','html','htm','json'].includes(extension));
      setNotice(uiText("已放弃草稿，原文件没有被修改"));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : uiText("草稿放弃失败"));
      if (propagate) throw error;
    } finally {
      setSaving(false);
    }
  }

  async function completeEditorExit(action: "save" | "discard") {
    const intent = exitIntent;
    if (!intent || saving) return;
    try {
      if (action === "save") {
        if (editingOffice && univerSessionRef.current) await saveOffice(true);
        else if (editingText) await saveText(true);
      } else if (editingOffice) {
        await cancelOfficeEditing(true);
      } else if (editingText) {
        await discardTextDraft(true);
      }
      setExitIntent(undefined);
      if (intent === "close") onClose();
    } catch {
      // The save/discard routine keeps the error visible and the prompt open.
    }
  }

  async function requestEditorExit(intent: EditorExitIntent) {
    if (saving) return;
    if (dirty) {
      setExitIntent(intent);
      return;
    }
    try {
      if (editingOffice) await cancelOfficeEditing(true);
      else if (editingText) await discardTextDraft(true);
      if (intent === "close") onClose();
    } catch {
      // Keep the editor open when its recoverable draft cannot be cleaned up.
    }
  }
  const requestEditorExitRef = useRef(requestEditorExit);
  useEffect(() => {
    if (resumeOffice && officeEditable) void startOfficeEditing();
  }, [item.id, resumeOffice, officeEditable]);
  requestEditorExitRef.current = requestEditorExit;
  useEffect(() => {
    onCloseRequestReady?.(() => { void requestEditorExitRef.current("close"); });
    return () => onCloseRequestReady?.(undefined);
  }, [item.id, onCloseRequestReady]);

  async function executeWorkspaceCommand(command: WorkspaceEditorCommand): Promise<WorkspaceEditorResult> {
    if(command.operation==='review_control') {
      if(command.phase==='prepare') {
        if(reviewResolving||saving)throw new Error(uiText('正在确认或保存修改，请稍后重试'));
        flushSync(()=>setReviewPreparing(true));
        try {if(univerSessionRef.current)await prepareOfficeEditorSave(univerSessionRef.current);setOfficeReviewLocked(true);}
        catch(error){setReviewPreparing(false);throw error;}
      } else {await refreshOfficeReview();setReviewPreparing(false);setOfficeReviewLocked(false);}
      return {status:'completed',message:'Review state synchronized'};
    }
    if((pendingReviews||reviewBusy)&&['save','save_as','discard','undo','redo'].includes(command.operation))throw new Error(uiText('请先在审阅栏采纳或取消 AI 修改'));
    if (loading || saving) throw new Error(uiText("编辑器正在加载或保存，请稍后重试"));
    if (!editorOperations.includes(command.operation)) throw new Error(uiText("当前格式或状态不支持此操作"));
    if (command.operation === 'edit') {
      if (kind === 'text') { setEditingText(true); setRenderedTextPreview(false); setNotice(uiText("已进入文本编辑")); }
      else {
        const session = await startOfficeEditing(true);
        return session
          ? {status:'completed', message:uiText("已打开或复用 Office 草稿"), sessionId:session.sessionId}
          : {status:'completed', message:uiText("该文件超出内嵌编辑器容量，已通过系统应用打开原文件；请在系统应用中保存修改")};
      }
      return {status:'completed',message:uiText("已进入文本编辑，尚未写入原文件")};
    }
    if (command.operation === 'read_text') return {status:'completed',message:uiText("当前文本草稿（含未保存修改）"),content:textContent};
    if (['replace_text','replace_range','patch_text'].includes(command.operation)) {
      const range=command.range;
      if(command.operation==='replace_range'&&(!range||range.end>textContent.length||textContent.slice(range.start,range.end)!==range.expectedText))throw new Error(uiText("选区内容已变化，请重新读取草稿和位置"));
      const nextContent = command.operation === 'patch_text' ? applyTextDraftPatches(textContent, command.patches ?? []) : command.operation==='replace_range'?textContent.slice(0,range!.start)+command.content!+textContent.slice(range!.end):command.content!;
      if (nextContent === textContent) return {status:'completed',message:uiText("草稿内容未变化")};
      if(textReviews.length>=20 || textReviews.reduce((n,e)=>n+e.before.length,0)+textContent.length+nextContent.length>3_500_000)throw new Error(uiText('待确认修改较多，请先采纳或取消后继续'));
      const review={id:crypto.randomUUID(),sequence:++textReviewSequence.current,createdAt:new Date().toISOString(),before:textContent};
      const reviews=[...textReviews,review];
      flushSync(()=>setReviewPreparing(true));
      try {await persistTextReview(nextContent,reviews);}finally{setReviewPreparing(false);}
      setTextReviews(reviews);
      const undo=[...textHistory.undo,textContent].slice(-20);
      while(undo.length>1 && undo.reduce((size,text)=>size+text.length,0)>5_000_000) undo.shift();
      setTextHistory({undo,redo:[]});
      setTextContent(nextContent); setDirty(true);selectedPreview.current={};
      return {status:'completed',message:uiText('AI 修改已高亮，等待用户采纳或取消；尚未保存'),review:{id:review.id,pending:reviews.length}};
    }
    if (command.operation === 'undo' || command.operation === 'redo') {
      textHistoryStep(command.operation);
      return {status:'completed',message:command.operation === 'undo' ? uiText("已撤销助手编辑，原文件未修改") : uiText("已重做助手编辑，尚未保存")};
    }
    if (command.operation === 'discard') {
      if (editingOffice) await cancelOfficeEditing(true);else await discardTextDraft(true);
      return {status:'completed',message:uiText("已放弃当前未保存草稿，恢复原文件预览")};
    }
    if (command.operation === 'save') {
      if (editingOffice && univerSessionRef.current) await saveOffice(true);
      else if (editingText) await saveText(true);
      else throw new Error(uiText("没有活动编辑草稿"));
      return {status:'completed',message:uiText("编辑内容已保存到原文件"),path:item.target ?? undefined};
    }
    if (editingOffice && univerSessionRef.current) {
      const result = await saveOfficeAs(command.destination, true);
      if (result && 'cancelled' in result) return {status:'cancelled',message:uiText("用户取消了另存，草稿和原文件保留")};
      if (!result) throw new Error(uiText("未能确认另存结果"));
      return {status:'completed',message:result.path ? uiText("当前草稿已另存，原文件未修改") : uiText("已发起当前草稿下载，原文件未修改"),path:result.path};
    }
    const selectSavePath=window.mokiDesktop?.selectSavePath;
    const destination=command.destination ?? (selectSavePath ? await selectSavePath(item.name) : undefined);
    if (selectSavePath && !destination) return {status:'cancelled',message:uiText("用户取消了另存")};
    if (destination && sameSourcePath(destination)) throw new Error(uiText("另存为不能覆盖原文件"));
    setSaving(true);
    try {
      if (kind === 'text') {
        const result=await saveAsResourceLibraryText(item.id,textContent,item.name,destination ?? undefined);
        return {status:'completed',message:result.path ? uiText("当前文本已另存，原文件和活动草稿保留") : uiText("已发起当前文本下载，原文件未修改"),path:result.path};
      }
      if (!destination) throw new Error(uiText("此格式另存需要选择本地目标路径"));
      const result=await exportResourceLibraryItem(item.id,{destination,mode:'file'});
      return {status:'completed',message:uiText("预览文件已另存，原文件未修改"),path:result.path};
    } finally {setSaving(false);}
  }

  function openDshAtCaret(event: KeyboardEvent) {
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat || event.isComposing
      || (event.code !== "KeyD" && event.key.toLowerCase() !== "d")) return;
    const target = event.target;
    if (!(target instanceof HTMLElement) || (target !== document.body && !previewWindowRef.current?.contains(target))) return;
    if (exitIntent || libraryImagePickerOpen) return;
    event.preventDefault();
    event.stopPropagation();
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
      const selected = target.value.slice(target.selectionStart ?? 0, target.selectionEnd ?? 0);
      askMokiToEdit("", selected, editableCaretPosition(target));
    } else if (univerSession) {
      void readUniverEditorSelection(univerSession).catch(() => undefined)
        .then(selection => askMokiToEdit("", "", undefined, selection));
    } else {
      const editable = target.closest<HTMLElement>("[contenteditable='true']");
      askMokiToEdit("", window.getSelection()?.toString() ?? "", editable ? contentEditableCaretPosition(editable) : undefined);
    }
  }

  const shortcutHandler = useRef(openDshAtCaret);
  shortcutHandler.current = openDshAtCaret;
  useEffect(() => {
    if (!active) return;
    const keydown = (event: KeyboardEvent) => shortcutHandler.current(event);
    document.addEventListener("keydown", keydown, true);
    return () => document.removeEventListener("keydown", keydown, true);
  }, [active]);

  function askMokiToEdit(
    instruction = "",
    selectedText = "",
    anchor?: { x: number; y: number },
    editorSelection?: UniverImageSelection,
    quoteSelection=false,
  ) {
    let detail=readPreviewSelection(previewContent(),undefined,editingText?textContent:undefined)??selectedPreview.current;
    if(editorSelection){
      detail={selectedText:('selectedText' in editorSelection?editorSelection.selectedText:undefined)||selectedText||null,editorSelection,location:editorSelection};
    }else if(selectedText&&!detail.selectedText)detail={...detail,selectedText:selectedText.slice(0,8000)};
    selectedPreview.current=detail;
    if(!detail.visual&&!detail.selectedText&&!univerSession){
      try{const root=previewContent(),snapshot=root&&capturePreviewVisual(root);if(snapshot)rememberSnapshot(snapshot)}catch{setNotice(uiText("此预览无法截取画面，已保留文件与位置信息"))}
    }
    mokiAssistancePendingRef.current=true;mokiEditorAssistantOpenedRef.current=true;
    const context=publishPreviewSelection(selectedPreview.current);
    requestMokiAssistance(context,instruction.trim(),{...(anchor?{anchor}:{}),preferInline:true,prefillPrompt:false,editorAssist:true,quoteSelection});
  }

  function finishMokiEditorAssistance() {
    if (!mokiEditorAssistantOpenedRef.current) return;
    mokiEditorAssistantOpenedRef.current = false;
    mokiAssistancePendingRef.current = false;
    closeMokiEditorAssistance();
  }

  useEffect(() => {
    if (!editingText && (!editingOffice || !univerSession)) return undefined;
    const subscribe = window.mokiDesktop?.assistantWindow?.onComposeShortcut;
    if (!subscribe) return undefined;
    return subscribe((anchor) => {
      if (editingOffice && !univerSessionRef.current) return;
      askMokiToEdit("", "", anchor);
    });
  }, [editingOffice, editingText, univerSession?.sessionId]);

  useEffect(() => {
    if (!editingOffice || !univerSession) return undefined;
    const expectedOrigin = new URL(univerSession.viewerUrl, window.location.href).origin;
    const handleEditorMessage = (event: MessageEvent) => {
      const frame = officeEditorFrameRef.current;
      if (!frame || event.source !== frame.contentWindow || event.origin !== expectedOrigin) return;
      const payload = event.data;
      if (!payload || typeof payload !== "object") return;
      const detail = payload as Record<string, unknown>;
      if (detail.type === "moki:univer-dirty") {
        setDirty(true);
        setAutosaveStatus("");
        return;
      }
      if(detail.type==='moki:univer-selection-changed'){
        const selected=normalizeUniverImageSelection(detail.selection);
        if(selected)selectionPublisher.current({selectedText:('selectedText' in selected?selected.selectedText:undefined)||null,editorSelection:selected,location:selected});
        return;
      }
      if (detail.type === "moki:univer-open-library-media" && detail.mediaKind === "image") {
        void openLibraryImagePicker(normalizeUniverImageSelection(detail.selection));
        return;
      }
      if (detail.type !== "moki:univer-compose-shortcut") return;
      const bounds = frame.getBoundingClientRect();
      const localX = typeof detail.x === "number" && Number.isFinite(detail.x) ? detail.x : bounds.width / 2;
      const localY = typeof detail.y === "number" && Number.isFinite(detail.y) ? detail.y : Math.min(120, bounds.height / 2);
      const selectedText = typeof detail.selectedText === "string" ? detail.selectedText.slice(0, 8_000) : "";
      const editorSelection = normalizeUniverImageSelection(detail.editorSelection);
      askMokiToEdit("", selectedText, {
        x: Math.round(bounds.left + Math.max(0, Math.min(bounds.width, localX))),
        y: Math.round(bounds.top + Math.max(0, Math.min(bounds.height, localY))),
      }, editorSelection, detail.quoteSelection===true);
    };
    window.addEventListener("message", handleEditorMessage);
    return () => window.removeEventListener("message", handleEditorMessage);
  }, [editingOffice, univerSession?.sessionId, univerSession?.viewerUrl]);

  function updateDocumentParagraph(index: number, value: string) {
    changeOfficePreview((current) => {
      if (current.kind !== "document") return current;
      current.paragraphs[index] = value;
      return current;
    });
  }

  function updateSpreadsheetCell(sheetIndex: number, rowIndex: number, columnIndex: number, value: string) {
    changeOfficePreview((current) => {
      if (current.kind !== "spreadsheet") return current;
      const sheet = current.sheets[sheetIndex];
      if (!sheet) return current;
      while (sheet.rows.length <= rowIndex) sheet.rows.push([]);
      const row = sheet.rows[rowIndex] ?? [];
      while (row.length <= columnIndex) row.push("");
      row[columnIndex] = value;
      sheet.rows[rowIndex] = row;
      return current;
    });
  }

  function updatePresentationParagraph(slideIndex: number, paragraphIndex: number, value: string) {
    changeOfficePreview((current) => {
      if (current.kind !== "presentation") return current;
      const slide = current.slides[slideIndex];
      if (slide) slide.paragraphs[paragraphIndex] = value;
      return current;
    });
  }

  function rememberOfficeEditorFocus(event: ReactFocusEvent<HTMLElement>) {
    const label = (event.target as HTMLElement).getAttribute("aria-label") ?? "";
    let match = label.match(/^Word 第 (\d+) 段$/u);
    if (match) {
      setOfficeEditorFocus({ kind: "document", paragraph: Number(match[1]) - 1 });
      return;
    }
    match = label.match(/ 第 (\d+) 行第 (\d+) 列$/u);
    if (match) {
      setOfficeEditorFocus({ kind: "spreadsheet", row: Number(match[1]) - 1, column: Number(match[2]) - 1 });
      return;
    }
    match = label.match(/^第 (\d+) 页第 (\d+) 个文本块$/u);
    if (match) setOfficeEditorFocus({ kind: "presentation", slide: Number(match[1]) - 1, paragraph: Number(match[2]) - 1 });
  }

  async function togglePdfText() {
    if (pdfTextOpen) {
      setPdfTextOpen(false);
      setNotice("");
      return;
    }
    setPdfTextOpen(true);
    if (structuredPreview?.kind === "pdf") return;
    setLoading(true);
    setNotice("");
    try {
      const result = await getResourceLibraryStructuredPreview(item.id);
      if (result.kind !== "pdf") throw new Error(uiText("PDF 提取结果无效"));
      setStructuredPreview(result);
      if (!result.text) setNotice(uiText("未提取到文字；扫描版 PDF 需要 OCR 后才能读取文本"));
    } catch (error) {
      setPdfTextOpen(false);
      setNotice(error instanceof Error ? error.message : uiText("PDF 文本提取失败"));
    } finally {
      setLoading(false);
    }
  }

  async function recognizePdf() {
    if (structuredPreview?.kind !== "pdf") return;
    setLoading(true);
    setNotice("");
    setOcrProgress({ currentPage: 1, totalPages: structuredPreview.totalPages, phase: "rendering" });
    try {
      const result = await recognizeResourceLibraryPdf(
        item.id,
        structuredPreview.totalPages,
        setOcrProgress,
      );
      setStructuredPreview(result);
      setNotice(uiText`DeepSeek OCR 已完成，共识别 ${result.totalPages} 页`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : uiText("DeepSeek OCR 识别失败"));
    } finally {
      setLoading(false);
      setOcrProgress(undefined);
    }
  }

  function updateTableCell(rowIndex: number, columnIndex: number, value: string) {
    const rows = parseDelimitedText(textContent, delimiter);
    while (rows.length <= rowIndex) rows.push([]);
    const row = rows[rowIndex] ?? [];
    while (row.length <= columnIndex) row.push("");
    row[columnIndex] = value;
    rows[rowIndex] = row;
    setTextContent(serializeDelimitedRows(rows, delimiter));
    setDirty(true);
  }

  function changeImageScale(nextScale: number) {
    const scale = Math.max(0.25, Math.min(8, nextScale));
    setImageScale(scale);
    if (scale === 1) setImageOffset({ x: 0, y: 0 });
  }

  function startImagePan(event: ReactPointerEvent<HTMLDivElement>) {
    if (imageScale <= 1 || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    imageDragRef.current = { x: event.clientX, y: event.clientY, offsetX: imageOffset.x, offsetY: imageOffset.y };
  }

  function moveImage(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = imageDragRef.current;
    if (!drag) return;
    setImageOffset({ x: drag.offsetX + event.clientX - drag.x, y: drag.offsetY + event.clientY - drag.y });
  }

  function startPreviewResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const bounds = previewWindowRef.current?.getBoundingClientRect();
    if (!bounds) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    previewResizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      width: bounds.width,
      height: bounds.height,
    };
  }

  function movePreviewResize(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = previewResizeRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const containingBounds = contained
      ? previewWindowRef.current?.parentElement?.getBoundingClientRect()
      : undefined;
    const maxWidth = Math.max(1, (containingBounds?.width ?? window.innerWidth) - 32);
    const maxHeight = Math.max(1, (containingBounds?.height ?? window.innerHeight) - 32);
    const minWidth = Math.min(320, maxWidth);
    const minHeight = Math.min(320, maxHeight);
    setPreviewSize({
      width: Math.max(minWidth, Math.min(maxWidth, drag.width + event.clientX - drag.startX)),
      height: Math.max(minHeight, Math.min(maxHeight, drag.height + event.clientY - drag.startY)),
    });
  }

  function endPreviewResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (previewResizeRef.current?.pointerId !== event.pointerId) return;
    previewResizeRef.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  const visualLocationContext = JSON.stringify({
    mode: editingOffice ? "office_editor" : editingText ? "text_editor" : "preview",
    contentKind: kind,
    extension,
    ...(kind === "presentation" && !editingOffice ? { pageNumber: presentationSlideIndex + 1 } : {}),
    ...(kind === "spreadsheet" && !editingOffice ? {
      sheetIndex: activeSheetIndex,
      sheetName: structuredPreview?.kind === "spreadsheet"
        ? structuredPreview.sheets[activeSheetIndex]?.name
        : undefined,
    } : {}),
    ...(univerSession ? {
      sessionId: univerSession.sessionId,
      worktreeId: univerSession.worktreeId,
      unitId: univerSession.unitId,
      unitKind: univerSession.kind,
    } : {}),
    ...(officeEditorFocus ? { focus: officeEditorFocus } : {}),
  });

  const editing = editingText || editingOffice;
  const autosaveFailed = autosaveStatus.includes(uiText("失败"));
  const hasWarning = autosaveFailed || /失败|无法|不可用|冲突|已变化|已被修改|超时/.test(notice);
  const status = saving ? uiText("保存中…") : autosaveFailed ? autosaveStatus
    : notice || (editing ? autosaveStatus || (dirty ? uiText("草稿待保存") : uiText("编辑中")) : "");
  const statusCaption = status.replace(uiText("草稿已自动保存 · "), uiText("草稿已暂存 "));
  const detailRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const closeDetails = (event: PointerEvent) => {
      const details = detailRef.current;
      if (details?.open && event.target instanceof Node && !details.contains(event.target)) details.open = false;
    };
    document.addEventListener("pointerdown", closeDetails, true);
    return () => document.removeEventListener("pointerdown", closeDetails, true);
  }, []);

  return <div data-moki-preview-location={visualLocationContext} className={embedded ? "flex size-full min-h-0 flex-col" : `${contained ? "absolute" : "fixed"} inset-0 grid min-h-0 place-items-center overflow-hidden bg-[#111827]/40 p-4 backdrop-blur-sm ${layerClassName}`} role={embedded ? "region" : "dialog"} aria-modal={embedded ? undefined : true} aria-label={uiText`预览 ${item.name}`}>
    <section
      ref={previewWindowRef}
      data-preview-embedded={embedded || undefined}
      data-dsh-file-preview
      aria-label={uiText("文件预览窗口")}
      onFocusCapture={rememberOfficeEditorFocus}
      className={embedded
        ? "relative flex size-full min-h-0 min-w-0 flex-col overflow-hidden bg-white p-3"
        : contained
          ? "relative flex min-h-0 min-w-0 resize flex-col overflow-hidden rounded-[24px] bg-white p-4 shadow-2xl"
          : "relative flex h-[82vh] min-h-80 min-w-80 max-h-[calc(100vh-2rem)] max-w-[calc(100vw-2rem)] resize flex-col overflow-hidden rounded-[24px] bg-white p-4 shadow-2xl"}
      style={{
        width: embedded
          ? undefined
          : previewSize
            ? `${previewSize.width}px`
            : contained
              ? "68rem"
              : "min(72rem, calc(100vw - 2rem))",
        height: embedded
          ? undefined
          : previewSize
            ? `${previewSize.height}px`
            : contained
              ? "44rem"
              : undefined,
        maxWidth: embedded ? undefined : contained ? "calc(100% - 2rem)" : undefined,
        maxHeight: embedded ? undefined : contained ? "calc(100% - 2rem)" : undefined,
      }}
    >
      <SelectionChatAction root={previewWindowRef} active={active&&!editingOffice&&!exitIntent&&!libraryImagePickerOpen} sourceText={editingText?textContent:undefined} onQuote={(selected,anchor)=>{
        selectedPreview.current=selected;mokiAssistancePendingRef.current=true;mokiEditorAssistantOpenedRef.current=true;
        requestMokiAssistance(publishPreviewSelection(selected),'',{anchor,preferInline:true,prefillPrompt:false,editorAssist:true,quoteSelection:true});
      }}/>
      <header className="resource-preview-header dsh-file-bar">
        <div className="dsh-file-summary">
          <details ref={detailRef} className="dsh-file-details" onKeyDown={event => {
            if (event.key === "Escape") {
              event.currentTarget.open = false;
              event.currentTarget.querySelector("summary")?.focus();
              event.stopPropagation();
            }
          }}>
            <summary aria-label={uiText("文件详情 · ") + item.name} title={[item.name,item.target].filter(Boolean).join("\n")}>
              <b className="resource-preview-name">{item.name}</b><ChevronDown size={12} aria-hidden="true"/>
            </summary>
            <div className="dsh-file-detail-popover">
              <strong>{item.name}</strong>
              {item.target && <p className="dsh-file-full-path">{item.target}</p>}
              {editing && <p>{uiText("编辑协作")}<kbd>Alt+D</kbd></p>}
              {editing && autosaveStatus && <p>{autosaveStatus}</p>}
              {notice && <p>{notice}</p>}
            </div>
          </details>
          {status && <button type="button" className="dsh-file-status" data-warning={hasWarning || undefined} title={status}
            aria-label={uiText("查看状态：") + status} onClick={() => {if (detailRef.current) detailRef.current.open = !detailRef.current.open;}}>
            {hasWarning && <CircleAlert size={13} aria-hidden="true"/>}<span role={hasWarning ? "alert" : "status"}>{statusCaption}</span>
          </button>}
        </div>
        <div className="resource-preview-actions dsh-file-actions" role="toolbar" aria-label={uiText("文件操作")}>
          {headerActions}
          {!editingOffice&&(['image','video'].includes(kind)||kind==='embedded'&&extension==='pdf'||['model','ofd'].includes(info?.kind||''))&&<IconButton aria-label={uiText("框选区域与 DSH 协作")} title={uiText("框选预览区域与 DSH 协作")} aria-pressed={selectingRegion} onClick={()=>setSelectingRegion(!selectingRegion)}><Scan size={15}/></IconButton>}
          <Button size="compact" className="dsh-compact-action" data-dsh-chat-trigger="true" aria-label={uiText("DSH 对话")} aria-keyshortcuts="Alt+D" title={uiText("与 DSH 对话 (Alt+D)")} onMouseDown={event => event.preventDefault()} onClick={async () => {
            if (univerSession) {
              const selection = await readUniverEditorSelection(univerSession).catch(() => undefined);
              askMokiToEdit("", "", undefined, selection);
            } else {
              const textSelection = window.getSelection();
              const insidePreview = textSelection?.anchorNode && previewWindowRef.current?.contains(textSelection.anchorNode);
              askMokiToEdit("", insidePreview ? textSelection.toString() : "");
            }
          }}><span className="dsh-whale" aria-hidden="true"/><span className="dsh-action-label">{uiText("DSH 对话")}</span><kbd className="dsh-key-hint">Alt+D</kbd></Button>
          {(kind === "audio" || kind === "embedded" || kind === "web" || kind === "unsupported") ? <IconButton aria-label={uiText("复制文件位置")} onClick={() => void copySource()}><Copy size={16}/></IconButton> : null}
          {item.kind === "local_file" && (officeEditable || kind === "workspace") ? editingOffice ? <>
            <Button size="compact" className="dsh-compact-action" aria-label={uiText("取消编辑")} title={uiText("取消编辑")} disabled={saving} onClick={() => void requestEditorExit("cancel")}><Undo2 size={14}/><span className="dsh-action-label">{uiText("取消")}</span></Button>
            <Button size="compact" className="dsh-compact-action" aria-label={uiText("另存为")} title={uiText(pendingReviews||reviewBusy?'请先采纳或取消 AI 修改，再保存文件':'另存为')} disabled={!dirty || saving || Boolean(pendingReviews) || reviewBusy} onClick={() => void saveOfficeAs()}><FileOutput size={14}/><span className="dsh-action-label">{uiText("另存为")}</span></Button>
            <Button size="compact" variant="primary" title={pendingReviews||reviewBusy?uiText('请先采纳或取消 AI 修改，再保存文件'):undefined} disabled={!dirty || saving || Boolean(pendingReviews) || reviewBusy} onClick={() => void saveOffice()}>{saving ? <LoaderCircle size={16} className="animate-spin"/> : <Save size={16}/>}{uiText("保存")}</Button>
          </> : <>
            <IconButton aria-label={kind === "workspace" ? uiText("编辑 Univer") : uiText("编辑 Office")} disabled={loading} onClick={() => void startOfficeEditing()}><Pencil size={16}/></IconButton>
            <IconButton aria-label={uiText("复制文件位置")} onClick={() => void copySource()}><Copy size={16}/></IconButton>
          </> : null}
          {kind === "embedded" && extension === "pdf" ? <>
            {pdfTextOpen && structuredPreview?.kind === "pdf" && structuredPreview.text ? <IconButton aria-label={uiText("复制 PDF 文本")} onClick={() => void copyText(structuredPreview.text, uiText("已复制 PDF 文本"))}><Copy size={16}/></IconButton> : null}
            {pdfTextOpen && structuredPreview?.kind === "pdf" ? <Button size="compact" variant="primary" disabled={loading} onClick={() => void recognizePdf()}>{ocrProgress ? <LoaderCircle size={13} className="animate-spin"/> : <ScanText size={13}/>} {ocrProgress ? `${ocrProgress.phase === "rendering" ? uiText("渲染") : uiText("识别")} ${ocrProgress.currentPage}/${ocrProgress.totalPages}` : structuredPreview.source === "deepseek-ocr" ? uiText("重新 OCR") : "DeepSeek OCR"}</Button> : null}
            <Button size="compact" disabled={loading} onClick={() => void togglePdfText()}>{loading ? <LoaderCircle size={13} className="animate-spin"/> : <FileText size={13}/>} {pdfTextOpen ? uiText("查看原 PDF") : uiText("提取文本")}</Button>
          </> : null}
          {kind === "text" ? <>
            {!editingText && ["md", "markdown", "html", "htm", "json"].includes(extension) ? <Button size="compact" onClick={() => setRenderedTextPreview((value) => !value)}>{renderedTextPreview ? uiText("查看源码") : uiText("渲染预览")}</Button> : null}
            {(extension === "csv" || extension === "tsv") ? <Button size="compact" onClick={() => setTableMode((value) => !value)}>{tableMode ? uiText("文本模式") : uiText("表格模式")}</Button> : null}
            {!editingText ? <>
              <IconButton aria-label={uiText("编辑")} title={uiText("编辑")} onClick={() => { setEditingText(true); setRenderedTextPreview(false); setNotice(""); }}><Pencil size={14}/></IconButton>
              <IconButton aria-label={uiText("复制文本")} onClick={() => void copyText(textContent, uiText("已复制文本"))}><Copy size={14}/></IconButton>
            </> : <>
              <IconButton aria-label={uiText("撤销助手编辑")} title={uiText("撤销助手编辑")} disabled={saving || Boolean(pendingReviews) || reviewBusy || !textHistory.undo.length} onClick={() => textHistoryStep('undo')}>↶</IconButton>
              <IconButton aria-label={uiText("重做助手编辑")} title={uiText("重做助手编辑")} disabled={saving || Boolean(pendingReviews) || reviewBusy || !textHistory.redo.length} onClick={() => textHistoryStep('redo')}>↷</IconButton>
              <Button size="compact" className="dsh-compact-action" aria-label={uiText("取消编辑")} title={uiText("取消编辑")} disabled={saving} onClick={() => void requestEditorExit("cancel")}><Undo2 size={14}/><span className="dsh-action-label">{uiText("取消")}</span></Button>
              <Button size="compact" variant="primary" title={pendingReviews||reviewBusy?uiText('请先采纳或取消 AI 修改，再保存文件'):undefined} disabled={!dirty || saving || Boolean(pendingReviews) || reviewBusy} onClick={() => void saveText()}>{saving ? <LoaderCircle size={13} className="animate-spin"/> : <Save size={13}/>}{uiText("保存")}</Button>
            </>}
          </> : null}
          {!editingOffice && !editingText ? <Button size="compact" className="dsh-compact-action" aria-label={uiText("系统打开")} title={uiText("用系统应用打开")} onClick={() => void onOpen(item)}><ExternalLink size={14}/><span className="dsh-action-label">{uiText("系统打开")}</span></Button> : null}
          <IconButton aria-label={uiText("关闭预览")} onClick={() => void requestEditorExit("close")}><X size={16}/></IconButton>
        </div>
      </header>
      <EditReviewBar entries={reviewEntries} busy={reviewBusy} onResolve={(action,id)=>void resolveEditReview(action,id)} onLocate={locateReview}/>
      {exitIntent ? <LibraryDialog titleId="library-save-title" size="small" onDismiss={()=>{if (!saving) setExitIntent(undefined);}}>
        <section className="library-dialog-card">
          <header><h3 id="library-save-title">{uiText("保存对“")}{item.name}{uiText("”的修改？")}</h3></header>
          <p className="library-dialog-body">{uiText("当前修改还在草稿中。")}</p>
          <footer>
            <Button size="compact" autoFocus disabled={saving} onClick={() => setExitIntent(undefined)}>{uiText("继续编辑")}</Button>
            <Button size="compact" variant="danger" disabled={saving} onClick={() => void completeEditorExit("discard")}>{uiText("放弃修改")}</Button>
            <Button size="compact" variant="primary" disabled={saving} onClick={() => void completeEditorExit("save")}>{saving ? <LoaderCircle size={13} className="animate-spin"/> : <Save size={13}/>}{uiText("保存并退出")}</Button>
          </footer>
        </section>
      </LibraryDialog> : null}
      <div className="dsh-preview-content relative min-h-0 flex-1 overflow-hidden" data-preview-kind={kind} data-extension={extension}>
        {selectingRegion&&<PreviewRegionSelection onCancel={()=>setSelectingRegion(false)} onSelect={rect=>{
          try{const root=previewContent(),snapshot=root&&capturePreviewVisual(root,rect);if(!snapshot){setNotice(uiText("请在预览画面内框选"));return}rememberSnapshot(snapshot);window.getSelection()?.removeAllRanges();setSelectingRegion(false);askMokiToEdit()}catch{setSelectingRegion(false);setNotice(uiText("当前画面无法读取，请使用文字选区协作"))}
        }}/>}
        {editingOffice && univerSession ? <div className="absolute inset-0 z-20 bg-white">
          {reviewBusy&&<div className="moki-review-shield" aria-label={uiText('正在同步 AI 修改')}/>}
          <iframe
            ref={officeEditorFrameRef}
            data-office-editor="true"
            src={officeViewerUrl}
            title={uiText`${item.name} Univer Office 编辑器`}
            allow="clipboard-read; clipboard-write"
            className="size-full border-0 bg-white"
            onLoad={() => { syncOfficeTheme(); postOfficeReview(); setNotice(univerSession.recoveredDraft ? uiText("已恢复上次草稿") : ""); }}
          />
        </div> : null}
        {previewUrl && kind === "image" ? <>
          <div
            className={`size-full overflow-hidden ${imageScale > 1 ? "cursor-grab active:cursor-grabbing" : ""}`}
            onPointerDown={startImagePan}
            onPointerMove={moveImage}
            onPointerUp={() => { imageDragRef.current = undefined; }}
            onPointerCancel={() => { imageDragRef.current = undefined; }}
            onWheel={(event: WheelEvent<HTMLDivElement>) => {
              event.preventDefault();
              changeImageScale(imageScale + (event.deltaY < 0 ? 0.2 : -0.2));
            }}
          >
            <img
              ref={imageRef} src={previewUrl} alt={item.name} draggable={false}
              loading="lazy" decoding="async" crossOrigin={item.kind === "url" ? "anonymous" : undefined}
              onError={()=>setNotice(uiText("图片解码失败，此编码或分辨率请使用系统默认应用打开"))}
              onLoad={(event) => void onThumbnail?.(item, event.currentTarget)}
              className="size-full select-none object-contain transition-transform duration-100"
              style={{ transform: `translate(${imageOffset.x}px, ${imageOffset.y}px) scale(${imageScale})` }}
            />
          </div>
          <div className="library-image-controls">
            <span className="library-image-hint"><Move size={12} aria-hidden="true"/>{uiText("滚轮缩放，放大后拖动")}</span>
            <div className="library-image-toolbar" role="toolbar" aria-label={uiText("图片预览操作")}>
              <IconButton variant="ghost" aria-label={uiText("缩小图片")} onClick={() => changeImageScale(imageScale - 0.25)}><Minus size={16}/></IconButton>
              <span className="library-image-scale">{Math.round(imageScale * 100)}%</span>
              <IconButton variant="ghost" aria-label={uiText("放大图片")} onClick={() => changeImageScale(imageScale + 0.25)}><Plus size={16}/></IconButton>
              <IconButton variant="ghost" aria-label={uiText("重置图片视图")} onClick={() => changeImageScale(1)}><RotateCcw size={16}/></IconButton>
              <IconButton variant="ghost" aria-label={uiText("复制图片")} onClick={() => void copyImageOrFrame(imageRef.current)}><Copy size={16}/></IconButton>
            </div>
          </div>
        </> : null}
        {previewUrl && kind === "video" ? <div className="relative size-full overflow-hidden bg-[#10131d]">
          <video
            ref={videoRef}
            src={previewUrl}
            onError={()=>{if(!compatibleMedia&&item.kind==='local_file'){setCompatibleMedia(true);setNotice(uiText("正在使用本机 FFmpeg 兼容播放；流式转换仅支持已缓冲区间内跳转"))}else setNotice(uiText("此视频编码无法在当前环境播放，请使用系统默认应用打开"))}}
            preload="auto"
            crossOrigin={item.kind === "url" ? "anonymous" : undefined}
            onClick={toggleVideoPlayback}
            onContextMenu={(event) => void openVideoContextMenu(event)}
            title={uiText("右键打开视频菜单")}
            onPlay={() => setVideoPlaying(true)}
            onPause={() => setVideoPlaying(false)}
            onEnded={() => setVideoPlaying(false)}
            onTimeUpdate={(event) => setVideoCurrentTime(event.currentTarget.currentTime)}
            onDurationChange={(event) => setVideoDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
            onVolumeChange={(event) => { setVideoVolume(event.currentTarget.volume); setVideoMuted(event.currentTarget.muted); }}
            onLoadedMetadata={(event) => {
              const video = event.currentTarget;
              video.volume = videoVolume;
              video.muted = videoMuted;
              setVideoDuration(Number.isFinite(video.duration) ? video.duration : 0);
              setVideoCurrentTime(video.currentTime);
            }}
            onLoadedData={(event) => void onThumbnail?.(item, event.currentTarget)}
            className="size-full object-contain"
          />
      <div
            role="group"
            aria-label={uiText("视频播放控制")}
            className="absolute bottom-3 left-1/2 flex w-fit max-w-[calc(100%-1.5rem)] -translate-x-1/2 flex-nowrap items-center justify-center gap-1.5 rounded-2xl border border-white/15 bg-[#171b2c]/90 p-2 text-white shadow-xl backdrop-blur-md"
          >
            <button type="button" aria-label={uiText("视频上一帧")} aria-keyshortcuts="ArrowLeft" title={uiText("上一帧（←）")} onClick={() => stepVideo(-1)} className="grid size-8 shrink-0 place-items-center rounded-xl hover:bg-white/15"><SkipBack size={14}/></button>
            <button type="button" aria-label={videoPlaying ? uiText("暂停视频") : uiText("播放视频")} aria-keyshortcuts="Space" title={uiText`${videoPlaying ? uiText("暂停") : uiText("播放")}（空格）`} onClick={toggleVideoPlayback} className="grid size-8 shrink-0 place-items-center rounded-xl bg-white text-[#242a40] hover:bg-[#eeedff]">{videoPlaying ? <Pause size={14}/> : <Play size={14}/>}</button>
            <button type="button" aria-label={uiText("视频下一帧")} aria-keyshortcuts="ArrowRight" title={uiText("下一帧（→）")} onClick={() => stepVideo(1)} className="grid size-8 shrink-0 place-items-center rounded-xl hover:bg-white/15"><SkipForward size={14}/></button>
            <span className="grid min-w-[6.5rem] gap-0.5 text-center font-bold tabular-nums">
              <span className="text-[0.625rem]">{formatVideoPreviewTime(videoCurrentTime)} / {formatVideoPreviewTime(videoDuration)}</span>
              <span className="text-[0.5625rem] text-white/65" title={uiText("按 30 fps 估算帧数")}>{uiText("帧")}{videoPreviewFramePosition(videoCurrentTime, videoDuration).current} / {videoPreviewFramePosition(videoCurrentTime, videoDuration).total}</span>
            </span>
            <input
              aria-label={uiText("视频时间轴")}
              type="range"
              min="0"
              max={Math.max(0, videoDuration)}
              step="0.001"
              value={Math.min(videoCurrentTime, Math.max(0, videoDuration))}
              onChange={(event) => seekVideo(Number(event.target.value))}
              className="h-1 w-[clamp(7rem,24vw,20rem)] shrink accent-[#8c84e8]"
            />
            <div className="relative shrink-0">
              <button
                type="button"
                aria-label={volumeControlOpen ? uiText("关闭视频音量调节") : uiText("打开视频音量调节")}
                aria-expanded={volumeControlOpen}
                aria-controls="resource-video-volume-control"
                onClick={() => setVolumeControlOpen((open) => !open)}
                className="grid size-8 place-items-center rounded-xl hover:bg-white/15"
              >
                {videoMuted || videoVolume === 0 ? <VolumeX size={14}/> : <Volume2 size={14}/>}
              </button>
              {volumeControlOpen ? (
                <div
                  id="resource-video-volume-control"
                  role="group"
                  aria-label={uiText("视频音量调节")}
                  className="absolute bottom-full right-0 mb-2 flex items-center gap-2 rounded-xl border border-white/15 bg-[#171b2c]/95 p-2 shadow-xl backdrop-blur-md"
                >
                  <button type="button" aria-label={videoMuted ? uiText("取消视频静音") : uiText("视频静音")} onClick={toggleVideoMuted} className="grid size-7 shrink-0 place-items-center rounded-lg hover:bg-white/15">{videoMuted || videoVolume === 0 ? <VolumeX size={13}/> : <Volume2 size={13}/>}</button>
                  <input aria-label={uiText("视频音量")} type="range" min="0" max="1" step="0.01" value={videoMuted ? 0 : videoVolume} onChange={(event) => changeVideoVolume(Number(event.target.value))} className="h-1 w-24 accent-[#8c84e8]"/>
                  <span className="w-8 text-right text-[0.5625rem] font-bold tabular-nums text-white/75">{Math.round((videoMuted ? 0 : videoVolume) * 100)}%</span>
                </div>
              ) : null}
            </div>
          </div>
        </div> : null}
        {previewUrl && kind === "audio" ? <div className="grid size-full place-items-center"><audio src={previewUrl} controls preload="metadata" className="w-[min(38rem,80%)]" onError={()=>{if(!compatibleMedia&&item.kind==='local_file'){setCompatibleMedia(true);setNotice(uiText("正在使用本机 FFmpeg 兼容播放"))}else setNotice(uiText("此音频编码请使用系统默认应用打开"))}}/></div> : null}
        {previewUrl && kind === "embedded" && !pdfTextOpen ? extension==='pdf'?<Suspense fallback={<div role="status">{uiText("正在加载 PDF…")}</div>}><PdfPreview url={previewUrl}/></Suspense>:<iframe src={previewUrl} title={item.name} loading="lazy" className="size-full border-0"/> : null}
        {kind === "embedded" && extension === "pdf" && pdfTextOpen ? loading ? <div role="status" className="grid size-full place-items-center"><span className="flex items-center gap-2 text-[0.75rem] font-bold text-[#6860c2]"><LoaderCircle size={16} className="animate-spin"/>{ocrProgress ? uiText`正在${ocrProgress.phase === "rendering" ? uiText("渲染") : uiText("识别")}第 ${ocrProgress.currentPage}/${ocrProgress.totalPages} 页` : uiText("正在提取 PDF 文本")}</span></div> : structuredPreview?.kind === "pdf" ? <div className="library-pdf-text size-full overflow-auto bg-[#eef0f5] p-5"><div className="mx-auto grid max-w-4xl gap-4"><div className="flex items-center justify-between rounded-xl border border-[#e2e4ed] bg-white px-4 py-3"><span className="text-xs font-bold text-[#697083]">{uiText("文本来源")}</span><span className={`rounded-full px-2.5 py-1 text-[0.625rem] font-extrabold ${structuredPreview.source === "deepseek-ocr" ? "bg-[#e9e7ff] text-[#625bc5]" : "bg-[#edf9f4] text-[#357d65]"}`}>{structuredPreview.source === "deepseek-ocr" ? "DeepSeek OCR" : uiText("PDF 文字层")}</span></div>{structuredPreview.pages.map((page) => <article key={page.number} data-moki-page-number={page.number} data-moki-location={JSON.stringify({kind:"pdf",page:page.number})} className="rounded-xl bg-white px-8 py-7 shadow-sm"><div className="mb-4 flex items-center justify-between border-b border-[#eceef3] pb-3"><b className="text-[0.75rem] text-[#464c61]">{uiText("第")}{page.number}{uiText("页")}</b><span className="text-[0.625rem] font-semibold text-[#999fb0]">{page.text.length}{uiText("字符")}</span></div>{page.text ? structuredPreview.source === "deepseek-ocr" ? <MarkdownRenderer content={page.text} className="text-sm leading-7"/> : <p data-moki-selection-text="pdf-text" className="whitespace-pre-wrap text-sm leading-7 text-[#30364b]">{page.text}</p> : <p className="text-sm font-semibold text-[#9a7a3b]">{uiText("本页没有可提取的文本层，可点击 DeepSeek OCR 识别")}</p>}</article>)}</div></div> : <div className="grid size-full place-items-center text-sm font-bold text-[#7c8294]">{uiText("无法提取此 PDF 的文本")}</div> : null}
        {previewUrl && kind === "web" ? <div className="flex size-full flex-col bg-white"><div className="flex shrink-0 items-center gap-2 border-b border-[#e3e5ed] bg-[#f7f8fb] px-3 py-2 text-[0.6875rem] font-semibold text-[#697083]"><span className="size-2 rounded-full bg-[#4aa681]"/><span className="min-w-0 flex-1 truncate">{uiText("网页预览")}</span></div><iframe src={previewUrl} title={uiText`${item.name} 在线页面`} loading="lazy" referrerPolicy="strict-origin-when-cross-origin" sandbox={onlinePreviewSandbox(previewUrl)} className="min-h-0 flex-1 border-0"/></div> : null}
        {kind === "text" ? loading ? <div role="status" className="grid size-full place-items-center"><span className="flex items-center gap-2 text-[0.75rem] font-bold text-[#6860c2]"><LoaderCircle size={16} className="animate-spin"/>{uiText("正在读取文本")}</span></div> : !editingText && renderedTextPreview && ["html", "htm"].includes(extension) ? <iframe title={uiText`${item.name} HTML 预览`} srcDoc={textContent} sandbox="allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation" referrerPolicy="no-referrer" className="size-full border-0 bg-white"/> : !editingText && renderedTextPreview && ["md", "markdown"].includes(extension) ? <div className="size-full overflow-auto bg-white p-6"><MarkdownRenderer content={textContent} className="mx-auto max-w-4xl text-sm leading-7"/></div> : !editingText && renderedTextPreview && extension === "json" ? <pre className="size-full overflow-auto bg-[#171b2c] p-5 font-mono text-xs leading-6 text-[#d9dcf0]">{(() => { try { return JSON.stringify(JSON.parse(textContent), null, 2); } catch { return textContent; } })()}</pre> : renderReadOnlyTable ? <div className="size-full overflow-auto bg-white p-3"><table className="min-w-full border-collapse text-[0.6875rem]"><tbody>{tableRows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, columnIndex) => <td key={columnIndex} className="min-w-32 border border-[#e1e3ec] px-2 py-1.5 text-[#34394e]">{cell}</td>)}</tr>)}</tbody></table></div> : renderEditableTable ? <div className="size-full overflow-auto bg-white p-3"><table className="min-w-full border-collapse text-[0.6875rem]"><tbody>{tableRows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, columnIndex) => <td key={columnIndex} className="min-w-32 border border-[#e1e3ec] p-0"><input aria-label={uiText`第 ${rowIndex + 1} 行第 ${columnIndex + 1} 列`} value={cell} onChange={(event) => updateTableCell(rowIndex, columnIndex, event.target.value)} className="h-8 w-full min-w-32 bg-white px-2 outline-none focus:bg-[#f1f0ff]"/></td>)}</tr>)}</tbody></table></div> : editingText ? <div className="flex size-full flex-col"><ReviewTextEditor value={textContent} baseline={textReviews[0]?.before} locked={Boolean(pendingReviews||reviewBusy)} onChange={(event)=>{if(pendingReviews||reviewBusy)return;setTextContent(event.target.value);setTextHistory(history=>({...history,redo:[]}));setDirty(true);}}/>{tableMode && tableCellCount > 12_000 ? <p className="shrink-0 border-t border-[#e2e4ed] bg-[#fff8e8] px-3 py-2 text-[0.625rem] font-semibold text-[#9a6d24]">{uiText("表格数据量较大，已切换为高性能文本编辑模式，保存时不会截断内容。")}</p> : null}</div> : <pre data-moki-selection-text="source" data-moki-text-source="true" className="size-full overflow-auto whitespace-pre-wrap bg-white p-5 font-mono text-[0.75rem] leading-6 text-[#30364b]">{textContent}</pre> : null}
        {["document", "spreadsheet"].includes(kind) && !editingOffice ? loading ? <div role="status" className="grid size-full place-items-center"><span className="flex items-center gap-2 text-[0.75rem] font-bold text-[#6860c2]"><LoaderCircle size={16} className="animate-spin"/>{uiText("正在解析 Office 文件")}</span></div> : structuredPreview?.kind === "document" ? <article className="size-full overflow-auto bg-[#eef0f5] p-6"><div data-testid="office-document-preview" className="mx-auto min-h-full max-w-3xl rounded-sm bg-white px-12 py-10 text-sm leading-7 text-[#30364b] shadow-sm [&_p]:mb-3 [&_p]:whitespace-pre-wrap [&_table]:my-5 [&_table]:w-full [&_table]:border-collapse [&_td]:min-w-20 [&_td]:border [&_td]:border-[#d9dce6] [&_td]:px-3 [&_td]:py-2 [&_td]:align-top">{structuredPreview.html ? <div className="contents" dangerouslySetInnerHTML={{ __html: structuredPreview.html }}/> : structuredPreview.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div></article> : structuredPreview?.kind === "spreadsheet" ? <SpreadsheetPreview sheets={structuredPreview.sheets} activeSheetIndex={activeSheetIndex} onActiveSheetIndex={setActiveSheetIndex}/> : <div className="grid size-full place-items-center text-sm font-bold text-[#7c8294]">{uiText("无法解析此 Office 文件")}</div> : null}
        {active && kind === "presentation" && extension === "key" && !editingOffice ? loading ? <div role="status" className="grid size-full place-items-center"><span className="flex items-center gap-2 text-[0.75rem] font-bold text-[#6860c2]"><LoaderCircle size={16} className="animate-spin"/>{uiText("正在解析演示文稿")}</span></div> : structuredPreview?.kind === "presentation" ? <StructuredPresentationSlides preview={structuredPreview}/> : <div className="grid size-full place-items-center text-sm font-bold text-[#7c8294]">{uiText("无法解析此演示文稿")}</div> : null}
        {active && kind === "presentation" && ["ppt", "pptx"].includes(extension) && !editingOffice ? <div ref={presentationPreviewRef} data-moki-page-number={presentationSlideIndex + 1} className="size-full min-h-0 overflow-hidden"><Suspense fallback={<div role="status" className="grid size-full place-items-center"><span className="flex items-center gap-2 text-[0.75rem] font-bold text-[#6860c2]"><LoaderCircle size={16} className="animate-spin"/>{uiText("正在加载 PowerPoint 预览器")}</span></div>}>
          <PowerPointViewer
            key={`${item.id}:${item.updatedAt}:${officeRevision}`}
            source={presentationSourceUrl(item, officeRevision)}
            parseOptions={{ maxInputBytes: POWERPOINT_MAX_PREVIEW_BYTES }}
            mode="slide"
            slideIndex={presentationSlideIndex}
            fitMode="contain"
            height="100%"
            showToolbar
            showThumbnails
            showSlideLabels
            className="moki-powerpoint-viewer size-full min-h-0 overflow-hidden bg-[#e8eaf0]"
            onSlideChange={(slideIndex) => setPresentationPosition({ itemId: item.id, slideIndex })}
            onThumbnailRendered={() => {
              const root = presentationPreviewRef.current;
              if (!root?.querySelector(`.rpv-filmstrip__item[data-index="${presentationSlideIndex}"]`)) {
                synchronizePowerPointThumbnailRail(root, presentationSlideIndex);
              }
            }}
            renderLoading={() => <div role="status" className="grid size-full place-items-center"><span className="flex items-center gap-2 text-[0.75rem] font-bold text-[#6860c2]"><LoaderCircle size={16} className="animate-spin"/>{uiText("正在解析 PowerPoint 文件")}</span></div>}
            onError={loadPresentationFallback}
            onWarning={warning => { if (warning.code === 'missing-asset') setNotice(uiText("原稿引用的部分图片资源缺失，当前预览可能不完整，请调用系统应用核对原稿。")); }}
            renderError={(error) => structuredPreview?.kind === "presentation"
              ? <div className="flex size-full min-h-0 flex-col"><p role="alert" className="shrink-0 bg-[#fff8e8] px-3 py-2 text-xs text-[#846b3a]">{uiText("完整预览失败，以下仅为文字内容，不包含图片与原始排版。请调用系统应用查看原稿。")}</p><div className="min-h-0 flex-1"><StructuredPresentationSlides preview={structuredPreview}/></div></div>
              : loading && presentationFallbackRequestedRef.current
                ? <div role="status" className="grid size-full place-items-center"><span className="flex items-center gap-2 text-[0.75rem] font-bold text-[#6860c2]"><LoaderCircle size={16} className="animate-spin"/>{uiText("正在准备 PowerPoint 文字兜底预览")}</span></div>
              : <div className="library-preview-empty grid size-full place-items-center px-6 text-center"><div><p className="text-sm font-black text-[#3e4356]">{uiText("PowerPoint 预览失败")}</p><p className="mt-2 max-w-xl text-[0.6875rem] leading-5 text-[#858b9d]">{error.message}</p><button type="button" onClick={() => void onOpen(item)} className="mt-4 rounded-xl bg-[#242a40] px-4 py-2 text-[0.6875rem] font-bold text-white">{uiText("调用系统应用打开")}</button></div></div>}
          />
        </Suspense></div> : null}
        {kind === "workspace" && !editingOffice ? <div className="library-preview-empty grid size-full place-items-center text-center"><div><p className="text-sm font-black text-[#30364b]">{uiText("原生 Univer 多 Unit 工作区")}</p><p className="mt-2 max-w-md text-[0.6875rem] leading-5 text-[#7c8294]">{uiText("可在同一文件中管理文档、表格、幻灯片、Base 与白板；进入编辑后使用官方完整功能区和文件侧栏。")}</p><button type="button" disabled={loading} onClick={() => void startOfficeEditing()} className="mt-4 rounded-xl bg-[#625bc5] px-4 py-2 text-[0.6875rem] font-bold text-white disabled:opacity-40">{uiText("打开完整编辑器")}</button></div></div> : null}
        {["extra","pending","unsupported"].includes(kind) ? <ExtraFilePreview key={item.id} id={item.id} name={item.name} info={info} error={fileState?.error} onOpen={()=>void onOpen(item)}/> : null}
      </div>
      {!embedded ? <div
        role="separator"
        aria-label={uiText("调整文件预览窗口大小")}
        aria-orientation="horizontal"
        title={uiText("拖动调整预览窗口大小")}
        onPointerDown={startPreviewResize}
        onPointerMove={movePreviewResize}
        onPointerUp={endPreviewResize}
        onPointerCancel={endPreviewResize}
        onLostPointerCapture={() => { previewResizeRef.current = undefined; }}
        className="modal-resize-handle absolute bottom-1 right-1 z-20 size-6 cursor-nwse-resize touch-none"
      >
        <span aria-hidden="true" className="pointer-events-none absolute bottom-1 right-1 size-3 border-b-2 border-r-2 border-[#777d91] opacity-80" />
      </div> : null}
      {libraryImagePickerOpen ? <ResourceLibraryPickerDialog
        ariaLabel={uiText("选择要插入编辑器的资料库图片")}
        title={uiText("从资料库插入图片")}
        description={uiText("支持 PNG、JPEG/JFIF、GIF、WebP、SVG、BMP、AVIF 和 TIFF；插入前会自动转换为编辑器可保存的格式。")}
        items={libraryImageItems}
        loading={libraryImageLoading}
        error={libraryImageError}
        selectableKinds={new Set<ResourceLibraryItem["kind"]>(["local_file"])}
        itemFilter={isUniverInsertableLibraryImage}
        maxSelected={1}
        confirmLabel={uiText("插入当前位置")}
        onClose={() => { setLibraryImagePickerOpen(false); libraryImageSelectionRef.current = undefined; }}
        onConfirm={insertLibraryImage}
      /> : null}
    </section>
  </div>;
}

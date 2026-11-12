import { l as uiText } from '../../../../src/i18n.js';
import { PageFeedback } from "./page-feedback.js";
import {
  ChevronDown,
  ChevronRight,
  Eye,
  FolderPlus,
  Search,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { ResourceLibraryItem } from "../../shared/resource-library-contract.js";
import { openResourceLibraryItem } from "../lib/resource-library-api.js";
import { ResourceLibraryPreviewer } from "./resource-library-previewer.js";
import { ResourceLibraryPermissionPicker } from './resource-library-permission-picker.js';
import { IconButton, Input } from './ui-controls.js';
import { ResourceLibraryPickerItemContent, ResourceLibraryPickerSelectionMark } from './resource-library-picker-parts.js';

export type ResourceLibraryPickerDialogProps = {
  ariaLabel: string;
  items: ResourceLibraryItem[];
  loading?: boolean;
  error?: string;
  title?: string;
  description?: string;
  selectableKinds?: ReadonlySet<ResourceLibraryItem["kind"]>;
  itemFilter?: (item: ResourceLibraryItem) => boolean;
  maxSelected?: number;
  confirmLabel?: string;
  /** Native nested-dialog mode for choosing existing access grants. */
  parentTitle?: string;
  initialSelectedIds?: readonly string[];
  allowEmpty?: boolean;
  onRetry?: () => void;
  portalHost?: HTMLElement | null;
  onCreateFolder?: (input: { name: string; parentId: string | null }) => Promise<ResourceLibraryItem>;
  onClose: () => void;
  onConfirm: (items: ResourceLibraryItem[]) => void | Promise<void>;
};

function LegacyResourceLibraryPickerDialog({
  ariaLabel,
  items,
  loading = false,
  error,
  title = uiText("从资料库添加"),
  description = uiText("按树状目录展开文件夹，勾选内容后统一确认添加。"),
  selectableKinds,
  itemFilter,
  maxSelected,
  confirmLabel = uiText("确认添加"),
  portalHost,
  onCreateFolder,
  onClose,
  onConfirm,
}: ResourceLibraryPickerDialogProps) {
  const [query, setQuery] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [previewItem, setPreviewItem] = useState<ResourceLibraryItem>();
  const [folderFormOpen, setFolderFormOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [folderCreating, setFolderCreating] = useState(false);
  const [folderCreateError, setFolderCreateError] = useState("");

  const selectedFolder = useMemo(() => {
    const id = selectedIds.at(-1);
    const item = id ? items.find((candidate) => candidate.id === id) : undefined;
    return item?.kind === "folder" || item?.kind === "local_folder" ? item : undefined;
  }, [items, selectedIds]);

  const filteredIds = useMemo(() => {
    if (!itemFilter) return undefined;
    const byId = new Map(items.map((item) => [item.id, item]));
    const visible = new Set<string>();
    for (const item of items) {
      if (!itemFilter(item)) continue;
      let current: ResourceLibraryItem | undefined = item;
      while (current && !visible.has(current.id)) {
        visible.add(current.id);
        current = current.parentId ? byId.get(current.parentId) : undefined;
      }
    }
    return visible;
  }, [itemFilter, items]);

  const visibleIds = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return filteredIds;
    const byId = new Map(items.map((item) => [item.id, item]));
    const visible = new Set<string>();
    for (const item of items) {
      if (filteredIds && !filteredIds.has(item.id)) continue;
      if (
        !`${item.name}\n${item.target ?? ""}\n${item.kind}\n${item.tags.join(" ")}`
          .toLowerCase()
          .includes(normalizedQuery)
      ) {
        continue;
      }
      let current: ResourceLibraryItem | undefined = item;
      while (current && !visible.has(current.id)) {
        visible.add(current.id);
        current = current.parentId ? byId.get(current.parentId) : undefined;
      }
    }
    return visible;
  }, [filteredIds, items, query]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || confirming || folderCreating) return;
      event.preventDefault();
      event.stopPropagation();
      if (previewItem) setPreviewItem(undefined);
      else if (folderFormOpen) {
        setFolderFormOpen(false);
        setFolderName("");
        setFolderCreateError("");
      }
      else onClose();
    };
    window.addEventListener("keydown", closeOnEscape, true);
    return () => window.removeEventListener("keydown", closeOnEscape, true);
  }, [confirming, folderCreating, folderFormOpen, onClose, previewItem]);

  const children = useMemo(() => {
    const value = new Map<string | null, ResourceLibraryItem[]>();
    for (const item of items) {
      const parentId = item.parentId ?? null;
      value.set(parentId, [...(value.get(parentId) ?? []), item]);
    }
    return value;
  }, [items]);

  const canSelect = (item: ResourceLibraryItem) =>
    (!selectableKinds || selectableKinds.has(item.kind)) && (!itemFilter || itemFilter(item));

  const toggleSelection = (item: ResourceLibraryItem) => {
    if (!canSelect(item)) {
      if (item.kind === "folder" || item.kind === "local_folder") {
        setExpandedIds((current) => {
          const next = new Set(current);
          if (next.has(item.id)) next.delete(item.id);
          else next.add(item.id);
          return next;
        });
      }
      return;
    }
    setSelectedIds((current) => {
      if (current.includes(item.id)) {
        return current.filter((id) => id !== item.id);
      }
      if (maxSelected !== undefined && current.length >= maxSelected) {
        return current;
      }
      return [...current, item.id];
    });
  };

  const renderLevel = (parentId: string | null, depth: number) =>
    (children.get(parentId) ?? [])
      .filter((item) => !visibleIds || visibleIds.has(item.id))
      .map((item) => {
        const folder = item.kind === "folder" || item.kind === "local_folder";
        const expanded = folder && (expandedIds.has(item.id) || Boolean(visibleIds));
        const selected = selectedIds.includes(item.id);
        const selectable = canSelect(item);
        const selectionLimitReached =
          maxSelected !== undefined &&
          selectedIds.length >= maxSelected &&
          !selected;
        return (
          <div
            key={item.id}
            role="treeitem"
            aria-expanded={folder ? expanded : undefined}
            aria-selected={selectable ? selected : undefined}
          >
            <div
              style={{ paddingLeft: `${depth * 18 + 6}px` }}
              className="library-picker-row"
              data-selected={selected}
            >
              {folder ? (
                <IconButton
                  size="toolbar"
                  variant="ghost"
                  aria-label={`${expanded ? uiText("收起") : uiText("展开")} ${item.name}`}
                  onClick={() =>
                    setExpandedIds((current) => {
                      const next = new Set(current);
                      if (next.has(item.id)) next.delete(item.id);
                      else next.add(item.id);
                      return next;
                    })
                  }
                  className="library-picker-toggle"
                >
                  {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </IconButton>
              ) : (
                <span className="library-picker-toggle-spacer" />
              )}
              <button
                type="button"
                aria-pressed={selectable ? selected : undefined}
                disabled={selectable && selectionLimitReached}
                onClick={() => toggleSelection(item)}
                onDoubleClick={() => {
                  if (folder) {
                    setExpandedIds((current) => {
                      const next = new Set(current);
                      if (next.has(item.id)) next.delete(item.id);
                      else next.add(item.id);
                      return next;
                    });
                  }
                }}
                className="library-picker-select"
                title={item.target || item.name}
              >
                <ResourceLibraryPickerItemContent item={item}/>
                {selectable ? <ResourceLibraryPickerSelectionMark selected={selected}/> : null}
              </button>
              {!folder ? (
                <IconButton
                  variant="ghost"
                  aria-label={uiText`预览 ${item.name}`}
                  title={uiText("预览")}
                  onClick={(event) => {
                    event.stopPropagation();
                    setPreviewItem(item);
                  }}
                  onDoubleClick={(event) => event.stopPropagation()}
                  className="library-picker-preview"
                >
                  <Eye size={14} />
                </IconButton>
              ) : null}
            </div>
            {expanded ? <div role="group">{renderLevel(item.id, depth + 1)}</div> : null}
          </div>
        );
      });

  const confirmSelection = async () => {
    const selected = selectedIds
      .map((id) => items.find((item) => item.id === id))
      .filter((item): item is ResourceLibraryItem => Boolean(item));
    if (selected.length === 0) return;
    setConfirming(true);
    try {
      await onConfirm(selected);
    } finally {
      setConfirming(false);
    }
  };

  const createFolder = async () => {
    const name = folderName.trim();
    if (!onCreateFolder || !name || folderCreating || confirming) return;
    setFolderCreating(true);
    setFolderCreateError("");
    try {
      const item = await onCreateFolder({ name, parentId: selectedFolder?.id ?? null });
      setQuery("");
      setExpandedIds((current) => {
        const next = new Set(current);
        if (item.parentId) next.add(item.parentId);
        return next;
      });
      if ((!selectableKinds || selectableKinds.has(item.kind)) && (!itemFilter || itemFilter(item))) {
        setSelectedIds([item.id]);
      }
      setFolderName("");
      setFolderFormOpen(false);
    } catch (reason) {
      setFolderCreateError(reason instanceof Error ? reason.message : uiText("文件夹创建失败，请重试。"));
    } finally {
      setFolderCreating(false);
    }
  };

  const empty = !loading && (visibleIds?.size === 0 || items.length === 0);

  const dialog = (
    <>
    <div className={`library-picker-mask ${portalHost ? "absolute" : "fixed"} inset-0 z-[22020] grid place-items-center bg-[#171b2a]/25 p-6 backdrop-blur-[2px]`}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        className="library-picker-dialog flex max-h-[72vh] w-full max-w-3xl flex-col rounded-3xl border border-white bg-white p-5 shadow-[0_24px_70px_rgba(30,34,54,.24)]"
      >
        <header className="moki-dialog-header moki-dialog-header-inset-5 mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-black text-[#242838]">{title}</h2>
            <p className="mt-0.5 text-[0.6875rem] text-[#858b9c]">{description}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {onCreateFolder ? (
              <button
                type="button"
                aria-label={uiText("新建资料库文件夹")}
                disabled={confirming || folderCreating}
                onClick={() => {
                  setFolderFormOpen((current) => !current);
                  setFolderName("");
                  setFolderCreateError("");
                }}
                className="flex h-8 items-center gap-1.5 rounded-xl border border-[#dedcf3] bg-[#f7f6ff] px-3 text-[0.6875rem] font-bold text-[#5f58bd] transition hover:border-[#c6c1ef] hover:bg-[#eeecff] disabled:opacity-40"
              >
                <FolderPlus size={14} />{uiText("新建文件夹")}</button>
            ) : null}
            <button
              type="button"
              aria-label={uiText("关闭资料库选择")}
              title={uiText("关闭")}
              disabled={confirming || folderCreating}
              onClick={onClose}
              className="grid size-8 place-items-center rounded-xl bg-[#f4f5f8] text-[#555c70] hover:bg-[#ebeafd] disabled:opacity-40"
            >
              <X size={15} />
            </button>
          </div>
        </header>
        {folderFormOpen && onCreateFolder ? (
          <form
            aria-label={uiText("新建资料库文件夹")}
            className="mb-3 rounded-2xl border border-[#dedcf3] bg-[#f8f7ff] p-3"
            onSubmit={(event) => {
              event.preventDefault();
              void createFolder();
            }}
          >
            <div className="flex items-center gap-2">
              <input
                autoFocus
                aria-label={uiText("新文件夹名称")}
                value={folderName}
                disabled={folderCreating}
                maxLength={240}
                onChange={(event) => setFolderName(event.target.value)}
                placeholder={uiText("输入文件夹名称")}
                className="h-9 min-w-0 flex-1 rounded-xl border border-[#d9d6ef] bg-white px-3 text-[0.75rem] outline-none focus:border-[#625bc5] disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!folderName.trim() || folderCreating || confirming}
                className="h-9 rounded-xl bg-[#242a40] px-4 text-[0.75rem] font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                {folderCreating ? uiText("创建中…") : uiText("创建")}
              </button>
            </div>
            <p className="mt-2 text-[0.625rem] text-[#858b9c]">{uiText("创建位置：")}{selectedFolder ? selectedFolder.name : uiText("资料库根目录")}
            </p>
            {folderCreateError ? <p role="alert" className="mt-1 text-[0.6875rem] font-semibold text-[#b33c63]">{folderCreateError}</p> : null}
          </form>
        ) : null}
        <label className="relative mb-3 block">
          <Search
            size={14}
            className="moki-ui-search-icon"
            aria-hidden="true"
          />
          <Input
            autoFocus={!folderFormOpen}
            aria-label={uiText("搜索资料库文件")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={uiText("搜索名称、路径或链接")}
            className="moki-ui-toolbar-search w-full"
          />
        </label>
        <div className="library-picker-tree flex-1">
          {loading ? (
            <PageFeedback layout="section" title={uiText("正在加载资料库")} description={uiText("读取可选择的文件和文件夹。")} skeleton="rows" />
          ) : (
            <div role="tree" aria-label={uiText("资料库树状目录")} aria-multiselectable="true">
              {renderLevel(null, 0)}
            </div>
          )}
          {empty ? (
            <p className="py-16 text-center text-[0.75rem] text-[#969bad]">
              {items.length ? uiText("没有匹配的资料。") : uiText("资料库为空，请先在侧边栏“资料库”页面添加映射。")}
            </p>
          ) : null}
        </div>
        {error ? (
          <p role="alert" className="mt-3 text-[0.6875rem] font-semibold text-[#b33c63]">
            {error}
          </p>
        ) : null}
        <footer className="mt-4 flex items-center justify-between border-t border-[#eceef4] pt-3">
          <span className="text-[0.6875rem] font-bold text-[#858b9c]">{uiText("已选择")}{selectedIds.length}{uiText("项")}{maxSelected !== undefined ? uiText` · 最多 ${maxSelected} 项` : ""}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setSelectedIds([])}
              disabled={selectedIds.length === 0 || confirming}
              className="rounded-xl bg-[#f4f5f8] px-4 py-2 text-[0.75rem] font-bold text-[#62687a] disabled:opacity-40"
            >{uiText("清除")}</button>
            <button
              type="button"
              onClick={() => void confirmSelection()}
              disabled={selectedIds.length === 0 || confirming}
              className="rounded-xl bg-[#242a40] px-4 py-2 text-[0.75rem] font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {confirming ? uiText("处理中…") : confirmLabel}
            </button>
          </div>
        </footer>
      </section>
    </div>
    {previewItem ? <ResourceLibraryPreviewer
      item={previewItem}
      onClose={() => setPreviewItem(undefined)}
      onOpen={(item) => openResourceLibraryItem(item.id)}
      layerClassName="z-[22040]"
      contained={Boolean(portalHost)}
    /> : null}
    </>
  );
  return portalHost ? createPortal(dialog, portalHost) : dialog;
}

export function ResourceLibraryPickerDialog(props: ResourceLibraryPickerDialogProps) {
  return props.parentTitle ? <ResourceLibraryPermissionPicker {...props}/> : <LegacyResourceLibraryPickerDialog {...props}/>;
}

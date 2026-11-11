import type { ResourceLibraryItem } from "../../shared/resource-library-contract.js";

function logicalPath(item: ResourceLibraryItem, byId: Map<string, ResourceLibraryItem>): string {
  const names: string[] = [];
  const seen = new Set<string>();
  let cursor: ResourceLibraryItem | undefined = item;
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    names.unshift(encodeURI(cursor.name).replaceAll("/", "%2F"));
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return `资料库/${names.join("/")}`;
}

export function resourceLibraryPath(item: ResourceLibraryItem | undefined, items: ResourceLibraryItem[]): string {
  if (!item) return "资料库/";
  if (item.target) return item.target;
  const byId = new Map(items.map((entry) => [entry.id, entry]));
  const path = logicalPath(item, byId);
  return items.filter((entry) => entry.name === item.name && logicalPath(entry, byId) === path).length > 1
    ? `moki://library/${encodeURIComponent(item.id)}` : path;
}

function normalizePath(value: string): string {
  let path = value.trim().replace(/^(["'])(.*)\1$/u, "$2");
  if (/^file:\/\//iu.test(path)) {
    try {
      const url = new URL(path);
      path = url.hostname ? `//${url.hostname}${decodeURIComponent(url.pathname)}` : decodeURIComponent(url.pathname).replace(/^\/([a-z]:)/iu, "$1");
    } catch { return path; }
  }
  path = path.replace(/\\/gu, "/").replace(/\/+$/u, "");
  return /^[a-z]:|^\/\//iu.test(path) ? path.toLocaleLowerCase("en-US") : path;
}

/** Resolve existing mappings only. Navigation must never create a mapping or copy a file. */
export function resolveResourceLibraryPath(value: string, items: ResourceLibraryItem[]): ResourceLibraryItem | null {
  const path = normalizePath(value);
  if (path === "资料库" || path === "/资料库" || path === "moki://library") return null;
  const byId = new Map(items.map((entry) => [entry.id, entry]));
  const candidates = items.filter((item) => {
    if (path === `moki://library/${encodeURIComponent(item.id)}`) return true;
    if (item.target && normalizePath(item.target) === path) return true;
    if (!/^\/?资料库\//u.test(path)) return false;
    const logical = logicalPath(item, byId);
    return path.replace(/^\//u, "") === logical || path.replace(/^\//u, "") === decodeURIComponent(logical);
  });
  if (candidates.length > 1) throw new Error("路径对应多个资料，请从文件夹列表选择具体位置。");
  if (!candidates[0]) throw new Error("未找到该资料库路径，请检查路径或先添加文件夹映射。");
  return candidates[0];
}

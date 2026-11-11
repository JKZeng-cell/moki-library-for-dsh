import { randomUUID } from "node:crypto";
import { realpathSync, statSync, lstatSync, existsSync, mkdirSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { resolve, relative, isAbsolute, dirname } from "node:path";
import type { ResourceLibraryItem } from "../shared/resource-library-contract.js";
export function isWithinFilesystemRoot(root: string, candidate: string): boolean { const relation = relative(root, candidate); return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation)); }
export function resolveAuthorizedFilesystemMutationTarget(
  root: ResourceLibraryItem,
  requestedPath: string,
  allowMissing: boolean,
): { rootPath: string; targetPath: string; relativePath: string } {
  if (!root.target || root.kind !== "local_folder") throw new Error("该授权不允许目录写入");
  if (!requestedPath || requestedPath.includes("\u0000") || isAbsolute(requestedPath)) {
    throw new Error("写入路径必须是授权目录内的非空相对路径");
  }
  const rootPath = realpathSync(root.target);
  if (!statSync(rootPath).isDirectory()) throw new Error("已授权目录当前不可用");
  const unresolved = resolve(rootPath, requestedPath);
  if (!isWithinFilesystemRoot(rootPath, unresolved)) throw new Error("目标路径超出已授权目录");
  if (unresolved === rootPath) throw new Error("写入操作不能修改授权根目录本身");
  const segments = relative(rootPath, unresolved).split(/[\\/]+/u).filter(Boolean);
  let current = rootPath;
  for (const segment of segments) {
    const candidate = resolve(current, segment);
    const linkMetadata = lstatSync(candidate, { throwIfNoEntry: false });
    if (linkMetadata?.isSymbolicLink()) throw new Error("写入操作不允许经过符号链接");
    if (!linkMetadata) {
      if (!allowMissing) throw new Error("目标文件或目录不存在");
      current = candidate;
      continue;
    }
    const metadata = lstatSync(candidate);
    if (metadata.isSymbolicLink()) throw new Error("写入操作不允许经过符号链接");
    current = candidate;
  }
  if (!isWithinFilesystemRoot(rootPath, current)) throw new Error("目标路径超出已授权目录");
  return { rootPath, targetPath: current, relativePath: relative(rootPath, current).replaceAll("\\", "/") };
}

export function writeFilesystemTextAtomically(path: string, content: string, overwrite: boolean): void {
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path)) {
    writeFileSync(path, content, { encoding: "utf8", flag: "wx" });
    return;
  }
  if (!overwrite) throw new Error("目标文件已存在；确认替换时请设置 overwrite=true");
  if (!statSync(path).isFile()) throw new Error("write_text 目标必须是文件");
  const suffix = randomUUID();
  const temporary = resolve(dirname(path), `.${suffix}.moki-write.tmp`);
  const backup = resolve(dirname(path), `.${suffix}.moki-write.backup`);
  writeFileSync(temporary, content, { encoding: "utf8", flag: "wx" });
  try {
    renameSync(path, backup);
    try {
      renameSync(temporary, path);
    } catch (error) {
      renameSync(backup, path);
      throw error;
    }
    rmSync(backup, { force: true });
  } finally {
    rmSync(temporary, { force: true });
  }
}


// Prefer the most specific explicitly configured physical folder, independent of virtual grouping.
export function folderAllowsWrite(items: ResourceLibraryItem[], path: string, includeDescendants = false, defaultWrite = false): boolean {
  if (includeDescendants && items.some(item => {
    if (item.kind !== "local_folder" || !item.target || item.assistantPermission !== "read_only") return false;
    try { return isWithinFilesystemRoot(path, realpathSync(item.target)); } catch { return false; }
  })) return false;
  const grants = items.flatMap(item => {
    if(item.kind !== "local_folder" || !item.target || !item.assistantPermission) return [];
    try { const root = realpathSync(item.target); return isWithinFilesystemRoot(root, path) ? [{root, permission:item.assistantPermission}] : []; } catch { return []; }
  }).sort((a,b)=>b.root.length-a.root.length);
  const closest=grants[0];
  if (!closest) return defaultWrite;
  return Boolean(closest && closest.permission === "write" && !grants.some(g=>g.root.length===closest.root.length && g.permission==="read_only"));
}

// Retain the previous destination until a move succeeds, so failed renames cannot lose it.
export function moveFilesystemEntry(source: string, destination: string, overwrite: boolean): void {
  if (isWithinFilesystemRoot(source, destination) || isWithinFilesystemRoot(destination, source)) throw Error("不能将文件夹移动到自身、子目录或覆盖父目录");
  if (existsSync(destination) && !overwrite) throw Error("目标已存在；确认替换时请设置 overwrite=true");
  mkdirSync(dirname(destination), { recursive: true });
  const backup = existsSync(destination) ? resolve(dirname(destination), `.${randomUUID()}.moki-move.backup`) : undefined;
  if (backup) renameSync(destination, backup);
  try { renameSync(source, destination); }
  catch (error) { if (backup) renameSync(backup, destination); throw error; }
  if (backup) rmSync(backup, { recursive: true, force: true });
}

import { openSync, readSync, closeSync, statSync, realpathSync } from "node:fs";
import { basename, resolve, relative, isAbsolute } from "node:path";
import type { ResourceLibraryItem } from "../shared/resource-library-contract.js";
export function readUtf8FileChunk(path: string, offset: number, maxBytes: number): {
  content: string;
  offset: number;
  nextOffset: number;
  totalBytes: number;
  complete: boolean;
} {
  const metadata = statSync(path);
  if (!metadata.isFile()) throw new Error("资料库映射目标不是文件");
  if (offset > metadata.size) throw new Error("读取偏移超过文件大小");
  const descriptor = openSync(path, "r");
  try {
    const buffer = Buffer.allocUnsafe(Math.min(maxBytes, metadata.size - offset));
    const bytesRead = readSync(descriptor, buffer, 0, buffer.length, offset);
    let usable = bytesRead;
    let content = "";
    for (let trim = 0; trim <= Math.min(3, bytesRead); trim += 1) {
      try {
        usable = bytesRead - trim;
        content = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, usable));
        break;
      } catch {
        if (trim === Math.min(3, bytesRead)) throw new Error("文件不是有效的 UTF-8 文本，无法按文本分块读取");
      }
    }
    return { content, offset, nextOffset: offset + usable, totalBytes: metadata.size, complete: offset + usable >= metadata.size };
  } finally {
    closeSync(descriptor);
  }
}

function filesystemPathKey(path: string): string {
  const normalized = resolve(path);
  return process.platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized;
}

function isWithinFilesystemRoot(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation));
}

export function resolveAuthorizedFilesystemTarget(
  root: ResourceLibraryItem,
  requestedPath: string,
): { rootPath: string; targetPath: string; relativePath: string } {
  if (!root.target || (root.kind !== "local_folder" && root.kind !== "local_file")) {
    throw new Error("文件系统授权不存在，请先在侧边工作区选择本地文件夹");
  }
  if (requestedPath.includes("\u0000") || isAbsolute(requestedPath)) {
    throw new Error("path 必须是授权目录内的相对路径");
  }
  const rootPath = realpathSync(root.target);
  const rootMetadata = statSync(rootPath);
  if (root.kind === "local_file") {
    if (requestedPath && requestedPath !== "." && requestedPath !== basename(rootPath)) {
      throw new Error("单文件授权只能读取该文件本身");
    }
    if (!rootMetadata.isFile()) throw new Error("已授权文件当前不可用");
    return { rootPath, targetPath: rootPath, relativePath: basename(rootPath) };
  }
  if (!rootMetadata.isDirectory()) throw new Error("已授权目录当前不可用");
  const unresolved = resolve(rootPath, requestedPath || ".");
  if (!isWithinFilesystemRoot(rootPath, unresolved)) {
    throw new Error("目标路径超出已授权目录");
  }
  const targetPath = realpathSync(unresolved);
  if (!isWithinFilesystemRoot(rootPath, targetPath)) {
    throw new Error("目标路径通过链接跳出了已授权目录");
  }
  return {
    rootPath,
    targetPath,
    relativePath: relative(rootPath, targetPath).replaceAll("\\", "/"),
  };
}


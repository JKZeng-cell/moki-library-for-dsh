import { randomUUID } from "node:crypto";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import type {
  ResourceLibraryCreate,
  ResourceLibraryFileCreate,
  ResourceLibraryItem,
} from "../shared/resource-library-contract.js";
import { markdownToDocx } from "./workbench-docx.js";
import { slidesToPptx } from "./workbench-pptx.js";
import { tableToXlsx } from "./workbench-xlsx.js";

export type ResourceLibraryFileWriter = {
  find(id: string): ResourceLibraryItem | undefined;
  create(input: ResourceLibraryCreate & {
    fileCreatedAt?: string | null;
    fileModifiedAt?: string | null;
  }): ResourceLibraryItem;
};

function resourceLibraryDisplayPath(
  library: ResourceLibraryFileWriter,
  item: ResourceLibraryItem,
): string {
  const names = [item.name];
  const visited = new Set<string>([item.id]);
  let parentId = item.parentId;
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = library.find(parentId);
    if (!parent) break;
    names.unshift(parent.name);
    parentId = parent.parentId;
  }
  return ["资料库", ...names].join(" / ");
}

export function generatedResourceFileBuffer(input: ResourceLibraryFileCreate): Buffer {
  if (input.format === "univer") throw new Error("原生 Univer 文件必须由官方 Gateway 初始化");
  if (input.format === "csv") {
    const escapeCell = (value: string | number | boolean | null): string => {
      const text = value === null ? "" : String(value);
      return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    };
    const structuredRows = [
      ...(input.columns?.length ? [input.columns] : []),
      ...(input.rows ?? []),
    ];
    const content = structuredRows.length
      ? `${structuredRows.map((row) => row.map(escapeCell).join(",")).join("\r\n")}\r\n`
      : input.content;
    return Buffer.from(content, "utf8");
  }
  if (input.format === "docx") return markdownToDocx({ title: input.name, content: input.content });
  if (input.format === "xlsx") {
    const fallbackRows = input.rows?.length
      ? input.rows
      : input.content.split(/\r?\n/u).filter(Boolean).map((line) => [line]);
    return tableToXlsx({ ...(input.columns ? { columns: input.columns } : {}), rows: fallbackRows });
  }
  if (input.format === "pptx") {
    return slidesToPptx({
      title: input.name,
      content: input.content,
      ...(input.slides ? { slides: input.slides } : {}),
    });
  }
  return Buffer.from(input.content, "utf8");
}

export function safeGeneratedResourceFileName(name: string, extension: string): string {
  const base = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "-")
    .replace(/[. ]+$/u, "")
    .trim() || "MOKI 输出";
  const withoutExtension = extname(base) ? base.slice(0, -extname(base).length) : base;
  return `${withoutExtension.slice(0, 180)}.${extension}`;
}

export async function createGeneratedResourceLibraryFile(
  library: ResourceLibraryFileWriter,
  stateDirectory: string,
  input: ResourceLibraryFileCreate,
  options: {
    createUniver?: (filePath: string, kind: "sheet" | "doc" | "slide" | "base" | "board", name: string) => Promise<void>;
    resolveVirtualFolderPath?: (parentId: string) => string | undefined;
  } = {},
): Promise<{ created: true; resourceType: "resource_library"; path: string; libraryPath: string; libraryUrl: string; item: ResourceLibraryItem }> {
  const parent = input.parentId ? library.find(input.parentId) : undefined;
  if (input.parentId && !parent) throw new Error("指定的资料库目录不存在");
  if (parent && parent.kind !== "folder" && parent.kind !== "local_folder") {
    throw new Error("指定的资料库位置不是文件夹");
  }
  const virtualFolderPath = parent?.kind === "folder"
    ? options.resolveVirtualFolderPath?.(parent.id)
    : undefined;
  const mappedDirectory = parent?.kind === "local_folder" && parent.target
    ? parent.target
    : virtualFolderPath;
  const managedDirectory = mappedDirectory
    ? undefined
    : join(stateDirectory, "library-generated", randomUUID());
  const destination = mappedDirectory ?? managedDirectory!;
  await mkdir(destination, { recursive: true });
  const extension = input.format === "markdown" ? "md" : input.format;
  const fileName = safeGeneratedResourceFileName(input.name, extension);
  const filePath = join(destination, fileName);
  let wroteFile = false;
  try {
    if (input.format === "univer") {
      if (!options.createUniver) throw new Error("Univer 文件运行时不可用");
      await options.createUniver(filePath, input.unitKind ?? "sheet", input.name);
    } else {
      await writeFile(filePath, generatedResourceFileBuffer(input), { flag: "wx" });
    }
    wroteFile = true;
    const metadata = await stat(filePath);
    const item = library.create({
      parentId: input.parentId ?? null,
      kind: "local_file",
      name: fileName,
      target: filePath,
      tags: input.tags,
      fileCreatedAt: metadata.birthtime.toISOString(),
      fileModifiedAt: metadata.mtime.toISOString(),
    });
    return {
      created: true,
      resourceType: "resource_library",
      path: filePath,
      libraryPath: resourceLibraryDisplayPath(library, item),
      libraryUrl: `/library?itemId=${encodeURIComponent(item.id)}`,
      item,
    };
  } catch (error) {
    if (wroteFile) await rm(filePath, { force: true });
    if (managedDirectory) await rm(managedDirectory, { recursive: true, force: true });
    throw error;
  }
}

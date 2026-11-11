import { EditorDraftStore } from "../../documents/editor-draft-store.js";
import {inspectPreviewFile,byteRange} from '../../../../src/preview-files.mjs';
import {readZipParts} from '../../../../src/preview-archive.mjs';
import { deleteResourceLibrarySource } from "../services/resource-library-source-delete.js";
import { fileContentVersion, FileEditConflict, withFileEdit } from "../../documents/file-edit-guard.js";
import { replaceFileAtomically } from "../../documents/workbench-office-editor.js";
import { EDITABLE_TEXT_EXTENSIONS } from "../../shared/editable-text.js";
import { createHash, randomUUID } from "node:crypto";
import { constants, createReadStream, statSync } from "node:fs";
import { copyFile, lstat, mkdir, open, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, normalize, relative, resolve, isAbsolute } from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { parseAppleOfficePreview, parseLegacyPresentationPreview, parseOfficePreview, parsePdfPreview } from "../../documents/workbench-file-preview.js";
import { parseLegacyWordPreview } from "../../documents/legacy-word-preview.js";
import { createGeneratedResourceLibraryFile } from "../../documents/resource-library-file-creator.js";
import { saveOfficeContentUpdate } from "../../documents/workbench-office-editor.js";
import { UniverOfficeRuntime } from "../../documents/univer-office-runtime.js";
import {
  recognizeWithDeepSeekOcr,
  verifyDeepSeekOcr,
  type DeepSeekOcrConfiguration,
} from "../../documents/deepseek-ocr-client.js";
import {
  ResourceLibraryCreateSchema,
  AssistantMediaSaveSchema,
  ResourceLibraryContentUpdateSchema,
  ResourceLibraryExportSchema,
  ResourceLibraryFileCreateSchema,
  ResourceLibraryMoveSchema,
  ResourceLibraryOfficeContentUpdateSchema,
  ResourceLibraryUpdateSchema,
  WhiteboardFolderExportSchema,
  type ResourceLibraryItem,
} from "../../shared/resource-library-contract.js";
import { ASSISTANT_MAX_ATTACHMENT_BYTES } from "../../shared/assistant-contract.js";
import { UNIVER_LIBRARY_IMAGE_FORMATS_LABEL, isUniverLibraryImageName } from "../../shared/univer-image-contract.js";
import type { SettingsSectionValues } from "../../shared/settings-contract.js";
import type {
  ResourceLibraryIndexedEntry,
  ResourceLibraryRepository,
} from "../repositories/resource-library-repository.js";
import { stageAssistantAttachmentFromLocalFile } from "../services/assistant-attachment-staging.js";

const paramsSchema = z.object({ id: z.string().uuid() });
const officeSessionParamsSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
});
const officeSessionSaveAsSchema = z.object({
  destination: z.string().trim().min(1).optional(),
});
const officeSessionImageInsertSchema = z.object({
  imageId: z.string().uuid(),
  unitId: z.string().trim().min(1).optional(),
  slideId: z.string().trim().min(1).optional(),
  sheetId: z.string().trim().min(1).optional(),
  startOffset: z.number().int().nonnegative().optional(),
  endOffset: z.number().int().nonnegative().optional(),
  segmentId: z.string().max(240).optional(),
  row: z.number().int().nonnegative().max(1_000_000).optional(),
  column: z.number().int().nonnegative().max(100_000).optional(),
  left: z.number().finite().min(0).max(100_000).optional(),
  top: z.number().finite().min(0).max(100_000).optional(),
  width: z.number().finite().positive().max(100_000).optional(),
  height: z.number().finite().positive().max(100_000).optional(),
}).strict();
const assistantMediaActionSchema = z.object({
  sourceUrl: z.string().trim().min(1).max(4_000),
}).strict();
const MAX_EDITABLE_CONTENT_BYTES = 5_000_000;
const MAX_STRUCTURED_PREVIEW_BYTES = 256 * 1024 * 1024;
// The Univer importer serializes Office media into one JSON snapshot. A
// 384 MiB source with mostly uncompressed media already exceeds Node's
// ~512 MiB maximum string length once base64 encoded. Preview is unaffected.
const MAX_UNIVER_EMBEDDED_EDIT_SOURCE_BYTES = 384 * 1024 * 1024;
const SYSTEM_OFFICE_EDIT_MESSAGE = "该文件的媒体内容超出内嵌编辑器可安全处理的范围，将使用系统应用编辑原文件；完整预览仍可使用。";

function isUniverImportCapacityError(error: unknown): boolean {
  return error instanceof Error && /Cannot create a string longer than|Invalid string length/u.test(error.message);
}
class StructuredPreviewTooLargeError extends Error {
  constructor() {
    super("此格式需要整体解析，已超出 256 MiB 解析容量，请使用默认应用打开；流式预览不受此限制");
  }
}
const MAX_IMPORTED_FOLDER_ENTRIES_PER_LEVEL = 250_000;
const MAX_OCR_PAGE_IMAGE_DATA_URL_LENGTH = 16_000_000;
const deepSeekOcrPageSchema = z.object({
  pageNumber: z.number().int().min(1).max(100),
  imageDataUrl: z.string().min(32).max(MAX_OCR_PAGE_IMAGE_DATA_URL_LENGTH)
    .regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/u, "OCR 页面图像格式无效"),
});
const MIME_TYPES: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".jpe": "image/jpeg", ".jfif": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml", ".bmp": "image/bmp", ".avif": "image/avif", ".tif": "image/tiff", ".tiff": "image/tiff", ".ico": "image/x-icon",
  ".pdf": "application/pdf", ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8", ".markdown": "text/markdown; charset=utf-8", ".log": "text/plain; charset=utf-8", ".json": "application/json",
  ".mp4": "video/mp4", ".webm": "video/webm", ".m4v": "video/x-m4v", ".ogv": "video/ogg", ".mp3": "audio/mpeg",
  ".wav": "audio/wav", ".flac": "audio/flac", ".aac": "audio/aac", ".m4a": "audio/mp4", ".ogg": "audio/ogg",
  ".csv": "text/csv; charset=utf-8", ".tsv": "text/tab-separated-values; charset=utf-8", ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".xml": "application/xml", ".yaml": "text/yaml; charset=utf-8", ".yml": "text/yaml; charset=utf-8",
  ".doc": "application/msword", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint", ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".key": "application/vnd.apple.keynote", ".pages": "application/vnd.apple.pages", ".numbers": "application/vnd.apple.numbers",
  ".zip": "application/zip",
};
const WHITEBOARD_ASSET_EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp",
  "image/svg+xml": ".svg", "image/bmp": ".bmp", "image/avif": ".avif", "image/tiff": ".tiff",
  "video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm", "video/ogg": ".ogv", "video/x-matroska": ".mkv",
  "audio/mpeg": ".mp3", "audio/wav": ".wav", "audio/mp4": ".m4a", "audio/aac": ".aac",
  "audio/ogg": ".ogg", "audio/opus": ".opus", "audio/flac": ".flac",
};

const STRUCTURED_PREVIEW_EXTENSIONS = new Set([".doc", ".docx", ".xlsx", ".csv", ".tsv", ".ppt", ".pptx", ".key", ".pages", ".numbers", ".pdf"]);

async function readStructuredPreviewContents(item: ResourceLibraryItem, extension: string, fetchResource?: typeof fetch): Promise<Uint8Array> {
  const maxBytes = [".ppt", ".pptx"].includes(extension) ? Number.POSITIVE_INFINITY : MAX_STRUCTURED_PREVIEW_BYTES;
  if (item.kind === "url") {
    const response = await (fetchResource ?? fetch)(item.target!, { redirect: "follow", signal: AbortSignal.timeout(Number.isFinite(maxBytes) ? 20_000 : 300_000) });
    if (!response.ok) throw new Error(`在线 Office 文件读取失败（HTTP ${response.status}）`);
    const declaredSize = Number(response.headers.get("content-length") ?? 0);
    if (declaredSize > maxBytes) throw new StructuredPreviewTooLargeError();
    const contents = new Uint8Array(await response.arrayBuffer());
    if (contents.byteLength > maxBytes) throw new StructuredPreviewTooLargeError();
    return contents;
  }
  const target = item.target!;
  const file = await stat(target);
  if (file.isFile()) {
    if (file.size > maxBytes) throw new StructuredPreviewTooLargeError();
    return readFile(target);
  }
  if (!file.isDirectory() || ![".key", ".pages", ".numbers"].includes(extension)) throw new Error("映射目标不是文件");
  const preferred = ["index.zip", "index.apxl", "index.xml", "index.json"];
  const queue = [target];
  let scanned = 0;
  while (queue.length && scanned < 2_000) {
    const directory = queue.shift()!;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      scanned += 1;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) { queue.push(path); continue; }
      if (preferred.includes(entry.name.toLowerCase()) || /\.(?:zip|apxl|xml|json)$/iu.test(entry.name)) {
        const candidate = await stat(path);
        if (candidate.size <= MAX_STRUCTURED_PREVIEW_BYTES) return readFile(path);
      }
    }
  }
  throw new Error("Apple 办公文件结构不完整");
}

function safeExportName(value: string, fallback = "资料"): string {
  const sanitized = value.replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "_").replace(/[. ]+$/gu, "").trim();
  return sanitized || fallback;
}

function whiteboardAssetExportName(fileName: string, mimeType?: string): string {
  const safeName = safeExportName(fileName, "画布素材");
  const normalizedMime = mimeType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  const expectedExtension = WHITEBOARD_ASSET_EXTENSION_BY_MIME[normalizedMime];
  if (!expectedExtension) return safeName;
  const currentExtension = extname(safeName).toLowerCase();
  if (!currentExtension) return `${safeName}${expectedExtension}`;
  const currentMime = MIME_TYPES[currentExtension]?.split(";", 1)[0]?.trim().toLowerCase();
  return currentMime && currentMime !== normalizedMime
    ? `${safeName.slice(0, -currentExtension.length)}${expectedExtension}`
    : safeName;
}

function assistantMediaSourcePath(
  sourceUrl: string,
  mediaDirectory?: string,
  attachmentDirectory?: string,
): string | undefined {
  let pathname: string;
  try {
    const parsed = new URL(sourceUrl, "http://moki.local");
    if (parsed.origin !== "http://moki.local") return undefined;
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    return undefined;
  }
  const mediaMatch = pathname.match(/^\/api\/assistant\/media\/([A-Za-z0-9_-]+\.[A-Za-z0-9]+)$/u);
  if (mediaMatch && mediaDirectory) return join(mediaDirectory, mediaMatch[1]!);
  const attachmentMatch = pathname.match(
    /^\/api\/assistant\/attachments\/([A-Za-z0-9_-]+)\/(?:([A-Za-z0-9_-]+)\/)?([^/]+)$/u,
  );
  if (!attachmentMatch || !attachmentDirectory) return undefined;
  const fileName = safeExportName(attachmentMatch[3]!, "附件");
  if (fileName !== attachmentMatch[3]) return undefined;
  return attachmentMatch[2]
    ? join(attachmentDirectory, attachmentMatch[1]!, attachmentMatch[2], fileName)
    : join(attachmentDirectory, attachmentMatch[1]!, fileName);
}

function assistantMediaResource(path: string): ResourceLibraryItem {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    parentId: null,
    kind: "local_file",
    name: basename(path),
    target: path,
    tags: [],
    createdAt: now,
    updatedAt: now,
  };
}

function exportFileName(item: ResourceLibraryItem): string {
  const sourceName = attachmentName(item);
  const sourceExtension = extname(sourceName);
  const displayName = safeExportName(item.name);
  return sourceExtension && !displayName.toLocaleLowerCase().endsWith(sourceExtension.toLocaleLowerCase())
    ? `${displayName}${sourceExtension}`
    : displayName;
}

function attachmentName(item: ResourceLibraryItem): string {
  if (!item.target) return item.name;
  if (item.kind === "url") {
    try {
      const segment = new URL(item.target).pathname.split("/").filter(Boolean).at(-1);
      return segment ? decodeURIComponent(segment) : item.name;
    } catch {
      return item.name;
    }
  }
  return basename(item.target) || item.name;
}

function attachmentHeaders(reply: FastifyReply, name: string) {
  return reply
    .header("cache-control", "no-store")
    .header("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
}

type FolderIndexJob = {
  itemId: string;
  status: "queued" | "indexing" | "completed" | "error";
  phase: "scanning" | "mapping" | "completed";
  total: number;
  processed: number;
  added: number;
  updated: number;
  removed: number;
  startedAt: string;
  finishedAt?: string;
  error?: string;
};

const folderNameOrder = new Intl.Collator("zh-CN", { numeric: true });

async function collectLocalFolderLevel(rootPath: string, job: FolderIndexJob): Promise<ResourceLibraryIndexedEntry[]> {
  const root = statSync(rootPath);
  if (!root.isDirectory()) throw new Error("选择的本地路径不是文件夹");
  const children = (await readdir(rootPath, { withFileTypes: true }))
    .filter((child) => !child.isSymbolicLink() && (child.isDirectory() || child.isFile()))
    .sort((left, right) => folderNameOrder.compare(left.name, right.name));
  if (children.length > MAX_IMPORTED_FOLDER_ENTRIES_PER_LEVEL) {
    throw new Error(`单层目录最多同步 ${MAX_IMPORTED_FOLDER_ENTRIES_PER_LEVEL} 个文件和文件夹`);
  }
  job.total = children.length;
  job.processed = 0;
  const entries: ResourceLibraryIndexedEntry[] = [];
  const batchSize = 64;
  for (let offset = 0; offset < children.length; offset += batchSize) {
    const batch = children.slice(offset, offset + batchSize);
    const resolved = await Promise.all(batch.map(async (child) => {
      const target = join(rootPath, child.name);
      const metadata = await stat(target).catch(() => null);
      return {
        kind: child.isDirectory() ? "local_folder" as const : "local_file" as const,
        name: child.name,
        target,
        parentTarget: null,
        fileCreatedAt: metadata?.birthtime?.toISOString() ?? null,
        fileModifiedAt: metadata?.mtime?.toISOString() ?? null,
      };
    }));
    entries.push(...resolved);
    job.processed = entries.length;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  return entries;
}

export async function registerResourceLibraryRoutes(
  app: FastifyInstance,
  options: {
    repository: ResourceLibraryRepository;
    onIndexChanged?: (folderId: string) => void;
    getTextDrafts?: () => EditorDraftStore;
    openResource?: (item: ResourceLibraryItem) => Promise<void>;
    revealResource?: (item: ResourceLibraryItem) => Promise<void>;
    fetchResource?: typeof fetch;
    stateDirectory?: string;
    getChatAnalysisSettings?: () => SettingsSectionValues["chatAnalysis"];
    ocrFetch?: typeof fetch;
    findWhiteboardAsset?: (id: string) => { fileName: string; mimeType?: string; content: Buffer } | undefined;
    assistantMediaDirectory?: string;
    assistantAttachmentDirectory?: string;
    univerOfficeRuntime?: UniverOfficeRuntime;
  },
): Promise<void> {
  const folderJobs = new Map<string, FolderIndexJob>();
  const lastFolderScan = new Map<string, number>();
  const ownsUniverOffice = options.univerOfficeRuntime === undefined;
  const univerOffice = options.univerOfficeRuntime ?? (options.stateDirectory
    ? new UniverOfficeRuntime(options.stateDirectory)
    : undefined);
  if (ownsUniverOffice) {
    app.addHook("onClose", async () => {
      await univerOffice?.close();
    });
  }

  // Browser uploads become managed working copies; the request cannot choose a destination.
  app.post("/api/library/workspace-files", { bodyLimit: Math.ceil(ASSISTANT_MAX_ATTACHMENT_BYTES / 3) * 4 + 4096 }, async (request, reply) => {
    const host = request.headers.host ?? "";
    const origin = request.headers.origin;
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/u.test(host) || request.headers["x-moki-library-upload"] !== "1" ||
        (origin && !new Set([`http://${host}`, "http://127.0.0.1:4310", "http://localhost:4310"]).has(origin))) {
      return reply.code(403).send({ error: "文件导入仅接受本机工作台请求" });
    }
    if (!options.stateDirectory) return reply.code(503).send({ error: "文件存储暂不可用" });
    const parsed = z.object({ parentId: z.string().uuid().nullable().optional(), name: z.string().trim().min(1).max(240), size: z.number().int().min(0).max(ASSISTANT_MAX_ATTACHMENT_BYTES),
      dataUrl: z.string().max(Math.ceil(ASSISTANT_MAX_ATTACHMENT_BYTES / 3) * 4 + 256) }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "文件格式无效或超过 32MB" });
    const match = /^data:[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+;base64,([A-Za-z0-9+/]*={0,2})$/u.exec(parsed.data.dataUrl);
    if (!match) return reply.code(400).send({ error: "文件编码无效" });
    const bytes = Buffer.from(match[1]!, "base64");
    if (bytes.length !== parsed.data.size || bytes.toString("base64") !== match[1]) return reply.code(400).send({ error: "文件长度或编码不匹配" });
    const name = safeExportName(parsed.data.name);
    // Reject reserved Windows device names as well as traversal/path separators.
    if (name !== parsed.data.name || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(name)) return reply.code(400).send({ error: "文件名无效" });
    const parent = parsed.data.parentId ? options.repository.find(parsed.data.parentId) : undefined;
    if (parent?.kind === "local_folder" && parent.target) {
      const target = join(parent.target,name);
      let created = false;
      try {
        const folder = await lstat(parent.target);
        if (!folder.isDirectory() || folder.isSymbolicLink()) throw new Error("目标文件夹不可用");
        const handle = await open(target,"wx");
        created = true;
        try { await handle.writeFile(bytes); } finally { await handle.close(); }
        const item = options.repository.create({kind:"local_file",name,target,parentId:parent.id,tags:[]});
        return reply.code(201).send(item);
      } catch (error) {
        if (created) await rm(target,{force:true});
        return reply.code(400).send({error:error instanceof Error ? error.message : "复制文件失败"});
      }
    }
    const directory = join(options.stateDirectory, "resource-library-files", randomUUID());
    try {
      await mkdir(directory, { recursive: true });
      const target = join(directory, name);
      await writeFile(target, bytes, { flag: "wx" });
      const item = options.repository.create({ kind: "local_file", name, target, parentId: parsed.data.parentId ?? null, tags: [] });
      return reply.code(201).send(item);
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      return reply.code(400).send({ error: error instanceof Error ? error.message : "文件导入失败" });
    }
  });

  app.post("/api/library/files", async (request, reply) => {
    const body = ResourceLibraryFileCreateSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.issues[0]?.message ?? "新建文件参数无效" });
    }
    if (!options.stateDirectory) return reply.code(503).send({ error: "资料库文件存储目录不可用" });
    try {
      return await createGeneratedResourceLibraryFile(options.repository, options.stateDirectory, body.data, {
        ...(univerOffice ? {
          createUniver: (filePath, kind, name) => univerOffice.createNativeFile(filePath, kind, name).then(() => undefined),
        } : {}),
      });
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "资料库文件创建失败" });
    }
  });

  app.post("/api/library/assistant-media/save", async (request, reply) => {
    const body = AssistantMediaSaveSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.issues[0]?.message ?? "附件保存参数无效" });
    }
    const sourcePath = assistantMediaSourcePath(
      body.data.sourceUrl,
      options.assistantMediaDirectory,
      options.assistantAttachmentDirectory,
    );
    if (!sourcePath) {
      return reply.code(400).send({ error: "只支持保存当前会话中由 MOKI 管理的附件" });
    }
    const sourceStat = await stat(sourcePath).catch(() => null);
    if (!sourceStat?.isFile()) return reply.code(404).send({ error: "附件文件不存在" });
    if (sourceStat.size > ASSISTANT_MAX_ATTACHMENT_BYTES) {
      return reply.code(413).send({ error: "单个附件不能超过 32 MB" });
    }
    const fileName = safeExportName(body.data.name, basename(sourcePath) || "附件");
    if (body.data.mode === "local") {
      const destination = body.data.destination!;
      await mkdir(dirname(destination), { recursive: true });
      if (normalize(destination).toLocaleLowerCase() !== normalize(sourcePath).toLocaleLowerCase()) {
        await copyFile(sourcePath, destination);
      }
      return { saved: true, path: destination };
    }
    if (!options.stateDirectory) {
      return reply.code(503).send({ error: "资料库文件存储目录不可用" });
    }
    const storedDirectory = join(options.stateDirectory, "resource-library-files", randomUUID());
    const destination = join(storedDirectory, fileName);
    await mkdir(storedDirectory, { recursive: true });
    await copyFile(sourcePath, destination);
    try {
      const item = options.repository.create({
        parentId: body.data.parentId ?? null,
        kind: "local_file",
        name: fileName,
        target: destination,
        tags: [],
        fileCreatedAt: sourceStat.birthtime.toISOString(),
        fileModifiedAt: sourceStat.mtime.toISOString(),
      });
      return { saved: true, path: destination, item };
    } catch (error) {
      await rm(storedDirectory, { recursive: true, force: true });
      throw error;
    }
  });
  app.post("/api/library/assistant-media/open", async (request, reply) => {
    const body = assistantMediaActionSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "附件打开参数无效" });
    const sourcePath = assistantMediaSourcePath(
      body.data.sourceUrl,
      options.assistantMediaDirectory,
      options.assistantAttachmentDirectory,
    );
    if (!sourcePath) return reply.code(400).send({ error: "只支持打开当前会话中由 MOKI 管理的附件" });
    const sourceStat = await stat(sourcePath).catch(() => null);
    if (!sourceStat?.isFile()) return reply.code(404).send({ error: "附件文件不存在" });
    if (!options.openResource) return reply.code(503).send({ error: "请在 MOKI 客户端中调用默认应用打开" });
    try {
      await options.openResource(assistantMediaResource(sourcePath));
      return { opened: true };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "附件打开失败" });
    }
  });
  app.post("/api/library/assistant-media/reveal", async (request, reply) => {
    const body = assistantMediaActionSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "附件定位参数无效" });
    const sourcePath = assistantMediaSourcePath(
      body.data.sourceUrl,
      options.assistantMediaDirectory,
      options.assistantAttachmentDirectory,
    );
    if (!sourcePath) return reply.code(400).send({ error: "只支持定位当前会话中由 MOKI 管理的附件" });
    const sourceStat = await stat(sourcePath).catch(() => null);
    if (!sourceStat?.isFile()) return reply.code(404).send({ error: "附件文件不存在" });
    if (!options.revealResource) return reply.code(503).send({ error: "请在 MOKI 客户端中打开资源管理器" });
    try {
      await options.revealResource(assistantMediaResource(sourcePath));
      return { revealed: true };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "附件定位失败" });
    }
  });

  const deepSeekOcrConfiguration = (): DeepSeekOcrConfiguration => {
    const settings = options.getChatAnalysisSettings?.();
    return {
      enabled: settings?.deepseekOcrEnabled ?? false,
      baseUrl: settings?.deepseekOcrBaseUrl ?? "http://127.0.0.1:8000/v1",
      model: settings?.deepseekOcrModel ?? "deepseek-ai/DeepSeek-OCR",
      timeoutSeconds: settings?.deepseekOcrTimeoutSeconds ?? 300,
      ...(settings?.deepseekOcrApiKey !== undefined ? { apiKey: settings.deepseekOcrApiKey } : {}),
    };
  };

  const downloadUrl = async (url: string, destination: string): Promise<void> => {
    const response = await (options.fetchResource ?? fetch)(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`在线文件读取失败（HTTP ${response.status}）`);
    await writeFile(destination, Buffer.from(await response.arrayBuffer()));
  };

  const copyDirectory = async (source: string, destination: string): Promise<{ files: number; folders: number }> => {
    const sourceMetadata = await stat(source);
    if (!sourceMetadata.isDirectory()) throw new Error("映射目标不是文件夹");
    await mkdir(destination, { recursive: false });
    let files = 0;
    let folders = 1;
    for (const entry of await readdir(source, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const sourcePath = join(source, entry.name);
      const destinationPath = join(destination, safeExportName(entry.name, "未命名资料"));
      if (entry.isDirectory()) {
        const result = await copyDirectory(sourcePath, destinationPath);
        files += result.files;
        folders += result.folders;
      } else if (entry.isFile()) {
        await copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL);
        files += 1;
      }
    }
    return { files, folders };
  };

  const exportItemIntoFolder = async (item: ResourceLibraryItem, destinationParent: string): Promise<{ files: number; folders: number }> => {
    if (item.kind === "local_folder" && item.target) {
      return copyDirectory(item.target, join(destinationParent, safeExportName(item.name, "资料夹")));
    }
    if (item.kind === "folder") {
      const destination = join(destinationParent, safeExportName(item.name, "资料夹"));
      await mkdir(destination, { recursive: false });
      let files = 0;
      let folders = 1;
      const children = options.repository.list().filter((candidate) => candidate.parentId === item.id);
      for (const child of children) {
        const result = await exportItemIntoFolder(child, destination);
        files += result.files;
        folders += result.folders;
      }
      return { files, folders };
    }
    if (!item.target) throw new Error(`资料“${item.name}”没有可读取的来源`);
    const destination = join(destinationParent, exportFileName(item));
    if (item.kind === "local_file") await copyFile(item.target, destination, constants.COPYFILE_EXCL);
    else await downloadUrl(item.target, destination);
    return { files: 1, folders: 0 };
  };

  const richTextValue = (value: unknown): string => {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map(richTextValue).filter(Boolean).join("\n");
    if (!value || typeof value !== "object") return "";
    const record = value as Record<string, unknown>;
    if (typeof record.text === "string") return record.text;
    return richTextValue(record.content);
  };

  const whiteboardAssetLookupIds = (assetRecord: Record<string, unknown>): string[] => {
    const candidates: string[] = [];
    const props = assetRecord.props && typeof assetRecord.props === "object"
      ? assetRecord.props as Record<string, unknown>
      : {};
    if (typeof props.src === "string") {
      try {
        const pathname = new URL(props.src, "http://moki.local").pathname;
        const storedAsset = /^\/api\/whiteboard\/assets\/([a-f0-9]{64})$/iu.exec(pathname);
        if (storedAsset?.[1]) candidates.push(storedAsset[1]);
      } catch {
        // Fall back to the document asset id for historical records.
      }
    }
    if (typeof assetRecord.id === "string" && assetRecord.id) candidates.push(assetRecord.id);
    return [...new Set(candidates)];
  };

  const writeWhiteboardFolder = async (
    destination: string,
    input: z.infer<typeof WhiteboardFolderExportSchema>,
  ): Promise<{ files: number; folders: number }> => {
    await mkdir(destination, { recursive: false });
    let files = 0;
    let folders = 1;
    await writeFile(join(destination, "资料夹说明.md"), `# ${input.name}\n\n${input.description || "暂无描述"}\n`, "utf8");
    await writeFile(join(destination, "白板内容.moki.json"), JSON.stringify({ name: input.name, description: input.description, ...input.payload }, null, 2), "utf8");
    files += 2;
    const materialDirectory = join(destination, "素材");
    let materialDirectoryCreated = false;
    const ensureMaterialDirectory = async () => {
      if (materialDirectoryCreated) return;
      await mkdir(materialDirectory, { recursive: false });
      materialDirectoryCreated = true;
      folders += 1;
    };
    const writtenAssets = new Set<string>();
    for (const [index, assetRecord] of input.payload.assets.entries()) {
      const resolvedAsset = whiteboardAssetLookupIds(assetRecord)
        .map((id) => ({ id, asset: options.findWhiteboardAsset?.(id) }))
        .find((entry) => Boolean(entry.asset));
      if (!resolvedAsset?.asset || writtenAssets.has(resolvedAsset.id)) continue;
      writtenAssets.add(resolvedAsset.id);
      await ensureMaterialDirectory();
      const name = `${String(index + 1).padStart(3, "0")}-${whiteboardAssetExportName(
        resolvedAsset.asset.fileName,
        resolvedAsset.asset.mimeType,
      )}`;
      await writeFile(join(materialDirectory, name), resolvedAsset.asset.content, { flag: "wx" });
      files += 1;
    }
    const textBlocks: string[] = [];
    const resourceIds = new Set<string>();
    let linkIndex = 0;
    for (const shape of input.payload.shapes) {
      const props = shape.props && typeof shape.props === "object" ? shape.props as Record<string, unknown> : {};
      const text = [props.text, props.richText, props.title].map(richTextValue).filter(Boolean).join("\n").trim();
      if (text) textBlocks.push(text);
      const libraryItemId = typeof props.libraryItemId === "string" ? props.libraryItemId : "";
      if (libraryItemId) resourceIds.add(libraryItemId);
      const url = typeof props.url === "string" && /^https?:\/\//iu.test(props.url) ? props.url : "";
      if (url) {
        await ensureMaterialDirectory();
        linkIndex += 1;
        const title = safeExportName(typeof props.title === "string" ? props.title : `链接-${linkIndex}`, `链接-${linkIndex}`);
        await writeFile(join(materialDirectory, `${String(linkIndex).padStart(3, "0")}-${title}.url`), `[InternetShortcut]\r\nURL=${url}\r\n`, { encoding: "utf8", flag: "wx" });
        files += 1;
      }
    }
    if (textBlocks.length) {
      await writeFile(join(destination, "文字内容.md"), textBlocks.map((text, index) => `## 内容 ${index + 1}\n\n${text}`).join("\n\n"), "utf8");
      files += 1;
    }
    let resourceIndex = 0;
    for (const libraryItemId of resourceIds) {
      const item = options.repository.find(libraryItemId);
      if (!item) continue;
      await ensureMaterialDirectory();
      resourceIndex += 1;
      const wrapper = join(materialDirectory, `资料-${String(resourceIndex).padStart(3, "0")}`);
      await mkdir(wrapper, { recursive: false });
      folders += 1;
      const result = await exportItemIntoFolder(item, wrapper);
      files += result.files;
      folders += result.folders;
    }
    return { files, folders };
  };

  const startFolderIndex = (root: ResourceLibraryItem, force = false): FolderIndexJob => {
    const existing = folderJobs.get(root.id);
    if (existing && (existing.status === "queued" || existing.status === "indexing")) return existing;
    const lastScan = lastFolderScan.get(root.id) ?? 0;
    if (!force && Date.now() - lastScan < 30_000) {
      return existing ?? {
        itemId: root.id,
        status: "completed",
        phase: "completed",
        total: 0,
        processed: 0,
        added: 0,
        updated: 0,
        removed: 0,
        startedAt: new Date(lastScan || Date.now()).toISOString(),
      };
    }
    const job: FolderIndexJob = {
      itemId: root.id,
      status: "queued",
      phase: "scanning",
      total: 0,
      processed: 0,
      added: 0,
      updated: 0,
      removed: 0,
      startedAt: new Date().toISOString(),
    };
    folderJobs.set(root.id, job);
    void (async () => {
      try {
        job.status = "indexing";
        // Index exactly one directory level. Child folders are indexed only
        // when the user opens them, so adding a large tree stays responsive.
        const scannedEntries = await collectLocalFolderLevel(root.target ?? "", job);
        const excludedTargets = options.repository.listLocalFolderExclusionTargets(root.id);
        const entries = scannedEntries.filter((entry) => {
          const normalized = process.platform === "win32"
            ? normalize(entry.target).toLocaleLowerCase("en-US")
            : normalize(entry.target);
          return !excludedTargets.has(normalized);
        });
        job.total = entries.length;
        job.processed = 0;
        job.phase = "mapping";
        const result = options.repository.synchronizeLocalFolderLevel(
          root,
          entries,
          (processed, added, updated) => {
            job.processed = processed;
            job.added = added;
            job.updated = updated;
          },
        );
        job.added = result.added;
        job.updated = result.updated;
        job.removed = result.removed;
        if (result.added || result.updated || result.removed) options.onIndexChanged?.(root.id);
        job.phase = "completed";
        job.status = "completed";
        job.finishedAt = new Date().toISOString();
        lastFolderScan.set(root.id, Date.now());
      } catch (error) {
        job.status = "error";
        job.phase = "completed";
        job.error = error instanceof Error ? error.message : "文件夹索引失败";
        job.finishedAt = new Date().toISOString();
      } finally {
        // The completed job remains available for progress/status rendering.
      }
    })();
    return job;
  };

  app.get<{ Querystring: { thumbnails?: string } }>("/api/library/items", async (request) => {
    // Folder mappings are refreshed when the user opens a folder (or starts
    // a manual re-index), not by a background full-library timer. This keeps
    // large local trees responsive and avoids repeatedly scanning idle paths.
    return options.repository.list({ thumbnails: request.query.thumbnails === "deferred" ? "deferred" : "inline" });
  });
  app.get("/api/library/items/:id/thumbnail", async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "资料参数无效" });
    const data = options.repository.find(params.data.id)?.thumbnailDataUrl;
    const prefix = data?.match(/^data:(image\/(?:png|webp));base64,/u);
    if (!data || !prefix) return reply.code(404).send({ error: "缩略图不存在" });
    const tag = `"${createHash("sha256").update(data).digest("base64url")}"`;
    reply.header("cache-control", "private, no-cache").header("etag", tag).type(prefix[1]!);
    if (request.headers["if-none-match"] === tag) return reply.code(304).send();
    return reply.send(Buffer.from(data.slice(prefix[0].length), "base64"));
  });
  app.post("/api/settings/deepseek-ocr/verify", async () => ({
    ...(await verifyDeepSeekOcr(deepSeekOcrConfiguration(), options.ocrFetch ?? fetch)),
    enabled: options.getChatAnalysisSettings?.().deepseekOcrEnabled ?? false,
    maxPages: options.getChatAnalysisSettings?.().deepseekOcrMaxPages ?? 20,
  }));

  app.post("/api/library/items/:id/deepseek-ocr", {
    bodyLimit: MAX_OCR_PAGE_IMAGE_DATA_URL_LENGTH + 1_024,
  }, async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    const body = deepSeekOcrPageSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ error: body.success ? "资料参数无效" : body.error.issues[0]?.message ?? "OCR 参数无效" });
    }
    const item = options.repository.find(params.data.id);
    if (!item || item.kind === "folder" || item.kind === "local_folder") {
      return reply.code(404).send({ error: "PDF 资料不存在" });
    }
    const extension = extname(attachmentName(item)).toLocaleLowerCase();
    if (extension !== ".pdf") return reply.code(404).send({ error: "PDF 资料不存在" });
    const settings = options.getChatAnalysisSettings?.();
    if (!settings?.deepseekOcrEnabled) {
      return reply.code(503).send({ error: "DeepSeek OCR 未启用，请先在设置的 AI 页面中开启" });
    }
    const maxPages = settings.deepseekOcrMaxPages ?? 20;
    if (body.data.pageNumber > maxPages) {
      return reply.code(400).send({ error: `单次最多识别 ${maxPages} 页` });
    }
    try {
      const text = await recognizeWithDeepSeekOcr(
        deepSeekOcrConfiguration(),
        body.data.imageDataUrl,
        options.ocrFetch ?? fetch,
      );
      return { pageNumber: body.data.pageNumber, text, source: "deepseek-ocr" as const };
    } catch (error) {
      return reply.code(502).send({
        error: error instanceof Error ? error.message : "DeepSeek OCR 识别失败",
      });
    }
  });
  app.post("/api/library/whiteboard-folders/export", async (request, reply) => {
    const body = WhiteboardFolderExportSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? "白板资料夹导出参数无效" });
    try {
      const parentItem = body.data.parentId ? options.repository.find(body.data.parentId) : undefined;
      if (body.data.parentId && !parentItem) {
        return reply.code(404).send({ error: "选择的资料库文件夹不存在" });
      }
      const folderName = safeExportName(body.data.name, "白板资料夹");
      if (body.data.mode === "local") {
        const path = join(body.data.destination!, folderName);
        const result = await writeWhiteboardFolder(path, body.data);
        return { saved: true, path, ...result };
      }
      if (!options.stateDirectory) return reply.code(503).send({ error: "资料库素材目录尚未配置" });
      const managedRoot = parentItem?.kind === "local_folder" && parentItem.target
        ? parentItem.target
        : join(options.stateDirectory, "library-materials", randomUUID());
      if (!(parentItem?.kind === "local_folder" && parentItem.target)) await mkdir(managedRoot, { recursive: true });
      const path = join(managedRoot, folderName);
      const result = await writeWhiteboardFolder(path, body.data);
      const metadata = await stat(path);
      const item = options.repository.create({
        parentId: body.data.parentId ?? null,
        kind: "local_folder",
        name: body.data.name,
        target: path,
        tags: ["白板资料夹"],
        fileCreatedAt: metadata.birthtime.toISOString(),
        fileModifiedAt: metadata.mtime.toISOString(),
      });
      startFolderIndex(item, true);
      return reply.code(201).send({ saved: true, path, item, ...result });
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? `白板资料夹保存失败：${error.message}` : "白板资料夹保存失败" });
    }
  });
  app.get("/api/library/items/:id/index-status", async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "资料参数无效" });
    const item = options.repository.find(params.data.id);
    if (!item || item.kind !== "local_folder") return reply.code(404).send({ error: "本地文件夹映射不存在" });
    return startFolderIndex(item);
  });
  app.post("/api/library/items/:id/index", async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "资料参数无效" });
    const item = options.repository.find(params.data.id);
    if (!item || item.kind !== "local_folder") return reply.code(404).send({ error: "本地文件夹映射不存在" });
    return startFolderIndex(item, true);
  });
  app.post("/api/library/items", async (request, reply) => {
    const parsed = ResourceLibraryCreateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "资料映射无效" });
    try {
      let fileCreatedAt: string | null = null;
      let fileModifiedAt: string | null = null;
      if (parsed.data.target && (parsed.data.kind === "local_file" || parsed.data.kind === "local_folder")) {
        const metadata = statSync(parsed.data.target);
        fileCreatedAt = metadata.birthtime.toISOString();
        fileModifiedAt = metadata.mtime.toISOString();
      }
      const item = options.repository.create({ ...parsed.data, fileCreatedAt, fileModifiedAt });
      if (item.kind === "local_folder" && item.target) startFolderIndex(item, true);
      return reply.code(201).send(item);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "资料创建失败" });
    }
  });
  app.patch("/api/library/items/:id", async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    const body = ResourceLibraryUpdateSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "资料修改参数无效" });
    try {
      const current = options.repository.find(params.data.id);
      const targetChanged = body.data.target !== undefined && body.data.target !== current?.target;
      const fileModifiedAt = targetChanged && body.data.target && current && (current.kind === "local_file" || current.kind === "local_folder")
        ? statSync(body.data.target).mtime.toISOString()
        : undefined;
      const item = options.repository.update(
        params.data.id,
        fileModifiedAt === undefined ? body.data : { ...body.data, fileModifiedAt },
      );
      return item ?? reply.code(404).send({ error: "资料不存在" });
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "资料修改失败" });
    }
  });
  app.post("/api/library/items/:id/move", async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    const body = ResourceLibraryMoveSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "资料移动参数无效" });
    try {
      const item = options.repository.move(params.data.id, body.data.parentId, body.data.beforeId);
      return item ?? reply.code(404).send({ error: "资料不存在" });
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "资料移动失败" });
    }
  });
  app.delete("/api/library/items/:id", async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "资料参数无效" });
    return options.repository.delete(params.data.id)
      ? reply.code(204).send()
      : reply.code(404).send({ error: "资料不存在" });
  });
  app.post("/api/library/items/:id/import-local", async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    const body = z.object({ source: z.string().trim().min(1).max(4_096) }).strict().safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "拖入文件参数无效" });
    const folder = options.repository.find(params.data.id);
    if (!folder || folder.kind !== "local_folder" || !folder.target) {
      return reply.code(400).send({ error: "目标必须是真实本地文件夹" });
    }
    try {
      const folderMetadata = await lstat(folder.target);
      if (!folderMetadata.isDirectory() || folderMetadata.isSymbolicLink()) throw new Error("目标文件夹不可用或是符号链接");
      const sourceMetadata = await lstat(body.data.source);
      if (sourceMetadata.isSymbolicLink() || (!sourceMetadata.isFile() && !sourceMetadata.isDirectory())) {
        throw new Error("只支持普通文件或文件夹，不能复制符号链接");
      }
      const source = await realpath(body.data.source);
      const destinationRoot = await realpath(folder.target);
      const name = basename(source);
      const destination = join(folder.target, name);
      const relativeDestination = relative(source, destinationRoot);
      if (source === destination || (sourceMetadata.isDirectory() && (relativeDestination === "" || (!relativeDestination.startsWith("..") && !isAbsolute(relativeDestination))))) {
        throw new Error("不能将资料复制到自身或其子目录");
      }
      if (sourceMetadata.isDirectory()) await copyDirectory(source, destination);
      else await copyFile(source, destination, constants.COPYFILE_EXCL);
      const kind = sourceMetadata.isDirectory() ? "local_folder" : "local_file";
      const item = options.repository.create({ parentId: folder.id, kind, name, target: destination, tags: [] });
      if (kind === "local_folder") startFolderIndex(item, true);
      return reply.code(201).send(item);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? `复制到本地文件夹失败：${error.message}` : "复制到本地文件夹失败" });
    }
  });
  app.post("/api/library/items/:id/permanent-delete", async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    const body = z.object({ confirmed: z.literal(true), expectedTarget: z.string().min(1) }).strict().safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "彻底删除需要先确认本地源路径" });
    const item = options.repository.find(params.data.id);
    if (!item) return reply.code(404).send({ error: "资料不存在" });
    if (item.target !== body.data.expectedTarget) return reply.code(409).send({ error: "资料映射已改变，请重新查看后确认" });
    try {
      await deleteResourceLibrarySource(item);
      if (options.repository.find(item.id)?.target !== item.target) {
        return reply.code(409).send({ error: "已删除确认的源文件；资料映射在操作期间改变，新映射记录已保留" });
      }
      options.repository.delete(item.id);
      return reply.code(204).send();
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "本地源文件删除失败，资料库记录已保留" });
    }
  });
  app.post("/api/library/items/:id/open", async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "资料参数无效" });
    const item = options.repository.find(params.data.id);
    if (!item?.target || item.kind === "folder") return reply.code(404).send({ error: "资料映射不存在" });
    if (!options.openResource) return reply.code(503).send({ error: "请在 MOKI 客户端中调用本地应用打开" });
    try {
      await options.openResource(item);
      return { opened: true };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "资料打开失败" });
    }
  });
  app.post("/api/library/items/:id/reveal", async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "资料参数无效" });
    const item = options.repository.find(params.data.id);
    if (!item?.target || !["local_file", "local_folder"].includes(item.kind)) return reply.code(404).send({ error: "本地资料映射不存在" });
    if (!options.revealResource) return reply.code(503).send({ error: "请在 MOKI 客户端中打开文件夹路径" });
    try {
      await options.revealResource(item);
      return { revealed: true };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "文件夹路径打开失败" });
    }
  });
  app.post("/api/library/items/:id/export", async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    const body = ResourceLibraryExportSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "另存为参数无效" });
    const item = params.success ? options.repository.find(params.data.id) : undefined;
    if (!item) return reply.code(404).send({ error: "资料不存在" });
    const isFolder = item.kind === "folder" || item.kind === "local_folder";
    if ((isFolder && body.data.mode !== "folder") || (!isFolder && body.data.mode !== "file")) {
      return reply.code(400).send({ error: isFolder ? "资料夹必须选择目标文件夹" : "文件必须选择保存文件名" });
    }
    try {
      if (isFolder) {
        const result = await exportItemIntoFolder(item, body.data.destination);
        return { saved: true, path: join(body.data.destination, safeExportName(item.name, "资料夹")), ...result };
      }
      if (!item.target) return reply.code(404).send({ error: "资料没有可读取的来源" });
      if (item.kind === "local_file") await copyFile(item.target, body.data.destination);
      else await downloadUrl(item.target, body.data.destination);
      return { saved: true, path: body.data.destination, files: 1, folders: 0 };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? `另存为失败：${error.message}` : "另存为失败" });
    }
  });
  app.get("/api/library/items/:id/preview", async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "资料参数无效" });
    const item = options.repository.find(params.data.id);
    if (!item?.target || item.kind !== "local_file") return reply.code(404).send({ error: "当前资料不支持本地预览" });
    try {
      const stat = statSync(item.target);
      if (!stat.isFile()) return reply.code(400).send({ error: "映射目标不是文件" });
      const info = await inspectPreviewFile(item.target);
      const mime = MIME_TYPES['.'+info.extension] ?? info.mime;
      const range = byteRange(request.headers.range,stat.size);
      reply.header("accept-ranges", "bytes").header("cache-control", "private, max-age=0, must-revalidate");
      if(range===false)return reply.code(416).header('content-range',`bytes */${stat.size}`).send();
      if (range) {
        const {start,end} = range;
        return reply
          .code(206)
          .header("content-range", `bytes ${start}-${end}/${stat.size}`)
          .header("content-length", end - start + 1)
          .type(mime)
          .send(createReadStream(item.target, { start, end }));
      }
      return reply.header("content-length", stat.size).type(mime).send(createReadStream(item.target));
    } catch {
      return reply.code(404).send({ error: "本地文件不存在或无法读取" });
    }
  });
  const fallbackDrafts = new EditorDraftStore(join(options.stateDirectory ?? process.cwd(), 'editor-drafts'));
  const textDrafts = () => options.getTextDrafts?.() ?? fallbackDrafts;
  app.get('/api/library/items/:id/draft', async (request, reply) => {
    const params=paramsSchema.parse(request.params), item=options.repository.find(params.id);
    if (!item?.target || item.kind !== 'local_file') return reply.code(404).send({error:'文件不存在'});
    const draft=await textDrafts().get('text:'+item.id);
    return {draft: draft?.sourcePath === item.target ? {content:draft.content.toString('utf8'),version:draft.version,savedAt:draft.savedAt} : null};
  });
  app.put('/api/library/items/:id/draft', async (request, reply) => {
    const params=paramsSchema.parse(request.params), item=options.repository.find(params.id);
    const input=z.object({content:z.string().max(5_000_000),version:z.string().optional()}).parse(request.body);
    if (!item?.target || item.kind !== 'local_file' || !EDITABLE_TEXT_EXTENSIONS.has(extname(item.target).toLowerCase())) return reply.code(415).send({error:'文件不支持文本草稿'});
    if (Buffer.byteLength(input.content)>5_000_000) return reply.code(413).send({error:'草稿超过 5MB'});
    return textDrafts().put('text:'+item.id,Buffer.from(input.content),{sourcePath:item.target,...(input.version ? {version:input.version}: {})});
  });
  app.delete('/api/library/items/:id/draft', async request => {const {id}=paramsSchema.parse(request.params);await textDrafts().remove('text:'+id);return {removed:true};});
  app.post('/api/library/items/:id/univer-session/:sessionId/checkpoint', async (request, reply) => {
    const params=officeSessionParamsSchema.parse(request.params);
    if (!univerOffice) return reply.code(503).send({error:'Office 运行时不可用'});
    try {return await univerOffice.checkpoint(params.sessionId,params.id);} catch(error){return reply.code(409).send({error:String(error)});}
  });
  app.post('/api/library/items/:id/univer-session/:sessionId/images', async (request, reply) => {
    const params = officeSessionParamsSchema.safeParse(request.params);
    const body = officeSessionImageInsertSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: '图片插入参数无效' });
    if (!univerOffice) return reply.code(503).send({ error: 'Univer Office 运行时不可用' });
    const image = options.repository.find(body.data.imageId);
    if (!image?.target || image.kind !== 'local_file') return reply.code(404).send({ error: '资料库图片不存在' });
    if (!isUniverLibraryImageName(image.target)) {
      return reply.code(415).send({ error: `资料库图片仅支持 ${UNIVER_LIBRARY_IMAGE_FORMATS_LABEL}` });
    }
    try {
      const result = await univerOffice.insertLibraryImage(params.data.sessionId, params.data.id, image.target, {
        ...(body.data.unitId ? { unitId: body.data.unitId } : {}),
        ...(body.data.slideId ? { slideId: body.data.slideId } : {}),
        ...(body.data.sheetId ? { sheetId: body.data.sheetId } : {}),
        ...(body.data.startOffset !== undefined ? { startOffset: body.data.startOffset } : {}),
        ...(body.data.endOffset !== undefined ? { endOffset: body.data.endOffset } : {}),
        ...(body.data.segmentId !== undefined ? { segmentId: body.data.segmentId } : {}),
        ...(body.data.row !== undefined ? { row: body.data.row } : {}),
        ...(body.data.column !== undefined ? { column: body.data.column } : {}),
        ...(body.data.left !== undefined ? { left: body.data.left } : {}),
        ...(body.data.top !== undefined ? { top: body.data.top } : {}),
        ...(body.data.width !== undefined ? { width: body.data.width } : {}),
        ...(body.data.height !== undefined ? { height: body.data.height } : {}),
      });
      return { inserted: true, image: { id: image.id, name: image.name }, ...result };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? `图片插入失败：${error.message}` : '图片插入失败' });
    }
  });
  app.get("/api/library/items/:id/content", async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "资料参数无效" });
    const item = options.repository.find(params.data.id);
    if (!item?.target || item.kind !== "local_file") return reply.code(404).send({ error: "当前资料不支持文本读取" });
    const extension = extname(item.target).toLowerCase();
    if (!EDITABLE_TEXT_EXTENSIONS.has(extension)) return reply.code(415).send({ error: "当前格式不支持文本编辑" });
    try {
      const file = await stat(item.target);
      if (!file.isFile()) return reply.code(400).send({ error: "映射目标不是文件" });
      if (file.size > MAX_EDITABLE_CONTENT_BYTES) return reply.code(413).send({ error: "文本文件超过 5MB，请调用系统应用编辑" });
      const content = await readFile(item.target, "utf8");
      return { content, version: fileContentVersion(content), extension, size: file.size, updatedAt: file.mtime.toISOString() };
    } catch {
      return reply.code(404).send({ error: "本地文件不存在或无法读取" });
    }
  });
  app.post('/api/library/items/:id/content/save-as', async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    const body = z.object({ content: z.string().max(5_000_000), destination: z.string().min(1).max(4096).optional() }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({error:'文本另存参数无效'});
    const item = options.repository.find(params.data.id);
    if (!item?.target || item.kind !== 'local_file' || !EDITABLE_TEXT_EXTENSIONS.has(extname(item.target).toLowerCase())) return reply.code(415).send({error:'当前文件不支持文本另存'});
    const contents = Buffer.from(body.data.content,'utf8');
    if (contents.length > MAX_EDITABLE_CONTENT_BYTES) return reply.code(413).send({error:'文本内容超过 5MB'});
    if (!body.data.destination) return attachmentHeaders(reply, attachmentName(item)).type('application/octet-stream').send(contents);
    const destination = body.data.destination;
    if (!isAbsolute(destination) || resolve(destination).toLowerCase() === resolve(item.target).toLowerCase() || extname(destination).toLowerCase() !== extname(item.target).toLowerCase()) return reply.code(400).send({error:'另存路径须不同于原文件，且保留文件格式'});
    try {
      await writeFile(destination, contents, {flag:'wx'});
      return {saved:true,path:destination,size:contents.length};
    } catch(error) { return reply.code(409).send({error:error instanceof Error ? `文本另存失败（已有文件不会覆盖）：${error.message}` : '文本另存失败'}); }
  });
  app.get("/api/library/items/:id/structured-preview", async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "资料参数无效" });
    const item = options.repository.find(params.data.id);
    if (!item?.target || !["local_file", "local_folder", "url"].includes(item.kind)) return reply.code(404).send({ error: "当前资料不支持结构化预览" });
    const extension = extname(new URL(item.kind === "url" ? item.target : `file:///${item.target.replace(/\\/gu, "/")}`).pathname).toLowerCase();
    if (!STRUCTURED_PREVIEW_EXTENSIONS.has(extension)) return reply.code(415).send({ error: "当前格式不支持结构化预览" });
    try {
      if(item.kind==='local_file' && ['.docx','.xlsx','.pptx'].includes(extension)) {
        const parts=await readZipParts(item.target, (name: string) => extension==='.docx' ? name==='word/document.xml'
          : extension==='.xlsx' ? /^xl\/(?:workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|styles\.xml|worksheets\/[^/]+\.xml)$/u.test(name)
          : /^ppt\/slides\/slide\d+\.xml$/u.test(name));
        return parseOfficePreview(new Uint8Array(),extension,parts);
      }
      const contents = await readStructuredPreviewContents(item, extension, options.fetchResource);
      return extension === ".pdf"
        ? await parsePdfPreview(contents)
        : extension === ".doc"
          ? await parseLegacyWordPreview(contents)
          : extension === ".ppt"
            ? parseLegacyPresentationPreview(contents)
            : [".key", ".pages", ".numbers"].includes(extension)
              ? parseAppleOfficePreview(contents, extension)
          : parseOfficePreview(contents, extension);
    } catch (error) {
      if (error instanceof StructuredPreviewTooLargeError) return reply.code(413).send({ error: error.message });
      const format = extension === ".pdf" ? "PDF" : "Office";
      return reply.code(422).send({ error: error instanceof Error ? `${format} 预览解析失败：${error.message}` : `${format} 预览解析失败` });
    }
  });
  app.put("/api/library/items/:id/office-content", async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    const body = ResourceLibraryOfficeContentUpdateSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ error: body.success ? "资料参数无效" : body.error.issues[0]?.message ?? "Office 保存参数无效" });
    }
    const item = options.repository.find(params.data.id);
    if (!item?.target || item.kind !== "local_file") {
      return reply.code(404).send({ error: "只有本地 Office 文件支持编辑" });
    }
    const extension = extname(item.target).toLowerCase();
    if (![".docx", ".xlsx", ".pptx"].includes(extension)) {
      return reply.code(415).send({ error: "当前格式不支持 Office 编辑" });
    }
    try {
      const file = await stat(item.target);
      if (!file.isFile()) return reply.code(400).send({ error: "映射目标不是文件" });
      if (file.size > MAX_STRUCTURED_PREVIEW_BYTES) {
        return reply.code(413).send({ error: "Office 文件超过 32MB，请调用系统应用编辑" });
      }
      const saved = await saveOfficeContentUpdate(item.target, body.data);
      return { saved: true, ...saved };
    } catch (error) {
      return reply.code(422).send({ error: error instanceof Error ? `Office 文件保存失败：${error.message}` : "Office 文件保存失败" });
    }
  });
  app.post("/api/library/items/:id/univer-session", async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "资料参数无效" });
    if (!univerOffice) return reply.code(503).send({ error: "Univer Office 运行时不可用" });
    const item = options.repository.find(params.data.id);
    if (!item?.target || item.kind !== "local_file") {
      return reply.code(404).send({ error: "只有本地 Office 文件支持完整编辑" });
    }
    const extension = extname(item.target).toLowerCase();
    if (![".docx", ".xlsx", ".csv", ".tsv", ".pptx", ".univer"].includes(extension)) {
      return reply.code(415).send({ error: "Univer 编辑器仅支持 DOCX、XLSX、CSV、TSV、PPTX 和原生 .univer 文件" });
    }
    try {
      if ([".docx", ".xlsx", ".pptx"].includes(extension)
        && (await stat(item.target)).size >= MAX_UNIVER_EMBEDDED_EDIT_SOURCE_BYTES) {
        return reply.code(413).send({ code: "SYSTEM_OFFICE_EDITOR_REQUIRED", error: SYSTEM_OFFICE_EDIT_MESSAGE });
      }
      const session = await univerOffice.open(item.id, item.target, item.name);
      return { session };
    } catch (error) {
      if (isUniverImportCapacityError(error)) {
        return reply.code(413).send({ code: "SYSTEM_OFFICE_EDITOR_REQUIRED", error: SYSTEM_OFFICE_EDIT_MESSAGE });
      }
      return reply.code(422).send({
        error: error instanceof Error ? `Univer Office 打开失败：${error.message}` : "Univer Office 打开失败",
      });
    }
  });
  app.post("/api/library/items/:id/univer-session/:sessionId/save", async (request, reply) => {
    const params = officeSessionParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Office 编辑会话参数无效" });
    if (!univerOffice) return reply.code(503).send({ error: "Univer Office 运行时不可用" });
    try {
      const saved = await univerOffice.save(params.data.sessionId, params.data.id);
      return { saved: true, ...saved };
    } catch (error) {
      return reply.code(409).send({
        error: error instanceof Error ? `Univer Office 保存失败：${error.message}` : "Univer Office 保存失败",
      });
    }
  });
  app.post("/api/library/items/:id/univer-session/:sessionId/save-as", async (request, reply) => {
    const params = officeSessionParamsSchema.safeParse(request.params);
    const body = officeSessionSaveAsSchema.safeParse(request.body ?? {});
    if (!params.success || !body.success) return reply.code(400).send({ error: "Office 另存为参数无效" });
    if (!univerOffice) return reply.code(503).send({ error: "Univer Office 运行时不可用" });
    const item = options.repository.find(params.data.id);
    if (!item?.target || item.kind !== "local_file") return reply.code(404).send({ error: "Office 资料不存在" });
    const downloadDirectory = join(options.stateDirectory ?? dirname(item.target), "univer-office-downloads");
    const destination = body.data.destination
      ? body.data.destination
      : join(downloadDirectory, `${randomUUID()}${extname(item.target).toLowerCase()}`);
    try {
      const saved = await univerOffice.saveAs(params.data.sessionId, destination, params.data.id);
      if (body.data.destination) return { saved: true, ...saved };
      const contents = await readFile(saved.path);
      await rm(saved.path, { force: true });
      return attachmentHeaders(reply, attachmentName(item))
        .type(MIME_TYPES[extname(item.target).toLowerCase()] ?? "application/octet-stream")
        .send(contents);
    } catch (error) {
      if (!body.data.destination) await rm(destination, { force: true }).catch(() => undefined);
      return reply.code(409).send({
        error: error instanceof Error ? `Univer Office 另存为失败：${error.message}` : "Univer Office 另存为失败",
      });
    }
  });
  app.post("/api/library/items/:id/univer-session/:sessionId/discard", async (request, reply) => {
    const params = officeSessionParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Office 编辑会话参数无效" });
    if (!univerOffice) return reply.code(503).send({ error: "Univer Office 运行时不可用" });
    try {
      await univerOffice.discard(params.data.sessionId, params.data.id);
      return { discarded: true };
    } catch (error) {
      return reply.code(422).send({
        error: error instanceof Error ? `Univer Office 草稿放弃失败：${error.message}` : "Univer Office 草稿放弃失败",
      });
    }
  });
  app.put("/api/library/items/:id/content", async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    const body = ResourceLibraryContentUpdateSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "文本保存参数无效" });
    const item = options.repository.find(params.data.id);
    if (!item?.target || item.kind !== "local_file") return reply.code(404).send({ error: "当前资料不支持文本编辑" });
    const extension = extname(item.target).toLowerCase();
    if (!EDITABLE_TEXT_EXTENSIONS.has(extension)) return reply.code(415).send({ error: "当前格式不支持文本编辑" });
    if (Buffer.byteLength(body.data.content, "utf8") > MAX_EDITABLE_CONTENT_BYTES) {
      return reply.code(413).send({ error: "文本内容超过 5MB，无法在预览器中保存" });
    }
    try {
      const file = await stat(item.target);
      if (!file.isFile()) return reply.code(400).send({ error: "映射目标不是文件" });
      await withFileEdit(item.target, body.data.expectedVersion, async (_original, canonical) => {
        await replaceFileAtomically(canonical, Buffer.from(body.data.content, "utf8"));
      });
      return { saved: true, version: fileContentVersion(body.data.content), size: Buffer.byteLength(body.data.content, "utf8"), updatedAt: new Date().toISOString() };
    } catch (error) {
      return reply.code(error instanceof FileEditConflict ? 409 : 400).send({ error: error instanceof Error ? `本地文件保存失败：${error.message}` : "本地文件保存失败" });
    }
  });
  app.get("/api/library/items/:id/attachment", async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "资料参数无效" });
    const item = options.repository.find(params.data.id);
    if (!item?.target || !["local_file", "url"].includes(item.kind)) {
      return reply.code(400).send({ error: "只有文件映射可以作为附件" });
    }
    const name = attachmentName(item);
    if (item.kind === "local_file") {
      try {
        const stat = statSync(item.target);
        if (!stat.isFile()) return reply.code(400).send({ error: "映射目标不是文件" });
        if (stat.size > ASSISTANT_MAX_ATTACHMENT_BYTES) return reply.code(413).send({ error: "单个附件不能超过 32 MB" });
        const mime = MIME_TYPES[extname(item.target).toLowerCase()] ?? "application/octet-stream";
        return attachmentHeaders(reply, name).header("content-length", stat.size).type(mime).send(createReadStream(item.target));
      } catch {
        return reply.code(404).send({ error: "本地文件不存在或无法读取" });
      }
    }
    try {
      const response = await (options.fetchResource ?? fetch)(item.target, {
        redirect: "follow",
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) return reply.code(502).send({ error: `在线文件读取失败（HTTP ${response.status}）` });
      const declaredSize = Number(response.headers.get("content-length") ?? 0);
      if (declaredSize > ASSISTANT_MAX_ATTACHMENT_BYTES) return reply.code(413).send({ error: "单个附件不能超过 32 MB" });
      const contents = Buffer.from(await response.arrayBuffer());
      if (!contents.length) return reply.code(422).send({ error: "在线文件内容为空" });
      if (contents.length > ASSISTANT_MAX_ATTACHMENT_BYTES) return reply.code(413).send({ error: "单个附件不能超过 32 MB" });
      const mime = response.headers.get("content-type")?.split(";")[0]?.trim()
        || MIME_TYPES[extname(name).toLowerCase()]
        || "application/octet-stream";
      return attachmentHeaders(reply, name).type(mime).send(contents);
    } catch (error) {
      return reply.code(502).send({ error: error instanceof Error ? `在线文件读取失败：${error.message}` : "在线文件读取失败" });
    }
  });

  app.post("/api/library/items/:id/assistant-attachment", async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "资料参数无效" });
    if (request.headers["x-moki-attachment-upload"] !== "1") {
      return reply.code(403).send({ error: "附件暂存仅接受本机工作台请求" });
    }
    if (!options.assistantAttachmentDirectory) {
      return reply.code(503).send({ error: "助手附件暂存目录不可用" });
    }
    const item = options.repository.find(params.data.id);
    if (!item?.target || item.kind !== "local_file") {
      return reply.code(400).send({ error: "只有本地文件可以直接暂存为附件" });
    }
    try {
      const file = statSync(item.target);
      if (!file.isFile() || file.size <= 0) return reply.code(400).send({ error: "映射目标不是有效文件" });
      const name = attachmentName(item);
      const mediaType = (MIME_TYPES[extname(item.target).toLowerCase()] ?? "application/octet-stream")
        .split(";")[0]!;
      const upload = await stageAssistantAttachmentFromLocalFile(
        options.assistantAttachmentDirectory,
        { name, mediaType, size: file.size, sourcePath: item.target },
      );
      return reply.code(201).send({
        id: randomUUID(),
        name,
        mediaType,
        size: file.size,
        stagedUploadId: upload.id,
      });
    } catch (error) {
      return reply.code(422).send({ error: error instanceof Error ? error.message : "资料附件暂存失败" });
    }
  });
}

import { randomUUID } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { copyFile, open, readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { z } from "zod";
import {
  extractWorkbenchFilePreviewText,
  parsePdfPreview,
} from "../../documents/workbench-file-preview.js";
import { ASSISTANT_MAX_ATTACHMENT_BYTES } from "../../shared/assistant-contract.js";

export const ASSISTANT_ATTACHMENT_UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;
const PREVIEW_TEXT_LIMIT = 48_000;
const STRUCTURED_EXTRACTION_MAX_BYTES = 128 * 1024 * 1024;
const SAFE_UPLOAD_ID = /^[A-Za-z0-9_-]+$/u;

const metadataSchema = z.object({
  id: z.string().regex(SAFE_UPLOAD_ID),
  name: z.string().min(1).max(200),
  mediaType: z.string().min(1).max(100),
  size: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  received: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  completed: z.boolean(),
  createdAt: z.string(),
  deliveryFileName: z.string().optional(),
}).strict();

export type AssistantAttachmentUploadMetadata = z.infer<typeof metadataSchema>;

function uploadRoot(attachmentDirectory: string): string {
  return join(attachmentDirectory, ".uploads");
}

export function assistantAttachmentUploadDirectory(
  attachmentDirectory: string,
  uploadId: string,
): string {
  if (!SAFE_UPLOAD_ID.test(uploadId)) throw new Error("无效的附件上传标识");
  return join(uploadRoot(attachmentDirectory), uploadId);
}

function metadataPath(attachmentDirectory: string, uploadId: string): string {
  return join(assistantAttachmentUploadDirectory(attachmentDirectory, uploadId), "metadata.json");
}

export function readAssistantAttachmentUpload(
  attachmentDirectory: string,
  uploadId: string,
): AssistantAttachmentUploadMetadata {
  const parsed = metadataSchema.safeParse(JSON.parse(readFileSync(metadataPath(attachmentDirectory, uploadId), "utf8")));
  if (!parsed.success) throw new Error("附件暂存信息损坏，请重新选择文件");
  return parsed.data;
}

export function writeAssistantAttachmentUpload(
  attachmentDirectory: string,
  metadata: AssistantAttachmentUploadMetadata,
): void {
  writeFileSync(metadataPath(attachmentDirectory, metadata.id), JSON.stringify(metadata), "utf8");
}

export function createAssistantAttachmentUpload(
  attachmentDirectory: string,
  input: { name: string; mediaType: string; size: number },
): AssistantAttachmentUploadMetadata {
  const id = randomUUID();
  const directory = assistantAttachmentUploadDirectory(attachmentDirectory, id);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "content"), Buffer.alloc(0), { flag: "wx" });
  const metadata: AssistantAttachmentUploadMetadata = {
    id,
    name: input.name,
    mediaType: input.mediaType,
    size: input.size,
    received: 0,
    completed: false,
    createdAt: new Date().toISOString(),
  };
  writeAssistantAttachmentUpload(attachmentDirectory, metadata);
  return metadata;
}

export async function appendAssistantAttachmentUploadChunk(
  attachmentDirectory: string,
  uploadId: string,
  offset: number,
  chunk: Buffer,
): Promise<AssistantAttachmentUploadMetadata> {
  const metadata = readAssistantAttachmentUpload(attachmentDirectory, uploadId);
  if (metadata.completed) throw new Error("附件上传已完成");
  if (offset !== metadata.received) throw new Error("附件分片顺序不一致，请重新上传");
  if (!chunk.length || chunk.length > ASSISTANT_ATTACHMENT_UPLOAD_CHUNK_BYTES) {
    throw new Error("附件分片大小无效");
  }
  if (metadata.received + chunk.length > metadata.size) {
    throw new Error("附件分片超过声明大小");
  }
  await new Promise<void>((resolve, reject) => {
    const stream = createWriteStream(
      join(assistantAttachmentUploadDirectory(attachmentDirectory, uploadId), "content"),
      { flags: "a" },
    );
    stream.once("error", reject);
    stream.once("finish", resolve);
    stream.end(chunk);
  });
  const next = { ...metadata, received: metadata.received + chunk.length };
  writeAssistantAttachmentUpload(attachmentDirectory, next);
  return next;
}

function isTextLike(name: string, mediaType: string): boolean {
  return mediaType.toLowerCase().startsWith("text/") || new Set([
    ".txt", ".md", ".markdown", ".log", ".json", ".csv", ".tsv",
    ".html", ".htm", ".xml", ".yaml", ".yml", ".js", ".jsx",
    ".ts", ".tsx", ".css", ".py", ".java", ".c", ".cpp", ".h",
    ".cs", ".go", ".rs", ".sql", ".sh", ".ps1",
  ]).has(extname(name).toLowerCase());
}

async function extractTextChunks(path: string, size: number): Promise<string | undefined> {
  // Leave room for chunk labels so the model receives the beginning, middle,
  // and end instead of truncating away the last sample.
  const totalBytes = Math.min(size, Math.floor(PREVIEW_TEXT_LIMIT * 0.8));
  const partBytes = Math.max(1, Math.floor(totalBytes / (size > totalBytes ? 3 : 1)));
  const offsets = size > totalBytes
    ? [0, Math.max(0, Math.floor((size - partBytes) / 2)), Math.max(0, size - partBytes)]
    : [0];
  const handle = await open(path, "r");
  try {
    const parts: string[] = [];
    for (let index = 0; index < offsets.length; index += 1) {
      const buffer = Buffer.alloc(Math.min(partBytes, size - offsets[index]!));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offsets[index]);
      const text = buffer.subarray(0, bytesRead).toString("utf8")
        .replace(/^\uFEFF/u, "")
        .replace(/\u0000/gu, "")
        .trim();
      if (text) {
        parts.push(offsets.length > 1
          ? `[本地内容分片 ${index + 1}/${offsets.length} · 字节 ${offsets[index]}-${offsets[index]! + bytesRead}]\n${text}`
          : text);
      }
    }
    return parts.join("\n\n").slice(0, PREVIEW_TEXT_LIMIT) || undefined;
  } finally {
    await handle.close();
  }
}

async function createLocalPreview(
  path: string,
  metadata: AssistantAttachmentUploadMetadata,
): Promise<string | undefined> {
  if (isTextLike(metadata.name, metadata.mediaType)) {
    return extractTextChunks(path, metadata.size);
  }
  const extension = extname(metadata.name).toLowerCase();
  if (metadata.size <= STRUCTURED_EXTRACTION_MAX_BYTES && extension === ".pdf") {
    try {
      return (await parsePdfPreview(await readFile(path))).text.slice(0, PREVIEW_TEXT_LIMIT) || undefined;
    } catch {
      return undefined;
    }
  }
  if (metadata.size <= STRUCTURED_EXTRACTION_MAX_BYTES && [".docx", ".xlsx", ".pptx"].includes(extension)) {
    try {
      return extractWorkbenchFilePreviewText(await readFile(path), metadata.name, metadata.mediaType)
        ?.slice(0, PREVIEW_TEXT_LIMIT);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

async function createImageDeliveryCopy(
  directory: string,
  path: string,
  metadata: AssistantAttachmentUploadMetadata,
): Promise<string | undefined> {
  if (!metadata.mediaType.startsWith("image/") || metadata.size <= ASSISTANT_MAX_ATTACHMENT_BYTES) return undefined;
  const fileName = "model-preview.jpg";
  try {
    const { default: sharp } = await import("sharp");
    await sharp(path, { limitInputPixels: 100_000_000, sequentialRead: true })
      .rotate()
      .resize({ width: 4096, height: 4096, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 88, progressive: true, mozjpeg: true })
      .toFile(join(directory, fileName));
    return fileName;
  } catch {
    return undefined;
  }
}

export async function completeAssistantAttachmentUpload(
  attachmentDirectory: string,
  uploadId: string,
): Promise<AssistantAttachmentUploadMetadata> {
  const metadata = readAssistantAttachmentUpload(attachmentDirectory, uploadId);
  const directory = assistantAttachmentUploadDirectory(attachmentDirectory, uploadId);
  const path = join(directory, "content");
  const actual = statSync(path);
  if (!actual.isFile() || metadata.received !== metadata.size || actual.size !== metadata.size) {
    throw new Error("附件分片尚未完整上传");
  }
  const preview = await createLocalPreview(path, metadata);
  if (preview) await writeFile(join(directory, "preview.txt"), preview, "utf8");
  const deliveryFileName = await createImageDeliveryCopy(directory, path, metadata);
  const completed = {
    ...metadata,
    completed: true,
    ...(deliveryFileName ? { deliveryFileName } : {}),
  };
  writeAssistantAttachmentUpload(attachmentDirectory, completed);
  return completed;
}

export async function stageAssistantAttachmentFromLocalFile(
  attachmentDirectory: string,
  input: { name: string; mediaType: string; size: number; sourcePath: string },
): Promise<AssistantAttachmentUploadMetadata> {
  const upload = createAssistantAttachmentUpload(attachmentDirectory, input);
  const directory = assistantAttachmentUploadDirectory(attachmentDirectory, upload.id);
  try {
    await copyFile(input.sourcePath, join(directory, "content"));
    const actualSize = statSync(join(directory, "content")).size;
    if (actualSize !== input.size) throw new Error("资料库文件在暂存期间发生变化，请重试");
    writeAssistantAttachmentUpload(attachmentDirectory, { ...upload, received: actualSize });
    return await completeAssistantAttachmentUpload(attachmentDirectory, upload.id);
  } catch (error) {
    removeAssistantAttachmentUpload(attachmentDirectory, upload.id);
    throw error;
  }
}

export function removeAssistantAttachmentUpload(
  attachmentDirectory: string,
  uploadId: string,
): void {
  rmSync(assistantAttachmentUploadDirectory(attachmentDirectory, uploadId), { recursive: true, force: true });
}

export function resolveCompletedAssistantAttachmentUpload(
  attachmentDirectory: string,
  uploadId: string,
): {
  metadata: AssistantAttachmentUploadMetadata;
  contentPath: string;
  previewText?: string;
  deliveryPath?: string;
} {
  const metadata = readAssistantAttachmentUpload(attachmentDirectory, uploadId);
  const directory = assistantAttachmentUploadDirectory(attachmentDirectory, uploadId);
  const contentPath = join(directory, "content");
  if (!metadata.completed || !existsSync(contentPath) || statSync(contentPath).size !== metadata.size) {
    throw new Error("附件暂存尚未完成，请重新选择文件");
  }
  const previewPath = join(directory, "preview.txt");
  const deliveryPath = metadata.deliveryFileName
    ? join(directory, metadata.deliveryFileName)
    : undefined;
  return {
    metadata,
    contentPath,
    ...(existsSync(previewPath) ? { previewText: readFileSync(previewPath, "utf8") } : {}),
    ...(deliveryPath && existsSync(deliveryPath) ? { deliveryPath } : {}),
  };
}

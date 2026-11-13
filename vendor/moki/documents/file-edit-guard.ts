import { createHash } from "node:crypto";
import { createReadStream, realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";

const queues = new Map<string, Promise<void>>();

export function fileContentVersion(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function fileVersion(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

// Repeated saves are successful no-ops. Only a verified baseline permits
// reconciliation; independent changes to the same span still require review.
export function reconcileTextSave(current: string, draft: string, expected?: string, base?: string): string {
  if (current === draft || expected === undefined || fileContentVersion(current) === expected) return draft;
  if (base === undefined || fileContentVersion(base) !== expected) throw new FileEditConflict();
  if (draft === base) return current;
  const edit = (next: string) => {
    let start=0,end=base.length,stop=next.length;
    while(start<end && start<stop && base[start]===next[start]) start++;
    while(end>start && stop>start && base[end-1]===next[stop-1]) {end--;stop--;}
    return {start,end,text:next.slice(start,stop)};
  };
  const a=edit(current),b=edit(draft);
  // Strict separation also avoids ambiguous insertions at a replacement edge.
  if (!(a.end < b.start || b.end < a.start)) throw new FileEditConflict();
  return [a,b].sort((x,y)=>y.start-x.start).reduce((text,e)=>text.slice(0,e.start)+e.text+text.slice(e.end),base);
}

export class FileEditConflict extends Error {
  constructor() {
    super("文件已被其他操作修改，当前草稿未覆盖原文件。请重新读取最新内容后编辑，或将当前草稿另存为。");
  }
}

// Share the same queue across structured Office writes and text/HTML saves.
// Resolve aliases before queuing so two library entries cannot race on one file.
export async function withFileEdit<T>(path: string, expectedVersion: string | undefined,
  operation: (original: Buffer, canonicalPath: string) => Promise<T>): Promise<T> {
  const canonical = realpathSync(path);
  const key = process.platform === "win32" ? canonical.toLowerCase() : canonical;
  const previous = queues.get(key) ?? Promise.resolve();
  const result = previous.then(async () => {
    const original = await readFile(canonical);
    if (expectedVersion !== undefined && fileContentVersion(original) !== expectedVersion) throw new FileEditConflict();
    return operation(original, canonical);
  });
  const settled = result.then(() => undefined, () => undefined);
  queues.set(key, settled);
  void settled.then(() => { if (queues.get(key) === settled) queues.delete(key); });
  return result;
}

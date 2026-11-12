import { l as uiText } from '../../../../src/i18n.js';
import {zip} from "fflate";
import type {ResourceLibraryItem} from "../../shared/resource-library-contract.js";
import {getResourceLibraryAttachment} from "./resource-library-api.js";
import {apiFetch} from "./api-fetch.js";

export const LIBRARY_CHAT_DRAG = "application/x-moki-library-selection";
let selection: {token: string; items: ResourceLibraryItem[]} | undefined;
let cleanup: ReturnType<typeof setTimeout>;
const params = new URLSearchParams(location.search);
const parentOrigin = params.get("parent");
export const nativeFileDrag = params.get("nativeFileDrag") === "1";
let lastWarm = -Infinity;
export function warmNativeFileDrag() {
  if (!nativeFileDrag || performance.now() - lastWarm < 30_000) return;
  lastWarm = performance.now();
  void apiFetch("/api/dsh/prepare-file-drag", {method:"POST"}).catch(()=>{lastWarm=-Infinity;});
}

export function requestParent<T>(type: string, fields: object, timeout: number): Promise<T> {
  if (!parentOrigin) return Promise.reject(new Error(uiText("DSH 工作区未连接")));
  const channel = new MessageChannel();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { channel.port1.close(); reject(new Error(uiText("DSH 文件操作等待超时"))); }, timeout);
    channel.port1.onmessage = ({data}) => {
      clearTimeout(timer);
      channel.port1.close();
      if (data.error) reject(new Error(data.error));
      else resolve(data.value);
    };
    parent.postMessage({bridge:params.get("bridge"), type, ...fields}, parentOrigin, [channel.port2]);
  });
}

export function beginLibraryDrag(transfer: DataTransfer, items: ResourceLibraryItem[]) {
  clearTimeout(cleanup);
  const token = crypto.randomUUID();
  selection = {token, items};
  transfer.setData(LIBRARY_CHAT_DRAG, token);
  if (parentOrigin) parent.postMessage({type:"resource-drag", bridge:params.get("bridge"), token}, parentOrigin);
}

export function endLibraryDrag() {
  if (parentOrigin) parent.postMessage({type:"resource-drag-end", bridge:params.get("bridge"), token:selection?.token}, parentOrigin);
  // Cross-process drop requests can reach the source just after its dragend.
  clearTimeout(cleanup);
  cleanup = setTimeout(() => { selection = undefined; }, 2500);
}

export async function collectDragFiles(token: string) {
  if (!selection || token !== selection.token) throw new Error(uiText("拖动的资料已失效，请重新拖动"));
  const {items} = selection;
  const files: File[] = [];
  const references: Array<Pick<ResourceLibraryItem, "id" | "name" | "kind" | "target">> = [];
  const asReference: string[] = [];
  for (const item of items) {
    const {id,name,kind,target} = item;
    if (kind === "local_file") {
      try {
        files.push(await getResourceLibraryAttachment(item));
        continue;
      } catch {
        // Large or unavailable files can still be read by ID via the library tools.
        asReference.push(name);
      }
    }
    references.push({id,name,kind,target});
  }
  return {files,references,asReference};
}

export async function pathsForDroppedFiles(files: File[]): Promise<string[]> {
  if (!files.length) return [];
  try { return await requestParent<string[]>("drop-paths", {files}, 3000); }
  catch { return []; }
}

let prepared: {key:string; token:string; abort:AbortController; ready:Promise<void>; expires:number} | undefined;

function releaseExport() {
  if (!prepared) return;
  prepared.abort.abort();
  if (parentOrigin) parent.postMessage({type:"release-export", bridge:params.get("bridge"), token:prepared.token}, parentOrigin);
  prepared = undefined;
}

async function exportFile(item: ResourceLibraryItem, signal: AbortSignal) {
  const response = await apiFetch(`/api/library/items/${encodeURIComponent(item.id)}/preview`, {signal});
  if (!response.ok) throw new Error(uiText`无法读取“${item.name}”`);
  const name = item.target?.split(/[\\\\/]/u).pop() || item.name;
  return new File([await response.blob()], name, {type:response.headers.get("content-type") || "application/octet-stream"});
}

async function exportSelection(items: ResourceLibraryItem[], signal: AbortSignal): Promise<File> {
  if (items.length === 1) return exportFile(items[0],signal);
  const entries: Record<string,Uint8Array> = Object.create(null);
  const names = new Set<string>();
  for (const item of items) {
    const file = await exportFile(item,signal);
    let name = file.name;
    const dot = name.lastIndexOf(".");
    const base = dot > 0 ? name.slice(0,dot) : name;
    const ext = dot > 0 ? name.slice(dot) : "";
    for (let n=2; names.has(name.toLowerCase()); n++) name = `${base} (${n})${ext}`;
    names.add(name.toLowerCase());
    entries[name] = new Uint8Array(await file.arrayBuffer());
  }
  signal.throwIfAborted();
  const packed = await new Promise<Uint8Array>((resolve,reject) =>
    zip(entries,{level:0},(error,bytes) => error ? reject(error) : resolve(bytes)));
  return new File([packed], uiText`资料库文件（${items.length}项）.zip`, {type:"application/zip"});
}

function prepare(items: ResourceLibraryItem[]) {
  if (!items.length || items.some(item=>item.kind!=="local_file")) throw new Error(uiText("请选择本地文件拖出"));
  const key = items.map(item=>[item.id,item.updatedAt].join("/")).join("|");
  if (prepared?.key===key && prepared.expires>Date.now()) return prepared;
  releaseExport();
  const token=crypto.randomUUID(), abort=new AbortController();
  const ready=exportSelection(items,abort.signal).then(async file=>{
    abort.signal.throwIfAborted();
    await requestParent("prepare-export",{token,file},60000);
  });
  prepared={key,token,abort,ready,expires:Date.now()+40000};
  ready.catch(()=>{if (prepared?.token===token) releaseExport()});
  return prepared;
}
export function prepareFileExport(items: ResourceLibraryItem[]) {
  if (nativeFileDrag) { warmNativeFileDrag(); return; }
  if (items.every(item=>item.kind==="local_file")) void prepare(items).ready.catch(()=>{});
}
export async function exportDraggedFiles(items: ResourceLibraryItem[]) {
  if (nativeFileDrag) {
    const response = await apiFetch("/api/dsh/drag-files",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({ids:items.map(item=>item.id)})});
    if (!response.ok) throw new Error((await response.json()).error || uiText("系统文件拖出失败"));
    return;
  }
  const selection=prepare(items);
  const pending=new AbortController();
  let cancelled=false;
  const cancel=()=>{cancelled=true};
  for (const name of ["pointerup","mouseup","blur","pagehide"]) window.addEventListener(name,cancel,{capture:true,signal:pending.signal});
  window.addEventListener("keydown",event=>{if(event.key==="Escape") cancel()}, {capture:true,signal:pending.signal});
  window.addEventListener("mouseout",event=>{if(!event.relatedTarget) cancel()}, {capture:true,signal:pending.signal});
  try {
    await selection.ready;
    if (selection!==prepared) return;
    if (cancelled) throw new Error(uiText("文件已准备好，可以再次拖出"));
    pending.abort();
    await requestParent("start-export",{token:selection.token},10000);
  } finally {
    pending.abort();
    if (prepared===selection && !cancelled) releaseExport();
  }
}
window.addEventListener("pagehide",releaseExport);

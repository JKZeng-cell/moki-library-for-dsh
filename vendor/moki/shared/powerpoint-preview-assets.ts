import {unzip} from 'fflate';
import type {ParsedPresentation} from '@extend-ai/react-pptx';
const MEDIA_TYPES:Record<string,string>={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',svg:'image/svg+xml',bmp:'image/bmp',tif:'image/tiff',tiff:'image/tiff',emf:'image/x-emf',wmf:'image/x-wmf',mp4:'video/mp4',mp3:'audio/mpeg',wav:'audio/wav',ttf:'font/ttf',otf:'font/otf'};

/** Recover referenced assets regardless of their valid OOXML package location.
 * The native parser currently collects only the conventional ppt/media folder.
 * Read only missing references into memory; never extract or change the original.
 */
export async function restorePowerPointPreviewAssets(parsed:ParsedPresentation,source:Uint8Array,signal?:AbortSignal):Promise<ParsedPresentation>{
  if(parsed.document.format!=='pptx')return parsed;
  const missing=new Set<string>();
  const visit=(value:unknown):void=>{
    if(!value||typeof value!=='object'||value instanceof Uint8Array)return;
    if(Array.isArray(value)){value.forEach(visit);return;}
    const record=value as Record<string,unknown>;
    if(typeof record.assetId==='string'&&!parsed.document.assets[record.assetId])missing.add(record.assetId);
    Object.values(record).forEach(visit);
  };
  visit(parsed.document.slides);visit(parsed.document.layouts);visit(parsed.document.masters);visit(parsed.document.themes);visit(parsed.document.embeddedFonts);
  if(!missing.size)return parsed;
  signal?.throwIfAborted();
  const files=await new Promise<Record<string,Uint8Array>>((resolve,reject)=>{
    const abort=()=>{cancel();reject(signal?.reason ?? new Error('预览已取消'));};
    const cancel=unzip(source,{filter:entry=>missing.has(entry.name)},(error,entries)=>{
      signal?.removeEventListener('abort',abort);if(error)reject(error);else resolve(entries);
    });
    signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted)abort();
  });
  signal?.throwIfAborted();
  const assets={...parsed.document.assets};
  const warnings=[...parsed.warnings];
  for(const id of missing){
    const data=files[id];
    if(data?.length)assets[id]={id,fileName:id,byteLength:data.length,contentType:MEDIA_TYPES[id.split('.').at(-1)!.toLowerCase()] ?? 'application/octet-stream',data};
    else warnings.push({code:'missing-asset',severity:'warning',partName:id,message:`原文件中缺少引用资源：${id}`});
  }
  return {...parsed,document:{...parsed.document,assets,warnings},warnings};
}

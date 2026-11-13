import { l as uiText } from '../../../../src/i18n.js';
import {lazy,Suspense,useEffect,useRef,useState} from 'react';
import {panelUrl} from '../lib/api-fetch.js';
import {formatFileSize} from './resource-hover-preview.js';
import './resource-extra-preview.css';
const ModelPreview=lazy(()=>import('./resource-model-preview.js'));
const OfdPreview=lazy(()=>import('./resource-ofd-preview.js'));
export type PreviewInfo={extension:string;size:number;mime:string;kind:string;converted:boolean;textPaged:boolean;modified:string;detected:boolean};
export function useFilePreviewInfo(item:{id:string;kind:string;updatedAt?:string},revision=0){
  const [state,setState]=useState<{id:string;info?:PreviewInfo;error?:string}>();
  useEffect(()=>{
    if(item.kind!=='local_file')return;const abort=new AbortController();
    fetch(panelUrl(`/api/library/items/${item.id}/preview-info`),{signal:abort.signal}).then(async r=>{const info=await r.json();if(!r.ok)throw Error(info.error);setState({id:item.id,info})}).catch(e=>{if(!abort.signal.aborted)setState({id:item.id,error:e.message})});
    return()=>abort.abort();
  },[item.id,item.updatedAt,item.kind,revision]);
  return state?.id===item.id?state:undefined;
}
async function json(url:string,signal:AbortSignal){const r=await fetch(url,{signal}),v=await r.json();if(!r.ok)throw Error(v.error||uiText("预览读取失败"));return v}
export function ExtraFilePreview({id,name,info,error,onOpen}:{id:string;name:string;info?:PreviewInfo;error?:string;onOpen:()=>void}){
  const base=panelUrl(`/api/library/items/${id}/`),kind=info?.kind;
  const parseTooLarge=!!info&&['model','font','ofd'].includes(kind!)&&info.size>512*1024*1024;
  return <section className="library-extra-preview" aria-label={uiText("文件预览")}>
    {!info&&!error?<p className="library-extra-message" role="status">{uiText("正在读取文件信息…")}</p>:error||parseTooLarge?<div className="library-extra-message" role="alert"><p>{error||uiText("此格式需要整体解码，文件已超出内嵌解析容量。")}</p><button onClick={onOpen}>{uiText("使用默认应用打开")}</button></div>
    :kind==='archive'?<ArchivePreview base={base}/>:kind==='text'?<PagedTextPreview base={base}/>:kind==='font'?<FontPreview base={base}/>
    :kind==='model'?<Suspense fallback={<p role="status" className="library-extra-message">{uiText("正在加载模型预览组件…")}</p>}><ModelPreview base={base} extension={info!.extension}/></Suspense>
    :kind==='ofd'?<Suspense fallback={<p role="status" className="library-extra-message">{uiText("正在加载 OFD 预览组件…")}</p>}><OfdPreview base={base}/></Suspense>
    :kind==='moki'?<MokiPreview base={base} info={info!}/>
    :<div className="library-extra-message"><h3>{name}</h3><p>{uiText("此格式暂不支持内容预览。")}</p><dl><dt>{uiText("文件格式")}</dt><dd>{info?.extension.toUpperCase()||uiText("未识别")}</dd><dt>{uiText("大小")}</dt><dd>{formatFileSize(info?.size??0)}</dd><dt>{uiText("修改时间")}</dt><dd>{info?.modified?new Date(info.modified).toLocaleString():''}</dd></dl><button onClick={onOpen}>{uiText("使用默认应用打开")}</button></div>}
  </section>;
}
function ArchivePreview({base}:{base:string}){
  const [page,setPage]=useState<any>(),[offset,setOffset]=useState(0),[history,setHistory]=useState<number[]>([]),[query,setQuery]=useState(''),[search,setSearch]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(true);
  useEffect(()=>{const timer=setTimeout(()=>{setSearch(query);setOffset(0);setHistory([])},250);return()=>clearTimeout(timer)},[query]);
  useEffect(()=>{const abort=new AbortController();setBusy(true);setError('');json(base+'preview-archive?offset='+offset+'&q='+encodeURIComponent(search),abort.signal).then(setPage).catch(e=>{if(!abort.signal.aborted)setError(e.message)}).finally(()=>{if(!abort.signal.aborted)setBusy(false)});return()=>abort.abort()},[base,offset,search]);
  return <><div className="library-extra-toolbar"><input className="library-archive-search" aria-label={uiText("搜索压缩包目录")} placeholder={uiText("搜索包内文件")} value={query} onChange={e=>setQuery(e.target.value)}/><small>{uiText("目录预览 · 不解压文件")}{page?.total!=null?' · '+page.total+uiText(" 项"):''}</small></div>
    {error?<p role="alert" className="library-extra-message">{error}</p>:<div className="library-extra-scroll" aria-busy={busy}><table className="library-archive-table"><thead><tr><th>{uiText("文件路径")}</th><th>{uiText("大小")}</th></tr></thead><tbody>{page?.entries.map((e:any,i:number)=><tr key={e.name+i} tabIndex={0} data-moki-entry={e.name} onClick={event=>{event.currentTarget.parentElement?.querySelectorAll("[aria-selected]").forEach(row=>row.removeAttribute("aria-selected"));event.currentTarget.setAttribute("aria-selected","true")}}><td>{e.directory?'▸ ':''}{e.name}{e.encrypted?uiText(" · 已加密"):''}</td><td>{e.directory?'—':formatFileSize(e.size)}</td></tr>)}</tbody></table>{!busy&&page?.entries.length===0?<p>{uiText("没有匹配的文件")}</p>:null}{busy?<p role="status">{uiText("正在读取目录…")}</p>:null}</div>}
    <div className="library-extra-toolbar"><button disabled={busy||!history.length} onClick={()=>{setOffset(history.at(-1)!);setHistory(history.slice(0,-1))}}>{uiText("上一页")}</button><button disabled={busy||page?.next==null} onClick={()=>{setHistory([...history,offset]);setOffset(page.next)}}>{uiText("下一页")}</button><small>{offset+1}–{offset+(page?.entries.length||0)}</small></div></>;
}
function PagedTextPreview({base}:{base:string}){
  const [page,setPage]=useState<any>(),[offset,setOffset]=useState(0),[history,setHistory]=useState<number[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(true),ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{const abort=new AbortController();setBusy(true);setError('');json(base+'preview-text?offset='+offset,abort.signal).then(v=>{setPage(v);ref.current?.scrollTo(0,0)}).catch(e=>{if(!abort.signal.aborted)setError(e.message)}).finally(()=>{if(!abort.signal.aborted)setBusy(false)});return()=>abort.abort()},[base,offset]);
  useEffect(()=>{window.dispatchEvent(new Event("moki:preview-location-changed"))},[page?.offset]);
  return <><div className="library-extra-toolbar"><small>{uiText("分段只读预览 ·")}{page?.encoding?.toUpperCase()} · {formatFileSize(page?.size??0)}</small></div><div className="library-extra-scroll" ref={ref} aria-busy={busy}>{error?<p role="alert">{error}</p>:<pre data-moki-selection-text="paged" data-moki-view-context={JSON.stringify({kind:"text",scope:"segment",byteOffset:page?.offset,encoding:page?.encoding})} data-moki-location={JSON.stringify({kind:"text",scope:"segment",byteOffset:page?.offset,encoding:page?.encoding,indexUnit:"utf16"})}>{page?.text}</pre>}</div><div className="library-extra-toolbar"><button disabled={busy||!history.length} onClick={()=>{setOffset(history.at(-1)!);setHistory(history.slice(0,-1))}}>{uiText("上一段")}</button><button disabled={busy||page?.next==null} onClick={()=>{setHistory([...history,offset]);setOffset(page.next)}}>{uiText("下一段")}</button><small>{busy?uiText("正在读取…"):uiText`读取位置 ${formatFileSize(offset)}`}</small></div></>;
}
function FontPreview({base}:{base:string}){
  const [family,setFamily]=useState(''),[error,setError]=useState(''),[sample,setSample]=useState(uiText("天地玄黄 宇宙洪荒\nMOKI Library · Aa Bb Cc\n0123456789 !? @#$%")),[size,setSize]=useState(42);
  useEffect(()=>{let face:FontFace,disposed=false;const abort=new AbortController();void(async()=>{try{const response=await fetch(base+'preview',{signal:abort.signal});face=new FontFace('moki-preview-'+crypto.randomUUID(),await response.arrayBuffer());await face.load();if(disposed)return;document.fonts.add(face);setFamily(face.family)}catch(e){if(!disposed)setError(String(e))}})();return()=>{disposed=true;abort.abort();if(face)document.fonts.delete(face)}},[base]);
  return <><div className="library-extra-toolbar"><label>{uiText("字号")}<input aria-label={uiText("字体预览字号")} type="range" min="16" max="96" value={size} onChange={e=>setSize(+e.target.value)}/></label><small>{uiText("仅用于预览，不安装字体")}</small></div><div className="library-extra-scroll">{error?<p role="alert">{error}</p>:<><textarea aria-label={uiText("字体预览文字")} rows={3} style={{width:'100%'}} value={sample} onChange={e=>setSample(e.target.value)}/><div className="library-font-sample" data-moki-selection-text="font" data-moki-location={JSON.stringify({kind:"font",scope:"sample",fontSize:size})} style={{fontFamily:family?`"${family}", sans-serif`:'sans-serif',fontSize:size,whiteSpace:'pre-wrap'}}>{sample}</div>{!family&&<p role="status">{uiText("正在加载字体…")}</p>}</>}</div></>;
}
function MokiPreview({base,info}:{base:string;info:PreviewInfo}){
  // Board exports can contain hundreds of MB of embedded media. The header is
  // always available without parsing or importing the complete document.
  return <><div className="library-extra-toolbar"><strong>{uiText("MOKI 白板文件")}</strong><small>{formatFileSize(info.size)}{uiText("· 数据只读预览")}</small></div><PagedTextPreview base={base}/></>;
}

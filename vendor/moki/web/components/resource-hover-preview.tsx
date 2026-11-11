import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import type {ResourceLibraryItem} from '../../shared/resource-library-contract.js';
import {panelUrl} from '../lib/api-fetch.js';
import './resource-extra-preview.css';

export function useResourceHoverPreview(item?:ResourceLibraryItem){
  const [anchor,setAnchor]=useState<DOMRect>();
  const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const close=()=>{clearTimeout(timer.current);setAnchor(undefined)};
  useEffect(()=>close,[]);
  useEffect(()=>{
    if(!anchor)return;
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape')close()};
    window.addEventListener('scroll',close,true);window.addEventListener('resize',close);window.addEventListener('pointerdown',close,true);window.addEventListener('keydown',key);
    return()=>{window.removeEventListener('scroll',close,true);window.removeEventListener('resize',close);window.removeEventListener('pointerdown',close,true);window.removeEventListener('keydown',key)};
  },[anchor]);
  return {handlers:item?.kind==='local_file'?{
    onPointerEnter:(event:React.PointerEvent<HTMLSpanElement>)=>{if(event.pointerType!=='mouse'||event.buttons)return;const element=event.currentTarget;clearTimeout(timer.current);timer.current=setTimeout(()=>{if(element.isConnected)setAnchor(element.getBoundingClientRect())},400)},
    onPointerLeave:close,onDragStart:close,
  }:{},bubble:anchor&&item?createPortal(<HoverPreview key={item.id} item={item} anchor={anchor}/>,document.body):null};
}
function HoverPreview({item,anchor}:{item:ResourceLibraryItem;anchor:DOMRect}){
  const [info,setInfo]=useState<any>(),[error,setError]=useState('');
  const base=panelUrl(`/api/library/items/${item.id}/`);
  useEffect(()=>{const abort=new AbortController();fetch(base+'preview-info',{signal:abort.signal}).then(async r=>{const v=await r.json();if(!r.ok)throw Error(v.error);setInfo(v)}).catch(e=>{if(!abort.signal.aborted)setError(e.message)});return()=>abort.abort()},[base]);
  const width=Math.min(360,window.innerWidth-24),height=Math.min(294,window.innerHeight-24);
  const left=Math.max(12,Math.min(anchor.right+12+width<=window.innerWidth?anchor.right+12:anchor.left-width-12,window.innerWidth-width-12));
  const top=Math.max(12,Math.min(anchor.top-12,window.innerHeight-height-12));
  return <aside className="library-hover-preview" role="tooltip" aria-label={`${item.name} 快速预览`} style={{left,top,width,height}}>
    <div className="library-hover-media">
      {error?<span>{error}</span>:!info?<span>正在预览…</span>:info.kind==='image'?<img src={base+'preview-image?size=hover'} alt={item.name} onError={()=>setError('此图片暂不能生成缩略预览')}/>
        :info.kind==='video'?<video src={base+'preview'} muted playsInline preload="metadata" onLoadedMetadata={e=>{e.currentTarget.currentTime=Math.min(.5,e.currentTarget.duration/2||0)}} onError={()=>setError('此视频编码请使用默认应用预览')}/>
        :item.hasThumbnail?<img src={base+'thumbnail'} alt={item.name}/>:<span className="library-hover-format">{info.extension?.toUpperCase()||'文件'}</span>}
    </div>
    <div className="library-hover-caption"><strong>{item.name}</strong><small>{info?`${info.extension?.toUpperCase()||'文件'} · ${formatFileSize(info.size)}`:'读取文件信息'} · 点击打开</small></div>
  </aside>;
}
export function formatFileSize(bytes:number){if(!Number.isFinite(bytes))return '—';const units=['B','KiB','MiB','GiB','TiB'];const i=Math.min(4,Math.max(0,Math.floor(Math.log2(Math.max(bytes,1))/10)));return `${(bytes/1024**i).toLocaleString(undefined,{maximumFractionDigits:i?1:0})} ${units[i]}`}

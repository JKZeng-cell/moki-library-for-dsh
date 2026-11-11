import {useRef,useState} from 'react';
export function PreviewRegionSelection({onSelect,onCancel}:{onSelect:(rect:{left:number;top:number;right:number;bottom:number})=>void;onCancel:()=>void}){
  const start=useRef<{x:number;y:number}>(),[rect,setRect]=useState<{left:number;top:number;width:number;height:number}>();
  return <div className="library-region-selector" tabIndex={0} role="group" aria-label="框选预览区域" onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();onCancel()}}}
    onPointerDown={e=>{if(e.button)return;e.preventDefault();e.stopPropagation();e.currentTarget.focus();e.currentTarget.setPointerCapture(e.pointerId);start.current={x:e.clientX,y:e.clientY};setRect(undefined)}}
    onPointerMove={e=>{if(!start.current)return;const r=e.currentTarget.getBoundingClientRect();setRect({left:Math.min(e.clientX,start.current.x)-r.left,top:Math.min(e.clientY,start.current.y)-r.top,width:Math.abs(e.clientX-start.current.x),height:Math.abs(e.clientY-start.current.y)})}}
    onPointerUp={e=>{if(!start.current)return;const s=start.current;start.current=undefined;e.currentTarget.releasePointerCapture(e.pointerId);if(Math.abs(e.clientX-s.x)<5||Math.abs(e.clientY-s.y)<5)return;onSelect({left:Math.min(e.clientX,s.x),top:Math.min(e.clientY,s.y),right:Math.max(e.clientX,s.x),bottom:Math.max(e.clientY,s.y)})}}
    onPointerCancel={()=>{start.current=undefined;setRect(undefined)}}>
    <span className="library-region-hint">拖动框选内容，与 DSH 对话 · Esc 取消</span>{rect&&<div className="library-region-box" style={rect}/>}
  </div>
}

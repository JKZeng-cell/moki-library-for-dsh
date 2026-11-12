import {useEffect,useRef,useState,type RefObject} from 'react';
import {createPortal} from 'react-dom';
import {l as uiText} from '../../../../src/i18n.js';
import {readPreviewSelection,type PreviewSelection} from './resource-preview-selection.js';
import './selection-chat-action.css';

type Box={left:number;right:number;top:number;bottom:number};
function anchorRect(root:HTMLElement):Box|null {
  const input=document.activeElement;
  if(input instanceof HTMLTextAreaElement&&root.contains(input)&&input.selectionStart!==input.selectionEnd) {
    const box=input.getBoundingClientRect(),style=getComputedStyle(input),mirror=document.createElement('div');
    Object.assign(mirror.style,{position:'fixed',visibility:'hidden',pointerEvents:'none',left:box.left+'px',top:box.top+'px',width:box.width+'px',height:box.height+'px',overflow:'hidden',whiteSpace:'pre-wrap',overflowWrap:'break-word'});
    for(const key of ['font','letterSpacing','wordSpacing','textIndent','tabSize','padding','border','boxSizing','wordBreak','scrollbarGutter'] as const)mirror.style[key]=style[key];
    const offset=input.selectionDirection==='backward'?input.selectionStart:input.selectionEnd;
    mirror.textContent=input.value.slice(0,offset);
    const marker=document.createElement('span');marker.textContent='\u200b';mirror.append(marker,document.createTextNode(input.value.slice(offset)||'\n'));
    document.body.append(mirror);mirror.scrollTop=input.scrollTop;mirror.scrollLeft=input.scrollLeft;
    const r=marker.getBoundingClientRect();mirror.remove();
    return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};
  }
  const selection=window.getSelection();
  if(!selection?.rangeCount||selection.isCollapsed)return null;
  const range=selection.getRangeAt(0);
  if(!root.contains(range.startContainer)||!root.contains(range.endContainer))return null;
  // Anchor beside the focus end, so forward/backward and keyboard selections
  // stay close to the point the user is working on, including multiline text.
  const rects=[...range.getClientRects()].filter(r=>r.width&&r.height);
  const backward=selection.focusNode===range.startContainer&&selection.focusOffset===range.startOffset;
  return (backward?rects[0]:rects.at(-1))??null;
}
export function SelectionChatAction({root,active,sourceText,onQuote}:{root:RefObject<HTMLElement|null>;active:boolean;sourceText?:string;onQuote:(selection:PreviewSelection,anchor:{x:number;y:number})=>void}) {
  const [selected,setSelected]=useState<{selection:PreviewSelection;x:number;y:number}|null>(null);
  const suspended=useRef(false);
  const latest=useRef({sourceText,onQuote});latest.current={sourceText,onQuote};
  useEffect(()=>{
    if(!active){setSelected(null);return;}
    let timer:ReturnType<typeof setTimeout>,dragging=false;
    const hide=()=>setSelected(null);
    const update=()=>{clearTimeout(timer);timer=setTimeout(()=>{
      if(dragging||suspended.current)return;
      const content=root.current?.querySelector<HTMLElement>('.dsh-preview-content');
      const selection=readPreviewSelection(content??null,undefined,latest.current.sourceText);
      const box=content&&anchorRect(content),bounds=content?.getBoundingClientRect();
      if(!selection?.selectedText?.trim()||!box||!bounds||box.bottom<bounds.top||box.top>bounds.bottom||box.right<bounds.left||box.left>bounds.right){hide();return;}
      const left=Math.max(6,bounds.left+4),right=Math.min(innerWidth-38,bounds.right-36),top=Math.max(6,bounds.top+3),bottom=Math.min(innerHeight-36,bounds.bottom-34);
      const y=box.bottom+6<=bottom?box.bottom+6:box.top-38;
      setSelected({selection,x:Math.max(left,Math.min(right,box.right)),y:Math.max(top,Math.min(bottom,y))});
    },80)};
    const down=(event:PointerEvent)=>{if((event.target as Element)?.closest?.('[data-selection-chat-action]'))return;suspended.current=!root.current?.querySelector('.dsh-preview-content')?.contains(event.target as Node);dragging=true;hide();};
    const up=()=>{dragging=false;update();};
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){suspended.current=true;clearTimeout(timer);hide();}else {if((event.shiftKey||((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='a'))&&root.current?.contains(event.target as Node))suspended.current=false;update();}};
    const outside=(event:FocusEvent)=>{if(event.target!==document.body&&(!(event.target instanceof Node)||(!root.current?.contains(event.target)&&!(event.target as Element).closest?.('[data-selection-chat-action]')))){suspended.current=true;hide();}};
    document.addEventListener('pointerdown',down,true);document.addEventListener('pointerup',up,true);document.addEventListener('selectionchange',update);document.addEventListener('keyup',key,true);document.addEventListener('focusin',outside,true);
    document.addEventListener('scroll',update,true);window.addEventListener('resize',update);window.addEventListener('moki:preview-location-changed',hide);
    return()=>{clearTimeout(timer);document.removeEventListener('pointerdown',down,true);document.removeEventListener('pointerup',up,true);document.removeEventListener('selectionchange',update);document.removeEventListener('keyup',key,true);document.removeEventListener('focusin',outside,true);document.removeEventListener('scroll',update,true);window.removeEventListener('resize',update);window.removeEventListener('moki:preview-location-changed',hide);};
  },[root,active]);
  useEffect(()=>setSelected(null),[sourceText]);
  return selected&&active?createPortal(<button type="button" data-selection-chat-action className="moki-selection-chat-action" style={{left:selected.x,top:selected.y}} aria-label={uiText('引用选区与 DSH 对话')} title={uiText('引用选区与 DSH 对话')} onPointerDown={event=>event.preventDefault()} onMouseDown={event=>event.preventDefault()} onClick={()=>{suspended.current=true;latest.current.onQuote(selected.selection,{x:selected.x,y:selected.y});setSelected(null);}}><span className="dsh-whale" aria-hidden="true"/></button>,document.body):null;
}

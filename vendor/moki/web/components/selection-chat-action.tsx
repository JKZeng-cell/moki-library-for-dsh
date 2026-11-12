import {useEffect,useRef,useState,type RefObject} from 'react';
import {createPortal} from 'react-dom';
import {l as uiText} from '../../../../src/i18n.js';
import {readPreviewSelection,type PreviewSelection} from './resource-preview-selection.js';
import './selection-chat-action.css';

type Box={left:number;right:number;top:number;bottom:number};
function anchorRect(root:HTMLElement):Box|null {
  const input=document.activeElement;
  if(input instanceof HTMLTextAreaElement&&root.contains(input)) {
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
  if(!selection?.rangeCount)return null;
  const range=selection.getRangeAt(0);
  if(!root.contains(range.startContainer)||!root.contains(range.endContainer))return null;
  // Anchor beside the focus end, so forward/backward and keyboard selections
  // stay close to the point the user is working on, including multiline text.
  const rects=[...range.getClientRects()].filter(r=>r.height);
  const backward=selection.focusNode===range.startContainer&&selection.focusOffset===range.startOffset;
  return (backward?rects[0]:rects.at(-1))??null;
}
export function SelectionChatAction({root,active,sourceText,onQuote}:{root:RefObject<HTMLElement|null>;active:boolean;sourceText?:string;onQuote:(selection:PreviewSelection,anchor:{x:number;y:number})=>void}) {
  const [selected,setSelected]=useState<{selection:PreviewSelection;x:number;y:number}|null>(null);
  const suspended=useRef(false);
  const latest=useRef({sourceText,onQuote});latest.current={sourceText,onQuote};
  useEffect(()=>{
    if(!active){setSelected(null);return;}
    let timer:ReturnType<typeof setTimeout>,dragging=false,interacted=false;
    let pointer:{target:Element;x:number;y:number}|null=null;
    const hide=()=>setSelected(null);
    const update=()=>{clearTimeout(timer);timer=setTimeout(()=>{
      if(dragging||suspended.current)return;
      const content=root.current?.querySelector<HTMLElement>('.dsh-preview-content');
      let selection=readPreviewSelection(content??null,undefined,latest.current.sourceText,interacted);
      let box=content&&anchorRect(content);
      const bounds=content?.getBoundingClientRect(),page=pointer?.target.closest<HTMLElement>('.library-pdf-page');
      // A blank PDF location has no text range. Capture a page-relative point,
      // never the browser's previous text caret or a point in the viewer chrome.
      if(interacted&&!window.getSelection()?.toString()&&page&&content?.contains(page)&&!pointer?.target.closest('.library-pdf-text-layer span')){
        const canvas=page.querySelector('canvas'),r=canvas?.getBoundingClientRect();
        if(canvas&&r&&pointer&&pointer.x>=r.left&&pointer.x<=r.right&&pointer.y>=r.top&&pointer.y<=r.bottom){
          let context={};try{context=JSON.parse(page.closest<HTMLElement>('[data-moki-location]')?.dataset.mokiLocation||'{}')}catch{}
          selection={selectedText:'',location:{...context,collapsed:true,coordinateSpace:'preview-pixels',surface:{width:canvas.width,height:canvas.height},point:{x:Math.round((pointer.x-r.left)/r.width*canvas.width),y:Math.round((pointer.y-r.top)/r.height*canvas.height)}}};
          box={left:pointer.x,right:pointer.x,top:pointer.y,bottom:pointer.y};
        }
      }else if(interacted&&!selection?.selectedText&&pointer?.target.closest('td[data-cell]')){
        selection=readPreviewSelection(content??null,pointer.target,latest.current.sourceText);
        box=pointer.target.closest('td[data-cell]')!.getBoundingClientRect();
      }
      const located=selection&&(Boolean(selection.caret)||selection.location?.start!==undefined||selection.location?.range||selection.location?.point);
      if(!located||!box||!bounds||box.bottom<bounds.top||box.top>bounds.bottom||box.right<bounds.left||box.left>bounds.right){hide();return;}
      const left=Math.max(6,bounds.left+4),right=Math.min(innerWidth-38,bounds.right-36),top=Math.max(6,bounds.top+3),bottom=Math.min(innerHeight-36,bounds.bottom-34);
      const y=box.bottom+6<=bottom?box.bottom+6:box.top-38;
      setSelected({selection,x:Math.max(left,Math.min(right,box.right)),y:Math.max(top,Math.min(bottom,y))});
    },80)};
    const down=(event:PointerEvent)=>{if((event.target as Element)?.closest?.('[data-selection-chat-action]'))return;suspended.current=!root.current?.querySelector('.dsh-preview-content')?.contains(event.target as Node);interacted=!suspended.current;pointer=null;dragging=true;hide();};
    const up=(event:PointerEvent)=>{if((event.target as Element)?.closest?.('[data-selection-chat-action]'))return;if(interacted&&event.target instanceof Element)pointer={target:event.target,x:event.clientX,y:event.clientY};dragging=false;update();};
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){suspended.current=true;clearTimeout(timer);hide();}else {if(root.current?.querySelector('.dsh-preview-content')?.contains(event.target as Node)){suspended.current=false;interacted=true;pointer=null;}update();}};
    const outside=(event:FocusEvent)=>{if(event.target!==document.body&&(!(event.target instanceof Node)||(!root.current?.contains(event.target)&&!(event.target as Element).closest?.('[data-selection-chat-action]')))){suspended.current=true;hide();}};
    document.addEventListener('pointerdown',down,true);document.addEventListener('pointerup',up,true);document.addEventListener('selectionchange',update);document.addEventListener('keyup',key,true);document.addEventListener('focusin',outside,true);
    const moved=()=>{if(pointer){pointer=null;suspended.current=true;hide();}else update();};
    const changed=()=>{pointer=null;suspended.current=true;hide();};
    document.addEventListener('scroll',moved,true);window.addEventListener('resize',moved);window.addEventListener('moki:preview-location-changed',changed);
    return()=>{clearTimeout(timer);document.removeEventListener('pointerdown',down,true);document.removeEventListener('pointerup',up,true);document.removeEventListener('selectionchange',update);document.removeEventListener('keyup',key,true);document.removeEventListener('focusin',outside,true);document.removeEventListener('scroll',moved,true);window.removeEventListener('resize',moved);window.removeEventListener('moki:preview-location-changed',changed);};
  },[root,active]);
  useEffect(()=>setSelected(null),[sourceText]);
  const label=uiText(selected?.selection.selectedText?.trim()?'引用选区与 DSH 对话':'在此处与 DSH 对话');
  return selected&&active?createPortal(<button type="button" data-selection-chat-action className="moki-selection-chat-action" style={{left:selected.x,top:selected.y}} aria-label={label} title={label} onPointerDown={event=>event.preventDefault()} onMouseDown={event=>event.preventDefault()} onClick={()=>{suspended.current=true;latest.current.onQuote(selected.selection,{x:selected.x,y:selected.y});setSelected(null);}}><span className="dsh-whale" aria-hidden="true"/></button>,document.body):null;
}

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { l as uiText } from '../../../../src/i18n.js';
import { mappedHtmlNodes, type HtmlSegment } from '../lib/html-selection.js';
import type { PreviewSelection } from './resource-preview-selection.js';

// Scripts remain disabled. Only our parent renderer observes the sandboxed
// document; HTML authors cannot run handlers or access the collaboration bridge.
export function HtmlPreview({source,title,active,onSelection,onQuote,changes=[]}:{
  source:string;title:string;active:boolean;
  onSelection:(value:PreviewSelection)=>void;
  onQuote:(value:PreviewSelection,anchor:{x:number;y:number})=>void;
  changes?:{start:number;end:number}[];
}) {
  const frame=useRef<HTMLIFrameElement>(null),callbacks=useRef({onSelection,onQuote,active,changes});
  callbacks.current={onSelection,onQuote,active,changes};
  const [loaded,setLoaded]=useState(0),[action,setAction]=useState<{value:PreviewSelection;x:number;y:number}>();
  const scroll=useRef({x:0,y:0}),selected=useRef<PreviewSelection>({});
  useEffect(()=>{
    const element=frame.current,doc=element?.contentDocument,win=element?.contentWindow;
    setAction(undefined); selected.current={}; callbacks.current.onSelection({});
    if(!doc || !win || doc.URL!=='about:srcdoc')return;
    const mapped=mappedHtmlNodes(source,doc);
    win.scrollTo(scroll.current.x,scroll.current.y);
    const style=doc.createElement('style');
    style.textContent='::selection{background:#b6d3ff!important;color:#14243d!important}::highlight(moki-ai-edit){background:#ffe49a;color:#241a00;text-decoration:underline #b57b00}';
    doc.head.append(style);
    const locate=()=>{
      const selection=win.getSelection();
      if(!callbacks.current.active){setAction(undefined);return;}
      if(!selection?.rangeCount || selection.isCollapsed){setAction(undefined);selected.current={};callbacks.current.onSelection({});return;}
      const range=selection.getRangeAt(0),segments:HtmlSegment[]=[],parts:string[]=[];
      for(const entry of mapped){
        if(!range.intersectsNode(entry.node))continue;
        const from=range.startContainer===entry.node?range.startOffset:0,to=range.endContainer===entry.node?range.endOffset:entry.text.length;
        if(to<=from)continue;
        segments.push({start:entry.start,end:entry.end,from,to});parts.push(entry.text.slice(from,to));
      }
      const text=selection.toString(),exact=parts.join('');
      if(!text.trim() || !segments.length){setAction(undefined);return;}
      const first=segments[0],entry=mapped.find(n=>n.start===first.start)!;
      const parent=entry.node.parentElement;
      const rects=[...range.getClientRects()],rect=rects.at(-1)||range.getBoundingClientRect(),bounds=element!.getBoundingClientRect();
      const x=Math.max(bounds.left+4,Math.min(bounds.right-36,bounds.left+rect.right+6)),y=Math.max(bounds.top+4,Math.min(bounds.bottom-34,bounds.top+rect.bottom+5));
      const value:PreviewSelection={selectedText:text.slice(0,8000),selectedTextTruncated:text.length>8000,
        location:{kind:'html',scope:'rendered',line:entry.line,element:parent?.id?'#'+parent.id:parent?.tagName.toLowerCase(),start:first.start,end:segments.at(-1)!.end},
        ...(segments.length<=256 && exact.length<=8000 && range.toString()===exact ? {htmlSelection:{segments,expectedText:exact}} : {})};
      selected.current=value; callbacks.current.onSelection(value);setAction({value,x,y});
    };
    const onScroll=()=>{scroll.current={x:win.scrollX,y:win.scrollY};setAction(undefined);};
    const key=(event:KeyboardEvent)=>{
      if(event.altKey && !event.ctrlKey && !event.metaKey && event.code==='KeyD'){
        event.preventDefault();locate();const b=element!.getBoundingClientRect();callbacks.current.onQuote(selected.current,{x:b.left+24,y:b.top+32});setAction(undefined);
      }
    };
    doc.addEventListener('selectionchange',locate);doc.addEventListener('pointerup',locate);doc.addEventListener('keyup',locate);doc.addEventListener('keydown',key);
    win.addEventListener('scroll',onScroll);window.addEventListener('resize',onScroll);
    return()=>{doc.removeEventListener('selectionchange',locate);doc.removeEventListener('pointerup',locate);doc.removeEventListener('keyup',locate);doc.removeEventListener('keydown',key);win.removeEventListener('scroll',onScroll);window.removeEventListener('resize',onScroll);style.remove();};
  },[source,loaded]);
  useEffect(()=>{
    const doc=frame.current?.contentDocument,win=frame.current?.contentWindow as any;
    if(!doc || doc.URL!=='about:srcdoc' || !win?.CSS?.highlights)return;
    const ranges=mappedHtmlNodes(source,doc).filter(n=>changes.some(c=>c.end>=n.start && c.start<=n.end)).map(n=>{const range=doc.createRange();range.selectNodeContents(n.node);return range;});
    win.CSS.highlights.set('moki-ai-edit',new win.Highlight(...ranges));
    return()=>win.CSS.highlights.delete('moki-ai-edit');
  },[source,loaded,changes]);
  return <><iframe ref={frame} title={title} srcDoc={source} onLoad={()=>setLoaded(n=>n+1)}
    sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"
    referrerPolicy="no-referrer" className="size-full border-0 bg-white" data-moki-html-preview="true"/>
    {active && action ? createPortal(<button type="button" className="moki-selection-chat-action" data-selection-chat-action
      style={{left:action.x,top:action.y}} title={uiText('引用选区与 DSH 对话')} aria-label={uiText('引用选区与 DSH 对话')}
      onPointerDown={e=>e.preventDefault()} onMouseDown={e=>e.preventDefault()}
      onClick={()=>{callbacks.current.onQuote(action.value,{x:action.x,y:action.y});setAction(undefined);}}><span className="dsh-whale" aria-hidden="true"/></button>,document.body):null}</>;
}

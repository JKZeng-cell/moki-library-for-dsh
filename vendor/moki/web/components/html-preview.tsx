import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { l as uiText } from '../../../../src/i18n.js';
import { mappedHtmlNodes, mappedHtmlElements, htmlModuleAt, htmlElementLabel, type HtmlSegment } from '../lib/html-selection.js';
import type { PreviewSelection } from './resource-preview-selection.js';

// Scripts remain disabled. Only our parent renderer observes the sandboxed
// document; HTML authors cannot run handlers or access the collaboration bridge.
export function HtmlPreview({source,title,active,selectModules=false,onSelection,onQuote,changes=[]}:{
  source:string;title:string;active:boolean;selectModules?:boolean;
  onSelection:(value:PreviewSelection)=>void;
  onQuote:(value:PreviewSelection,anchor:{x:number;y:number})=>void;
  changes?:{start:number;end:number}[];
}) {
  const frame=useRef<HTMLIFrameElement>(null),callbacks=useRef({onSelection,onQuote,active,changes});
  callbacks.current={onSelection,onQuote,active,changes};
  const [loaded,setLoaded]=useState(0),[action,setAction]=useState<{value:PreviewSelection;x:number;y:number}>();
  type Outline={left:number;top:number;width:number;height:number;label:string;labelTop:number;element:string};
  const [outlines,setOutlines]=useState<{hover?:Outline;chosen?:Outline}>({});
  const scroll=useRef({x:0,y:0}),selected=useRef<PreviewSelection>({});
  useEffect(()=>{
    const element=frame.current,doc=element?.contentDocument,win=element?.contentWindow;
    setAction(undefined);setOutlines({}); selected.current={}; callbacks.current.onSelection({});
    if(!doc || !win || doc.URL!=='about:srcdoc')return;
    const mapped=mappedHtmlNodes(source,doc);
    const elements=selectModules?mappedHtmlElements(source,doc):new Map();
    let hovered:Element|null=null,chosen:Element|null=null,animation=0;
    win.scrollTo(scroll.current.x,scroll.current.y);
    const style=doc.createElement('style');
    style.textContent='::selection{background:#b6d3ff!important;color:#14243d!important}::highlight(moki-ai-edit){background:#ffe49a;color:#241a00;text-decoration:underline #b57b00}';
    doc.head.append(style);
    const outline=(node:Element|null):Outline|undefined=>{
      if(!node?.isConnected)return;
      const r=node.getBoundingClientRect(),b=element!.getBoundingClientRect();
      let left=Math.max(b.left,b.left+r.left),top=Math.max(b.top,b.top+r.top),right=Math.min(b.right,b.left+r.right),bottom=Math.min(b.bottom,b.top+r.bottom);
      for(let parent=node.parentElement;parent&&parent!==doc.body;parent=parent.parentElement){
        const style=win.getComputedStyle(parent),clip=parent.getBoundingClientRect();
        if(['hidden','auto','scroll','clip'].includes(style.overflowX)){left=Math.max(left,b.left+clip.left);right=Math.min(right,b.left+clip.right);}
        if(['hidden','auto','scroll','clip'].includes(style.overflowY)){top=Math.max(top,b.top+clip.top);bottom=Math.min(bottom,b.top+clip.bottom);}
      }
      if(right<=left||bottom<=top)return;
      const label=/^H[1-6]$/.test(node.tagName)?'标题':({P:'段落',IMG:'图片',SVG:'图片',A:'链接',BUTTON:'按钮',TABLE:'表格',TR:'表格行',TD:'单元格',TH:'单元格',UL:'列表',OL:'列表',LI:'列表项',FORM:'表单'} as Record<string,string>)[node.tagName]||'模块';
      return {left,top,width:right-left,height:bottom-top,label:uiText(label),element:htmlElementLabel(node),labelTop:top-b.top>=22?-22:bottom+22<=b.bottom?bottom-top+2:2};
    };
    const redraw=()=>{
      animation=0;if(!callbacks.current.active)return;
      const box=outline(chosen);setOutlines({hover:hovered!==chosen?outline(hovered):undefined,chosen:box});
      if(chosen)setAction(box?{value:selected.current,x:Math.max(box.left,Math.min(element!.getBoundingClientRect().right-36,box.left+box.width-30)),y:Math.max(element!.getBoundingClientRect().top+4,Math.min(element!.getBoundingClientRect().bottom-34,box.top+box.height+5))}:undefined);
    };
    const schedule=()=>{if(!animation)animation=window.requestAnimationFrame(redraw);};
    const selectModule=(node:Element|null)=>{
      chosen=node;hovered=node;win.getSelection()?.removeAllRanges();
      const entry=node&&elements.get(node);
      if(!node||!entry){selected.current={};callbacks.current.onSelection({});setAction(undefined);schedule();return;}
      const entries=mapped.filter(n=>node.contains(n.node)&&n.node.parentElement&&win.getComputedStyle(n.node.parentElement).visibility!=='hidden'&&n.node.parentElement.getClientRects().length);
      while(entries.length&&!entries[0].text.trim())entries.shift();while(entries.length&&!entries.at(-1)!.text.trim())entries.pop();
      const exact=entries.map(n=>n.text).join(''),segments=entries.map(n=>({start:n.start,end:n.end,from:0,to:n.text.length})).filter(n=>n.to>0);
      const value:PreviewSelection={selectedText:exact.slice(0,8000),selectedTextTruncated:exact.length>8000,
        location:{kind:'html',scope:'rendered',module:true,element:htmlElementLabel(node),line:entry.line,start:entry.start,end:entry.end},
        htmlModule:{source:source.slice(entry.start,Math.min(entry.end,entry.start+8000)),truncated:entry.end-entry.start>8000},
        ...(segments.length&&segments.length<=256&&exact.length<=8000?{htmlSelection:{segments,expectedText:exact}}:{})};
      selected.current=value;callbacks.current.onSelection(value);schedule();
    };
    const locate=()=>{
      if(selectModules)return;
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
    const onScroll=()=>{scroll.current={x:win.scrollX,y:win.scrollY};if(selectModules){hovered=null;schedule();}else setAction(undefined);};
    const move=(event:PointerEvent)=>{
      if(!selectModules||!callbacks.current.active)return;
      const candidate=htmlModuleAt(doc.elementFromPoint(event.clientX,event.clientY),elements,win);
      if(candidate!==hovered){hovered=candidate;schedule();}
    };
    const leave=()=>{hovered=null;schedule();};
    const select=(event:MouseEvent)=>{
      if(!selectModules||!callbacks.current.active||event.button!==0)return;
      event.preventDefault();event.stopImmediatePropagation();win.focus();
      selectModule(htmlModuleAt(doc.elementFromPoint(event.clientX,event.clientY),elements,win));
    };
    const down=(event:PointerEvent)=>{if(selectModules&&callbacks.current.active&&event.button===0)event.preventDefault();};
    const key=(event:KeyboardEvent)=>{
      if(selectModules&&event.key==='Escape'){event.preventDefault();selectModule(null);return;}
      if(selectModules&&chosen&&event.altKey&&event.key==='ArrowUp'){
        const parent=htmlModuleAt(chosen.parentElement,elements,win);if(parent){event.preventDefault();selectModule(parent);}return;
      }
      if(event.altKey && !event.ctrlKey && !event.metaKey && event.code==='KeyD'){
        event.preventDefault();locate();const b=element!.getBoundingClientRect();callbacks.current.onQuote(selected.current,{x:b.left+24,y:b.top+32});setAction(undefined);
      }
    };
    doc.addEventListener('selectionchange',locate);doc.addEventListener('pointerup',locate);doc.addEventListener('keyup',locate);doc.addEventListener('keydown',key);
    doc.addEventListener('pointermove',move);doc.addEventListener('pointerleave',leave);doc.addEventListener('click',select,true);doc.addEventListener('pointerdown',down,true);
    doc.addEventListener('scroll',onScroll,true);window.addEventListener('resize',onScroll);
    const observer=new ResizeObserver(()=>{if(selectModules)schedule();});observer.observe(element!);if(doc.body)observer.observe(doc.body);
    return()=>{doc.removeEventListener('selectionchange',locate);doc.removeEventListener('pointerup',locate);doc.removeEventListener('keyup',locate);doc.removeEventListener('keydown',key);doc.removeEventListener('pointermove',move);doc.removeEventListener('pointerleave',leave);doc.removeEventListener('click',select,true);doc.removeEventListener('pointerdown',down,true);doc.removeEventListener('scroll',onScroll,true);window.removeEventListener('resize',onScroll);observer.disconnect();window.cancelAnimationFrame(animation);style.remove();};
  },[source,loaded,selectModules,active]);
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
    {active&&selectModules?createPortal(<>{(['hover','chosen'] as const).map(kind=>{const box=outlines[kind];return box?<div key={kind} className="moki-html-module-outline" data-module-outline={kind} data-module-element={box.element} style={{left:box.left,top:box.top,width:box.width,height:box.height}}><span style={{top:box.labelTop}}>{box.label}</span></div>:null;})}</>,document.body):null}
    {active && action ? createPortal(<button type="button" className="moki-selection-chat-action" data-selection-chat-action
      style={{left:action.x,top:action.y}} title={uiText('引用选区与 DSH 对话')} aria-label={uiText('引用选区与 DSH 对话')}
      onPointerDown={e=>e.preventDefault()} onMouseDown={e=>e.preventDefault()}
      onClick={()=>{callbacks.current.onQuote(action.value,{x:action.x,y:action.y});setAction(undefined);}}><span className="dsh-whale" aria-hidden="true"/></button>,document.body):null}</>;
}

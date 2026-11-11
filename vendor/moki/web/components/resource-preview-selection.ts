export type PreviewSelection = { selectedText?: string|null; selectedTextTruncated?: boolean; caret?: {start:number;end:number}|null; location?: Record<string,any>; [key:string]:any };
const elementOf=(node:Node|null)=>node instanceof Element?node:node?.parentElement;
const position=(text:string,offset:number)=>{const before=text.slice(0,offset),lines=before.split('\n');return {line:lines.length,column:lines.at(-1)!.length+1}};
function locationOf(element:Element){
  const context=element.closest<HTMLElement>('[data-moki-location]');
  try{return context?JSON.parse(context.dataset.mokiLocation!):{}}catch{return {}}
}
export function readPreviewSelection(root:HTMLElement|null,eventTarget?:EventTarget|null,sourceText?:string):PreviewSelection|undefined {
  if(!root)return;
  const active=document.activeElement;
  if(active instanceof HTMLTextAreaElement && active.getAttribute('aria-label')==='资料文本编辑器' && root.contains(active)){
    // Textareas normalize Windows CRLF to LF. Translate the displayed caret back
    // to the actual draft, so a range never drifts by one character per line.
    const text=sourceText??active.value;
    const sourceOffset=(offset:number)=>{let source=0,visible=0;while(source<text.length&&visible<offset){if(text[source]==='\r'&&text[source+1]==='\n')source++;source++;visible++}return source};
    const start=sourceOffset(active.selectionStart),end=sourceOffset(active.selectionEnd);
    return {selectedText:text.slice(start,end).slice(0,8000)||null,selectedTextTruncated:end-start>8000,caret:{start,end},
      location:{kind:'text',scope:'source',indexUnit:'utf16',start,end,...position(text,start),endLine:position(text,end).line,endColumn:position(text,end).column}};
  }
  const selection=window.getSelection(),range=selection?.rangeCount?selection.getRangeAt(0):null;
  if(range&&!range.collapsed&&root.contains(range.startContainer)&&root.contains(range.endContainer)){
    const start=elementOf(range.startContainer)!,end=elementOf(range.endContainer)!;
    if(start.closest('button,input,textarea,[role=toolbar],.library-extra-toolbar'))return;
    const scope=start.closest<HTMLElement>('[data-moki-selection-text],pre,[data-testid="office-document-preview"]')||root;
    const offset=(node:Node,count:number)=>{const before=document.createRange();before.selectNodeContents(scope);before.setEnd(node,count);return before.toString().length};
    const text=selection!.toString(),location={kind:'text',scope:scope.hasAttribute('data-moki-text-source')?'source':'rendered',indexUnit:'utf16',...locationOf(start),start:offset(range.startContainer,range.startOffset),end:scope.contains(range.endContainer)?offset(range.endContainer,range.endOffset):undefined};
    const endLocation=locationOf(end);
    if(endLocation.page&&endLocation.page!==location.page)location.endPage=endLocation.page;
    if(location.scope==='source'){Object.assign(location,position(scope.textContent||'',location.start));const finish=position(scope.textContent||'',location.end??location.start);Object.assign(location,{endLine:finish.line,endColumn:finish.column})}
    const cells:HTMLElement[]=[],first=start.closest<HTMLTableCellElement>('td[data-cell]'),last=end.closest<HTMLTableCellElement>('td[data-cell]'),table=first?.closest('table');
    if(first&&last&&table===last.closest('table'))for(let row=(first.parentElement as HTMLTableRowElement).rowIndex;row<=(last.parentElement as HTMLTableRowElement).rowIndex&&cells.length<200;row++)for(const cell of table!.rows[row].cells){if(cells.length>=200)break;if(cell.matches('td[data-cell]')&&range.intersectsNode(cell))cells.push(cell)}
    return {selectedText:text.slice(0,8000),selectedTextTruncated:text.length>8000,location:cells.length?{...location,kind:'sheet',range:[first?.dataset.cell||cells[0].dataset.cell,last?.dataset.cell||cells.at(-1)!.dataset.cell].join(':'),cellsTruncated:cells.length>=200,cells:cells.map(c=>({address:c.dataset.cell,value:c.textContent?.slice(0,1000),formula:c.dataset.formula}))}:location};
  }
  const target=eventTarget instanceof Element?eventTarget:undefined;
  if(!target||!root.contains(target)||target.closest('button,input,textarea,.library-extra-toolbar'))return;
  const entry=target.closest<HTMLElement>('[data-moki-entry]');
  if(entry)return {selectedText:entry.dataset.mokiEntry,location:{kind:'archive-entry',...locationOf(entry),path:entry.dataset.mokiEntry}};
  const cell=target.closest<HTMLElement>('td[data-cell]');
  if(cell)return {selectedText:cell.textContent||null,location:{kind:'sheet',...locationOf(cell),range:cell.dataset.cell,formula:cell.dataset.formula}};
  return {selectedText:null,caret:null,location:locationOf(target)};
}
export function selectionLabel(location?:Record<string,any>){
  if(!location)return '';
  if(location.range)return [location.sheetName,location.range].filter(Boolean).join('!');
  if(location.path)return location.path;
  if(location.region)return `区域 ${location.region.x},${location.region.y} · ${location.region.width}×${location.region.height}`;
  if(location.kind==='slide'){
    const range=location.textSelection,ids=location.selectedElementIds||[];
    return [location.page?`第 ${location.page} 页`:location.slideName||location.slideId,range?`${range.elementId} · 字符 ${range.startOffset}–${range.endOffset}`:ids.length?`${ids.length} 个对象`:''].filter(Boolean).join(' · ');
  }
  if(location.kind==='document'&&location.startOffset!==undefined)return [location.page?`第 ${location.page} 页`:'',`字符 ${location.startOffset}–${location.endOffset??location.startOffset}`].filter(Boolean).join(' · ');
  if(location.page)return `第 ${location.page}${location.endPage?'–'+location.endPage:''} 页`;
  if(location.time!==undefined)return `${Number(location.time).toFixed(2)} 秒`;
  if(location.line)return `第 ${location.line} 行${location.column!==undefined?`，第 ${location.column} 列`:''}`;
  if(location.byteOffset!==undefined)return `分段 ${location.byteOffset} 字节起 · 字符 ${location.start??0}`;
  if(location.start!==undefined)return `字符 ${location.start}–${location.end??location.start}`;
  return '';
}
export function previewLocation(root:HTMLElement|null):Record<string,any>{
  if(!root)return {};
  const context=root.querySelector<HTMLElement>('[data-moki-view-context]');
  let location:Record<string,any>={};try{location=JSON.parse(context?.dataset.mokiViewContext||'{}')}catch{}
  const media=root.querySelector<HTMLMediaElement>('video,audio');
  if(media)location={...location,kind:media.tagName.toLowerCase(),time:Math.round(media.currentTime*1000)/1000,duration:Number.isFinite(media.duration)?media.duration:null};
  return location;
}
export type VisualSnapshot={data:string;mediaType:'image/webp';width:number;height:number;location:Record<string,any>};
export function capturePreviewVisual(root:HTMLElement,region?:{left:number;top:number;right:number;bottom:number}):VisualSnapshot|undefined {
  root.dispatchEvent(new CustomEvent('moki:capture-preview',{bubbles:true}));
  const candidates=[...root.querySelectorAll<HTMLImageElement|HTMLVideoElement|HTMLCanvasElement>('img,video,canvas')].filter(e=>e.getBoundingClientRect().width>40&&e.getBoundingClientRect().height>40);
  const visible=root.getBoundingClientRect(),selected=region||visible;
  let best:any;
  for(const element of candidates){
    const width=element instanceof HTMLImageElement?element.naturalWidth:element instanceof HTMLVideoElement?element.videoWidth:element.width;
    const height=element instanceof HTMLImageElement?element.naturalHeight:element instanceof HTMLVideoElement?element.videoHeight:element.height;
    if(!width||!height)continue;
    const r=element.getBoundingClientRect();let left=r.left,top=r.top,w=r.width,h=r.height;
    if(getComputedStyle(element).objectFit==='contain'){const scale=Math.min(w/width,h/height);left+=(w-width*scale)/2;top+=(h-height*scale)/2;w=width*scale;h=height*scale}
    const x=Math.max(selected.left,left,visible.left),y=Math.max(selected.top,top,visible.top),right=Math.min(selected.right,left+w,visible.right),bottom=Math.min(selected.bottom,top+h,visible.bottom),area=(right-x)*(bottom-y);
    if(right<=x||bottom<=y||best&&area<=best.area)continue;
    best={element,width,height,left,top,w,h,x,y,right,bottom,area};
  }
  if(!best)return;
  const b=best,x=Math.max(0,Math.floor((b.x-b.left)/b.w*b.width)),y=Math.max(0,Math.floor((b.y-b.top)/b.h*b.height)),width=Math.min(b.width-x,Math.ceil((b.right-b.x)/b.w*b.width)),height=Math.min(b.height-y,Math.ceil((b.bottom-b.y)/b.h*b.height));
  const canvas=document.createElement('canvas'),scale=Math.min(1,1600/Math.max(width,height));canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
  const ctx=canvas.getContext('2d')!;ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(b.element,x,y,width,height,0,0,canvas.width,canvas.height);
  return {data:canvas.toDataURL('image/webp',.85).split(',')[1],mediaType:'image/webp',width:canvas.width,height:canvas.height,
    location:{...previewLocation(root),...locationOf(b.element),kind:region?'visual-region':'visual',coordinateSpace:'preview-pixels',surface:{width:b.width,height:b.height},region:{x,y,width,height}}};
}

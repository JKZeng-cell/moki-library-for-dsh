// Runs in the Office iframe so canvas and DOM coordinates share one viewport.
// The action decorates the viewer only; it never changes a document's contents.
export function installOfficeSelectionAction({readSelection,findService,prepare,whale}) {
  if(!document.createElement)return
  const button=document.createElement('button'),style=document.createElement('style')
  button.type='button';button.hidden=true;button.dataset.selectionChatAction=''
  button.innerHTML=whale
  style.textContent='[data-selection-chat-action]{position:fixed;z-index:2000;display:grid;place-items:center;width:32px;height:30px;padding:6px;border:1px solid var(--moki-border,#85858d);border-radius:8px;background:var(--moki-popover,Canvas);color:var(--moki-label,CanvasText);box-shadow:0 3px 12px #0003;cursor:pointer;user-select:none;touch-action:manipulation}[data-selection-chat-action][hidden]{display:none}[data-selection-chat-action]:hover{background:var(--moki-hover,ButtonFace)}[data-selection-chat-action]:focus-visible{outline:2px solid #7198f7;outline-offset:2px}[data-selection-chat-action]>svg{width:18px;height:16px;fill:currentColor}'
  document.head.append(style)
  if(document.body)document.body.append(button)
  else document.addEventListener('DOMContentLoaded',()=>document.body.append(button),{once:true})
  let timer,dragging=false,enabled=false,point=null,captured=null
  const hide=()=>{button.hidden=true;captured=null}
  function textGeometry(selection) {
    if(selection.kind!=='document'&&!selection.textSelection)return null
    const doc=window.univerAPI?.getActiveDocument?.()
    if(!doc)return null
    const manager=findService(doc,v=>v?._context?.unitId===doc.getId()&&typeof v?.getAllTextRanges==='function')
    const range=manager?.getActiveTextRange?.(),box=range?.getAbsolutePosition?.()
    const scene=manager?._context?.scene,viewport=manager?.activeViewPort||scene?.getMainViewport?.(),canvas=scene?.getEngine?.()?.getCanvasElement?.()
    if(!box||!viewport||!canvas)return null
    const bounds=canvas.getBoundingClientRect()
    // Use the same projection as the Office caret, including zoom and scroll.
    const project=(x,y)=>{const vector=scene.transform.applyPoint({x:0,y:0});vector.x=x;vector.y=y;const p=viewport.getAbsoluteVector(vector);return{x:bounds.left+p.x,y:bounds.top+p.y}}
    const start=project(box.left,box.top),end=project(box.left+box.width,box.top+box.height)
    return {x:range.direction==='backward'?start.x:end.x,top:start.y,bottom:range.direction==='backward'?start.y:end.y,bounds}
  }
  function update() {
    clearTimeout(timer);timer=setTimeout(()=>{
      if(!enabled||dragging){hide();return}
      try {
        const selection=readSelection()
        if(!selection?.selectedText?.trim()||selection.collapsed||selection.textSelection?.collapsed){hide();return}
        const geometry=textGeometry(selection)||point
        if(!geometry){hide();return}
        const bounds=geometry.bounds||{left:0,right:innerWidth,top:0,bottom:innerHeight}
        if(geometry.bottom<bounds.top||geometry.top>bounds.bottom||geometry.x<bounds.left||geometry.x>bounds.right){hide();return}
        const x=Math.max(bounds.left+4,Math.min(innerWidth-38,bounds.right-36,geometry.x))
        const bottom=Math.min(innerHeight-36,bounds.bottom-34),y=Math.max(bounds.top+4,Math.min(bottom,geometry.bottom+6<=bottom?geometry.bottom+6:geometry.top-38))
        const label=/^zh/i.test(document.documentElement.lang||new URLSearchParams(location.search).get('lang')||'zh')?'引用选区与 DSH 对话':'Quote selection in DSH'
        button.title=label;button.setAttribute('aria-label',label);button.style.left=x+'px';button.style.top=y+'px';button.hidden=false
        captured={selection,x,y}
      }catch{hide()}
    },100)
  }
  // Keep both the native canvas selection and the last exact text range intact.
  // Install before Office boots: its outside-pointer handler otherwise commits
  // a slide's live text box before our click, unexpectedly resizing the shape.
  for(const type of ['pointerdown','mousedown','pointerup','mouseup'])document.addEventListener(type,event=>{if(button.contains(event.target)){event.preventDefault();event.stopImmediatePropagation()}},true)
  const invoke=async()=>{
    const request=captured;if(!request)return
    enabled=false;hide();await prepare()
    window.parent.postMessage({type:'moki:univer-compose-shortcut',editorSelection:request.selection,selectedText:request.selection.selectedText,x:request.x,y:request.y,quoteSelection:true},'*')
  }
  document.addEventListener('click',event=>{if(button.contains(event.target)){event.preventDefault();event.stopImmediatePropagation();void invoke()}},true)
  document.addEventListener('pointerdown',event=>{
    if(button.contains(event.target))return
    enabled=event.target instanceof HTMLCanvasElement||Boolean(event.target?.closest?.('[data-u-comp="shape-text-editor-content"]'))
    dragging=enabled;hide()
  },true)
  document.addEventListener('pointerup',event=>{
    if(button.contains(event.target))return
    if(dragging){const canvas=event.target instanceof HTMLCanvasElement?event.target:null;point={x:event.clientX,top:event.clientY,bottom:event.clientY,bounds:canvas?.getBoundingClientRect()}}
    dragging=false;update()
  },true)
  document.addEventListener('keyup',event=>{
    if(event.key==='Escape'){enabled=false;hide();return}
    if(!event.target?.closest?.('[data-u-comp="editor"],[data-u-comp="shape-text-editor-content"]')&&!(event.target instanceof HTMLCanvasElement)&&event.target!==button){enabled=false;hide();return}
    if(event.shiftKey&&/^(Arrow|Home|End|Page)/.test(event.key))enabled=true
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='a')enabled=true
    update()
  },true)
  document.addEventListener('selectionchange',update)
  // Canvas scrolls have no DOM scroll event. Hide until the next selection;
  // a stale action must never float over a different page after a wheel gesture.
  document.addEventListener('wheel',()=>{enabled=false;hide()},{passive:true,capture:true})
  document.addEventListener('scroll',()=>{enabled=false;hide()},true)
  window.addEventListener('resize',()=>{enabled=false;hide()})
  window.addEventListener('blur',()=>{enabled=false;hide()})
}

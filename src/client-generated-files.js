import {l as uiText,useLibraryLocale} from './i18n.js'
import {generatedRequest,createFileDestination} from './client-file-destination.js'

export function generatedCoordinates(actionUrl) {
  const url=new URL(actionUrl,location.href)
  const kind=url.pathname==='/api/present.open'?'present':url.pathname==='/api/changes.open'?'change':null
  if(url.origin!==location.origin||!kind)throw Error('Invalid DSH file reference')
  const sessionId=url.searchParams.get('sessionId'),seq=url.searchParams.get('seq'),index=url.searchParams.get('index')
  if(!sessionId||!/^\d+$/.test(seq??'')||!/^\d+$/.test(index??''))throw Error('Invalid DSH file coordinates')
  return {kind,sessionId,seq:Number(seq),index:Number(index)}
}
export function registerGeneratedFileActions(ctx,React,{Icon,ui,pool,Modal}) {
  const h=React.createElement,pending=new Map()
  let destination=null
  const listeners=new Set(),notify=()=>{for(const listener of listeners)listener()}
  const FileDestination=createFileDestination(React,{Icon,ui,pool,Modal})
  function DestinationHost(){
    const file=React.useSyncExternalStore(listener=>{listeners.add(listener);return ()=>listeners.delete(listener)},()=>destination)
    return file&&h(FileDestination,{key:JSON.stringify(file),file,onClose:()=>{destination=null;notify()}})
  }
  ctx.slots.inject('shell.overlay',()=>ctx.slots.register({name:'shell.overlay',id:'moki-library.destination'},DestinationHost))
  const open=input=>{
    const key=JSON.stringify(input)
    if(pending.has(key))return pending.get(key)
    const task=(async()=>{
      const result=await generatedRequest(input)
      await pool.openFile(result.item,input.sessionId)
    })().finally(()=>pending.delete(key))
    pending.set(key,task);return task
  }
  function Action({actionUrl,pending:hostPending}) {
    useLibraryLocale(React)
    const [busy,setBusy]=React.useState(false),[error,setError]=React.useState('')
    return h('span',{className:'ml-generated-action'},h(ui.Button,{type:'button',variant:'outline',className:'ml-generated-open',disabled:busy||hostPending,
      title:uiText('在 MOKI资料库中打开'),'aria-label':uiText('在 MOKI资料库中打开'),onClick:async event=>{
        event.stopPropagation();setBusy(true);setError('')
        try{await open(generatedCoordinates(actionUrl))}catch(e){setError(e.message)}finally{setBusy(false)}
      }},h(Icon),h('span',null,busy?uiText('正在打开…'):uiText('资料库'))),error&&h('span',{role:'alert',className:'ml-generated-error'},error))
  }
  for(const name of ['deliverables.file.actions','deliverables.review.file.actions'])ctx.slots.inject(name,()=>ctx.slots.register({name,id:'moki-library.open',order:-5},Action))
  ctx.inject(['contextMenus','remote','remote.workspaceFiles'],child=>{
    child.slots.inject('contextMenu.icon',()=>child.slots.register({name:'contextMenu.icon',key:'moki-library.open'},Icon))
    child.effect(()=>child.contextMenus.register({id:'moki-library.open',target:'file',order:110,
      resolve:async({sessionId,path},signal)=>{
        const result=await child.remote.workspaceFiles.stat(sessionId,path,signal)
        signal.throwIfAborted()
        return [{id:'moki-library.open',icon:{key:'moki-library.open'},label:uiText('在 MOKI资料库中打开'),disabled:!result.ok,
          failureLabel:uiText('无法在资料库中打开此文件'),run:()=>open({kind:'path',sessionId,path:result.value.absolutePath})},
          {id:'moki-library.add',icon:{key:'moki-library.open'},label:uiText('添加到 MOKI资料库'),disabled:!result.ok,
            failureLabel:uiText('无法读取此文件'),run:()=>{if(destination)return;destination={kind:'path',sessionId,path:result.value.absolutePath};notify()}}]
      }
    }),'moki-library: file context action')
  })
}

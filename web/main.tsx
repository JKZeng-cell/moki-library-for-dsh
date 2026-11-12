import { l as uiText, setLocale, getLocale, useLibraryLocale } from '../src/i18n.js';
import React from 'react'
import {createRoot} from 'react-dom/client'
import { LibraryPage } from '../vendor/moki/web/pages/library-page'
import { PageStateProvider } from '../vendor/moki/web/lib/page-state'
import { apiFetch } from '../vendor/moki/web/lib/api-fetch'
import { collectDragFiles,warmNativeFileDrag } from '../vendor/moki/web/lib/library-drag'
import {DocumentPreview} from './document-preview'
import { WORKBENCH_SELECTION_EVENT, MOKI_ASSISTANT_COMPOSE_EVENT, MOKI_ASSISTANT_EDITOR_EXIT_EVENT } from '../vendor/moki/web/lib/workbench-selection-context'
import './base.css'
import '../vendor/moki/web/ui-foundations.css'
import '../vendor/moki/web/ui-motion.css'
import './theme.css'
import './library.css'
import './preview.css'

const query=new URLSearchParams(location.search)
const parentOrigin=query.get('parent') || '', bridge=query.get('bridge') || ''
const standalone=query.get('mode')==='window', documentId=query.get('document')
let active=standalone,seq=0
let documentName=''
let chatId:string|null=query.get('chatId'), previewId:string|null=documentId
let selection: {label:string;content:string;itemCount:number}|null=null
let imagePending:Promise<unknown>=Promise.resolve()
const send=(type:string,value:object={})=>{if(parentOrigin && parent!==window)parent.postMessage({bridge,type,...value},parentOrigin)}
function applyAppearance({dark,theme,font,rootSize,locale}:Record<string,unknown>) {
  if(typeof locale==='string')setLocale(locale)
  document.documentElement.lang=getLocale()==='zh'?'zh-CN':'en'
  document.documentElement.dataset.colorScheme=dark?'dark':'light'
  for(const [name,value] of Object.entries(theme || {})) {
    if(/^--dsw-(?:alias|font|radius)-[a-z0-9-]+$/.test(name) && typeof value==='string') document.documentElement.style.setProperty(name,value)
  }
  if(typeof font==='string')document.documentElement.style.setProperty('--font-ui',font)
  if(typeof rootSize==='string')document.documentElement.style.fontSize=rootSize
}
function documentError(error:unknown){window.dispatchEvent(new CustomEvent('moki:document-error',{detail:error instanceof Error?error.message:String(error)}))}
async function post(path:string,data:object) {
  const result=await apiFetch('/api/dsh/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)})
  if(!result.ok) throw new Error((await result.json()).error || uiText("DSH 连接失败"))
  return result.json()
}
async function publish(focused=false) {
  const state={active,focused,seq:++seq,selection,chatId,previewId}
  try {
    await post('state',state)
    if (seq===state.seq) send('selection',{selection})
    return true
  } catch (error) { send('error',{message:String(error)});return false }
}
const picker=async(kind:string,name='')=>(await post('picker',{kind,name})).path
window.mokiDesktop = {
  selectLibraryFile:()=>picker('file'), selectLocalFolder:()=>picker('folder'), selectSavePath:(name:string)=>picker('save',name),
  copyText:async(text:string)=>{await navigator.clipboard.writeText(text);return true},
} as typeof window.mokiDesktop
window.addEventListener(WORKBENCH_SELECTION_EVENT,event=>{
  const next=(event as CustomEvent).detail
  selection=next?.source==='library'?{label:next.label,content:next.content,itemCount:next.itemCount}:null
  if(standalone)window.dispatchEvent(new CustomEvent('moki:preview-chat-selection',{detail:selection}))
  void publish()
})
window.addEventListener('moki:preview-snapshot',event=>{
  imagePending=post('selection-image',(event as CustomEvent).detail).catch(error=>{documentError(error);throw error})
  void imagePending.catch(()=>undefined)
})
async function compose(event?:Event){
  if(!active && !standalone)return
  const requested=selection,quoteSelection=Boolean((event as CustomEvent|undefined)?.detail?.quoteSelection)
  try{await imagePending}catch{return}
  if(standalone){
    window.dispatchEvent(new CustomEvent('moki:preview-compose',{detail:{selection:requested,quoteSelection}}))
    return
  }
  await publish(true)
  send('compose',{selection:requested,quoteSelection})
}
window.addEventListener(MOKI_ASSISTANT_COMPOSE_EVENT,compose)
window.addEventListener('keydown',event=>{
  if ((!active && !standalone) || event.defaultPrevented || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat || event.isComposing
    || (event.code !== 'KeyD' && event.key.toLowerCase() !== 'd') || document.querySelector('[aria-modal="true"]')) return
  event.preventDefault()
  event.stopPropagation()
  void compose()
})
window.addEventListener(MOKI_ASSISTANT_EDITOR_EXIT_EVENT,()=>{if(standalone)window.dispatchEvent(new Event('moki:hide-preview-chat'));else send('exit')})
window.addEventListener('message',event=>{
  if(event.source!==parent || event.origin!==parentOrigin || event.data?.bridge!==bridge)return
  if(event.data.type==='checkpoint-document' && documentId && event.ports[0])
    window.dispatchEvent(new CustomEvent('moki:checkpoint-document',{detail:event.ports[0]}))
  if(event.data.type==='resume-document')window.dispatchEvent(new Event('moki:resume-document'))
  if(event.data.type==='collect-drag' && active && event.ports[0]) {
    const reply=event.ports[0]
    void collectDragFiles(event.data.token).then(value=>reply.postMessage({value}),error=>reply.postMessage({error:error.message}))
  }
  if(event.data.type==='surface'){
    active=Boolean(event.data.active)
    document.documentElement.dataset.mode=event.data.mode
    applyAppearance(event.data)
    void publish()
  }
  if(event.data.type==='bind-chat') {
    const {requestId,sessionId}=event.data
    chatId=sessionId || null
    void publish(true).then(ok=>send('chat-bound',{requestId,ok}))
  }
  if(event.data.type==='activate-document' && documentId && active){
    chatId=event.data.sessionId
    void publish(true)
  }
  if(event.data.type==='focus-editor') document.querySelector<HTMLElement>('.dsh-file-view textarea, .dsh-file-view iframe[data-office-editor]')?.focus()
})
// A native window retains its capability across reloads. Its OS window owns cleanup.
if(!standalone)window.addEventListener('pagehide',()=>{navigator.sendBeacon(new URL('./api/dsh/close',location.href),'')})
let after=-1,polling=false
async function poll() {
  if(polling)return
  polling=true
  try {
    const response=await apiFetch('/api/dsh/changes?after='+after)
    if(!response.ok)throw new Error(uiText("资料库连接中断"))
    const update=await response.json()
    after=update.version
    if(update.changes.some((e:{operation:string})=>e.operation!=='office-draft')) window.dispatchEvent(new Event('moki:catalog-updated'))
    for(const detail of update.changes) if(detail.itemId && detail.operation!=='catalog') window.dispatchEvent(new CustomEvent('workbench:data-updated',{detail:{...detail,resource:'resource_library'}}))
  } catch(error) { send('error',{message:String(error)}) } finally {polling=false}
}
window.addEventListener('moki:check-catalog', poll)
document.documentElement.dataset.mode=query.get('mode') || 'main'
window.addEventListener('moki:library-location',event=>{
  const detail=(event as CustomEvent).detail
  previewId=detail.previewing ? detail.itemId : null
  send('location',detail)
  void publish()
})
document.documentElement.dataset.colorScheme=query.get('theme')==='dark'?'dark':'light'
const initializeDocument=(data:Parameters<React.ComponentProps<typeof DocumentPreview>['initialize']>[0])=>{
  documentName=data.item.name
  document.title=data.item.name+uiText(" · MOKI资料库")
  if(standalone){chatId=data.chatId || null;if(data.appearance)applyAppearance(data.appearance)}
  send('location',{itemId:documentId,previewing:true});void publish()
}
const closeDocument=()=>{if(standalone)void post('document-action',{action:'close'}).catch(documentError);else send('close-document')}
let chatRequest=Promise.resolve()
const previewChatAction=(action:'compose'|'hide-chat'|'activate-chat')=>{
  const next=chatRequest.then(async()=>{
    if(action==='compose')await publish()
    await post('document-action',{action})
  })
  chatRequest=next.catch(()=>{})
  return next
}
window.addEventListener('moki:document-ready',event=>send('document-ready',(event as CustomEvent).detail))
if(standalone){
  window.addEventListener('focus',()=>{active=true;void publish()})
  window.addEventListener('blur',()=>{active=false;void publish()})
  window.addEventListener('moki:document-appearance',event=>applyAppearance((event as CustomEvent).detail))
} else if(documentId){
  window.addEventListener('focus',()=>{if(active)void publish(true)})
}
function LocalizedLibrary(){
  useLibraryLocale(React)
  document.documentElement.lang=getLocale()==='zh'?'zh-CN':'en'
  document.title=(documentName?documentName+' · ':'')+uiText('MOKI资料库')
  return <PageStateProvider>{documentId
  ? <DocumentPreview standalone={standalone} resumeOffice={query.get('resumeOffice')==='1'} initialize={initializeDocument} close={closeDocument} chatAction={previewChatAction}
      dock={async (office,destination)=>{await post('document-action',{action:destination==='main'?'main':'dock',office})}}/>
  : <LibraryPage/>}</PageStateProvider>
}
createRoot(document.getElementById('root')!).render(<LocalizedLibrary/>)
send('ready')
warmNativeFileDrag()
void poll()
setInterval(()=>{if(active || standalone)void poll()},1600)
setInterval(()=>{if(active)void publish()},16000)

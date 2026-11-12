import { l as uiText } from '../src/i18n.js';
import React,{useCallback,useEffect,useRef,useState} from 'react'
import {History,SquarePen,X} from 'lucide-react'
import {useChatLayout} from '../src/chat-layout'
import '../src/client-shell.css'

type Props={origin?:string;action:(value:'compose'|'hide-chat'|'activate-chat')=>Promise<void>}
export function PreviewChat({origin,action}:Props) {
  const layout=useChatLayout(React,'window'), iframe=useRef<HTMLIFrameElement>(null)
  const [visible,show]=useState(false),[generation,mount]=useState(0),[error,setError]=useState('')
  const [connected,setConnected]=useState(false)
  const [status,setStatus]=useState({title:uiText("DSH 对话"),creating:false,history:false})
  const ready=useRef(false),open=useRef(false),selection=useRef<unknown>(null)
  const returnFocus=useRef<HTMLElement|null>(null),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined)
  const sequence=useRef(0)
  const send=useCallback((command:string,data:object={})=>{
    if(origin)iframe.current?.contentWindow?.postMessage({channel:'moki-preview-chat',action:command,...data},origin)
  },[origin])
  const close=useCallback(()=>{
    open.current=false;sequence.current++;clearTimeout(timer.current);show(false)
    void action('hide-chat').catch(()=>{})
    const editor=returnFocus.current?.isConnected && returnFocus.current!==document.body ? returnFocus.current :
      document.querySelector<HTMLElement>('.dsh-file-view textarea,.dsh-file-view iframe,.dsh-file-view [data-dsh-chat-trigger]')
    editor?.focus({preventScroll:true})
  },[action])
  const connect=useCallback((retry=false)=>{
    const current=++sequence.current
    if(!open.current)returnFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null
    open.current=true;show(true);setError('')
    if(retry){ready.current=false;setConnected(false)}
    mount(value=>retry?value+1:Math.max(1,value))
    clearTimeout(timer.current)
    if(!ready.current)timer.current=setTimeout(()=>{if(current===sequence.current && !ready.current)setError(uiText("连接 DSH 超时，请重试。"))},24000)
    void action('compose').then(()=>{
      if(current!==sequence.current || !ready.current)return
      send('selection',{selection:selection.current});send('focus')
    }).catch(e=>{if(current===sequence.current){clearTimeout(timer.current);setError(e.message)}})
  },[action,send])
  useEffect(()=>{
    const invoke=(event:Event)=>{selection.current=(event as CustomEvent).detail;connect()}
    const selected=(event:Event)=>{
      selection.current=(event as CustomEvent).detail
      if(open.current && ready.current)send('selection',{selection:selection.current})
    }
    const activate=()=>{if(open.current && ready.current)void action('activate-chat').catch(()=>{})}
    const receive=(event:MessageEvent)=>{
      if(!origin || event.origin!==origin || event.source!==iframe.current?.contentWindow || event.data?.channel!=='moki-preview-chat')return
      const data=event.data
      if(data.action==='ready'){
        ready.current=true;clearTimeout(timer.current);setConnected(true);setError('')
        send('selection',{selection:selection.current});if(open.current)send('focus')
      }
      if(data.action==='state')setStatus({title:String(data.title),creating:Boolean(data.creating),history:Boolean(data.history)})
      if(data.action==='close' && open.current)close()
      if(data.action==='activate')activate()
    }
    const exit=()=>{if(open.current)close()}
    window.addEventListener('moki:preview-compose',invoke)
    window.addEventListener('moki:preview-chat-selection',selected)
    window.addEventListener('focus',activate)
    window.addEventListener('message',receive)
    window.addEventListener('moki:hide-preview-chat',exit)
    return ()=>{clearTimeout(timer.current);window.removeEventListener('moki:preview-compose',invoke);window.removeEventListener('moki:preview-chat-selection',selected);window.removeEventListener('focus',activate);window.removeEventListener('message',receive);window.removeEventListener('moki:hide-preview-chat',exit)}
  },[action,origin,send,connect,close])
  return <div className="moki-preview-chat-layer" hidden={!visible}>
    <section ref={layout.ref} style={layout.style} className="ml-dialog moki-preview-chat" role="dialog" aria-label={uiText("DSH 编辑协作")}
      onKeyDown={event=>{if(event.key==='Escape' && !event.defaultPrevented){event.preventDefault();close()}}}>
      <div className="ml-chat-head">
        <button type="button" className="ml-chat-move" aria-label={uiText("移动 DSH 浮窗")} title={uiText("拖动移动，方向键微调")} {...layout.handle('move')}><span className="dsh-whale" aria-hidden="true"/><strong>{status.title}</strong></button>
        <button type="button" className="ml-icon-button" aria-label={uiText("新建会话")} title={uiText("新建会话")} disabled={!connected||status.creating} onClick={()=>send('new')}><SquarePen size={16}/></button>
        <button type="button" className="ml-icon-button" aria-label={uiText("历史会话")} title={uiText("历史会话")} disabled={!connected} aria-expanded={status.history} onClick={()=>send('history')}><History size={16}/></button>
        <button type="button" className="ml-icon-button" aria-label={uiText("关闭 DSH 浮窗")} title={uiText("关闭 DSH 浮窗")} onClick={close}><X size={16}/></button>
      </div>
      {generation>0 && <iframe key={generation} ref={iframe} data-moki-preview-chat="" title={uiText("DSH 对话内容")} referrerPolicy="no-referrer" allow="clipboard-read; clipboard-write"/>}
      {(!connected||error) && <div className="moki-preview-chat-status" role={error?'alert':'status'}>{error || uiText("正在连接 DSH…")}{error && <button type="button" onClick={()=>connect(true)}>{uiText("重试")}</button>}</div>}
      {['n','s','e','w','nw','ne','sw','se'].map(edge=><button type="button" key={edge} className="ml-chat-resize" data-edge={edge} tabIndex={edge==='se'?0:-1} aria-hidden={edge!=='se'||undefined} aria-label={uiText("调整 DSH 浮窗大小")} {...layout.handle(edge)}/>)}
    </section>
  </div>
}

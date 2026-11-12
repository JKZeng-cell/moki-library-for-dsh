import { l as uiText, getLocale, subscribeLocale } from './i18n.js';
// Each retained DSH chat owns one library document. Moving it between native
// panels preserves the editor, selection, scroll position and unsaved changes.
import {installLibraryDrag} from './client-drag.js'
import {previewDestination} from './preferences.mjs'
import {createQuickPromptSender} from './quick-prompt.js'

export function createFramePool(isDark,ctx,quote,settings) {
  const submitQuick=createQuickPromptSender(ctx,uiText)
  const entries = new Map()
  const desktop=sessionStorage.getItem('moki-library-desktop') || crypto.randomUUID(), handling=new Set()
  sessionStorage.setItem('moki-library-desktop',desktop)
  let onCommand, timer, polling=false, disposed=false, watch=false, lastAppearance=''
  async function windows(action,fields={}) {
    // DSH desktop resource routes are read through its GET-only protocol handler.
    const request=encodeURIComponent(JSON.stringify({action,client:desktop,...fields}))
    const response=await fetch('/moki-library/windows',{cache:'no-store',headers:{'x-moki-library':'1','x-moki-window-request':request}})
    const result=await response.json()
    if(!response.ok || result.error)throw new Error(result.error || uiText("无法连接 DSH 预览服务"))
    return result
  }
  async function poll() {
    if(disposed || polling)return
    polling=true
    try {
      const {open,commands}=await windows('poll')
      watch=open.length>0
      for(const command of commands) {
        if(handling.has(command.key) || !onCommand)continue
        handling.add(command.key)
        void Promise.resolve().then(()=>onCommand(command)).then(
          ()=>windows('ack',{key:command.key}),error=>windows('ack',{key:command.key,error:String(error.message || error).slice(0,1000)})
        ).catch(()=>{}).finally(()=>handling.delete(command.key))
      }
    } catch { /* Reconnect while a preview is open. */ }
    finally {polling=false;if(watch && !disposed)timer=setTimeout(poll,450)}
  }
  async function openPreview(entry,message) {
    const session=entry.chatSession || entry.state.chatTarget || entry.id
    // The catalog iframe moves between DSH surfaces without reloading its URL.
    const destination=previewDestination(settings.getSnapshot().value?.previewMode ?? entry.initialPreviewMode,entry.mode,message.destination)
    if(destination==='system')return {destination}
    if(destination==='sidebar' || destination==='main'){
      if((await windows('dock-open',{id:message.id,destination})).moving){
        watch=true;clearTimeout(timer);void poll()
        return
      }
      return onCommand({...message,session,action:destination==='main'?'main':'dock'})
    }
    const side=entries.get('moki-document-'+message.id)
    const retained=side?.state.documentReady && side.releaseDocument
    try {
      let office=false
      if(retained){
        const channel=new MessageChannel()
        const checkpoint=new Promise((resolve,reject)=>{
          const timeout=setTimeout(()=>{channel.port1.close();reject(new Error(uiText("侧栏草稿暂时无法转交")))},10000)
          channel.port1.onmessage=({data})=>{clearTimeout(timeout);channel.port1.close();data.error?reject(new Error(data.error)):resolve(data.office)}
        })
        side.frame.contentWindow.postMessage({bridge:side.bridge,type:'checkpoint-document'},side.origin,[channel.port2])
        office=await checkpoint
      }
      const result=await windows('open',{id:message.id,appearance:appearance(),session,office})
      if(retained)side.releaseDocument()
      watch=true;clearTimeout(timer);void poll()
      return result
    } catch(error){if(retained)send(side,'resume-document');throw error}
  }
  const drag = installLibraryDrag(ctx,update,quote)
  const parking = document.createElement('div')
  parking.hidden = true
  document.body.append(parking)
  const colors = [
    'bg-base','bg-layer-1','bg-layer-2','bg-layer-3','bg-mask-2','bg-skeleton','bg-document-preview','bg-multi-select',
    'border-l1','border-l2','border-l3','brand-primary','button-primary-fill','button-primary-hover','button-primary-dimmed',
    'button-floating-fill','interactive-bg-active','interactive-bg-hover','interactive-bg-hover-danger',
    'label-caption','label-primary','label-primary-foreground','label-secondary','label-tertiary','label-dimmed','link','menu-icon',
    'settings-card-fill','settings-card-stroke','scrollbar-bg-l1','scrollbar-hover-l1','markdown-inline-code','markdown-code-block',
    'state-error-primary','state-error-secondary','state-warn-label','state-warn-secondary','state-success-primary','state-success-secondary'
  ]
  const properties = [...colors.map(name=>'--dsw-alias-'+name),
    ...['xxs-12','xs-13','s-14','base-16','l-20'].map(name=>'--dsw-font-'+name),
    ...['xs','sm','md','lg'].map(name=>'--dsw-radius-'+name)]
  function appearance() {
    const style = getComputedStyle(document.body)
    const theme = Object.fromEntries(properties.map(name => [name,style.getPropertyValue(name).trim()]).filter(([,value]) => value))
    return {dark:isDark(),theme,font:style.fontFamily,rootSize:getComputedStyle(document.documentElement).fontSize,locale:getLocale()}
  }
  function surface(entry) {
    if(!entry.documentId)entry.frame.title=uiText('MOKI资料库工作区')
    if (entry.state.ready) send(entry,'surface',{active:Boolean(entry.host),mode:entry.mode,...appearance()})
  }
  function send(entry, type, fields = {}) {
    if (entry.origin) entry.frame.contentWindow?.postMessage({bridge: entry.bridge, type, ...fields}, entry.origin)
  }
  function bindChat(entry,sessionId) {
    const requestId=crypto.randomUUID()
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{entry.requests.delete(requestId);reject(new Error(uiText("资料库会话连接超时")))},10000)
      entry.requests.set(requestId,ok=>{clearTimeout(timer);ok?resolve():reject(new Error(uiText("资料库未能连接到这个会话")))})
      send(entry,'bind-chat',{sessionId,requestId})
    })
  }
  function update(entry, patch) {
    entry.state = {...entry.state, ...patch}
    for (const callback of entry.listeners) callback()
  }
  function compose(entry,{selection=entry.state.selection,quoteSelection=false}={}) {
    if(!entry.host)return
    const inline=entry.mode==='side'
    const current=ctx.uiSession.adapter.current.getSnapshot().key
    // A retained document may have used a different session in its floating chat.
    // The side workspace always belongs to the currently visible main session.
    if(inline && (!current || (entry.chatSession && entry.chatSession!==current)))return
    const target=inline?current:entry.state.chatTarget||entry.chatSession||null
    update(entry,{chat:!inline,selection,...(inline?{chatTarget:null}:{}),
      quoteRequest:inline||quoteSelection?{id:crypto.randomUUID(),selection,target,quoteSelection,destination:inline?'main':'floating'}:null})
  }
  function move(entry, parent) {
    if (entry.frame.parentElement === parent) return
    if (parent.moveBefore && entry.frame.isConnected && parent.isConnected) {
      parent.moveBefore(entry.frame, null)
    } else {
      if (entry.frame.isConnected && entry.origin) connect(entry)
      parent.append(entry.frame)
    }
  }
  async function connect(entry) {
    const sequence = ++entry.sequence
    entry.origin = ''
    update(entry, {ready:false,documentReady:false,error:'',selection:null})
    clearTimeout(entry.loadTimer)
    try {
      const params = new URLSearchParams({session:entry.id,parent:location.origin})
      if(entry.documentId)params.set('document',entry.documentId)
      const response = await fetch('/moki-library/open?' + params, {headers:{'x-moki-library':'1'},cache:'no-store'})
      if (!response.ok) throw new Error(uiText("DSH 资料库服务返回 ") + response.status)
      const connection = await response.json()
      const url = new URL(connection.url)
      if (entry.sequence !== sequence) return
      entry.origin = url.origin
      entry.initialPreviewMode = connection.previewMode
      url.search = new URLSearchParams({bridge:entry.bridge,parent:location.origin,theme:isDark()?'dark':'light',locale:getLocale(),mode:entry.mode,...(entry.itemId?{itemId:entry.itemId}:{})})
      if(entry.documentId){
        url.searchParams.set('document',entry.documentId)
        if(entry.chatSession)url.searchParams.set('chatId',entry.chatSession)
        if(entry.resumeOffice)url.searchParams.set('resumeOffice','1')
      }
      if (connection.nativeFileDrag) url.searchParams.set('nativeFileDrag','1')
      entry.frame.src = url.href
      entry.loadTimer = setTimeout(() => {if (!entry.state.ready) update(entry,{error:uiText("资料库未能完成加载")})}, 45000)
    } catch (error) {
      if (entry.sequence === sequence) update(entry, {error:error.message})
    }
  }
  function entryFor(id,documentId) {
    if (entries.has(id)) return entries.get(id)
    const frame = document.createElement('iframe')
    frame.className = 'ml-frame'
    frame.title = uiText("MOKI资料库工作区")
    frame.allow = 'clipboard-read; clipboard-write'
    frame.referrerPolicy = 'no-referrer'
    const entry = {id,documentId,frame,bridge:crypto.randomUUID(),mode:'main',sequence:0,listeners:new Set(),requests:new Map(),state:{ready:false,selection:null,error:'',chat:false,notice:''}}
    entries.set(id,entry)
    return entry
  }
  function attach(entry, host, mode) {
    clearTimeout(entry.expiry)
    entry.host = host
    entry.mode = mode
    if(mode==='side' && (entry.state.chat || entry.state.chatTarget || entry.state.quoteRequest)) {
      update(entry,{chat:false,chatTarget:null,quoteRequest:null})
    }
    move(entry,host)
    if (!entry.sequence) connect(entry)
    surface(entry)
    return () => {
      if (entry.host !== host || entries.get(entry.id)!==entry) return
      drag.detach(entry)
      releaseExport(entry)
      entry.host = null
      surface(entry)
      move(entry,parking)
      // Open document tabs keep their live editor until DSH closes the tab.
      if(!entry.documentId)entry.expiry = setTimeout(() => destroy(entry), 10 * 60 * 1000)
    }
  }
  function releaseExport(entry) {
    const preparation=entry.export
    if (!preparation) return
    entry.export=undefined
    clearTimeout(preparation.timer)
    preparation.abort.abort()
    preparation.operation?.release()
  }
  function destroy(entry) {
    if(entries.get(entry.id)!==entry)return
    releaseExport(entry)
    ++entry.sequence
    clearTimeout(entry.loadTimer)
    clearTimeout(entry.expiry)
    for (const finish of entry.requests.values()) finish(false)
    entry.requests.clear()
    entry.frame.remove()
    entries.delete(entry.id)
  }
  function onMessage(event) {
    for (const entry of entries.values()) {
      if (!entry.origin || event.source !== entry.frame.contentWindow || event.origin !== entry.origin || event.data?.bridge !== entry.bridge) continue
      const message = event.data
      switch (message.type) {
        case 'open-preview': {
          const reply=event.ports[0]
          if(entry.host && reply)void openPreview(entry,message).then(value=>reply.postMessage({value}),error=>reply.postMessage({error:error.message}))
          break
        }
        case 'document-ready':update(entry,{documentReady:true,documentName:message.name});break
        case 'close-document':entry.closeDocument?.();break
        case 'drop-paths': {
          if (!entry.host || !Array.isArray(message.files)) break
          const paths = message.files.map(file => {
            try { return file instanceof File ? globalThis.__DSH_HOST_PATHS__?.pathFor(file) || '' : '' }
            catch { return '' }
          })
          event.ports[0]?.postMessage({value:paths})
          break
        }
        case 'resource-drag':
          if (entry.host && typeof message.token === 'string') drag.start(entry,message.token)
          break
        case 'resource-drag-end': drag.end(entry,message.token); break
        case 'prepare-export': {
          const reply = event.ports[0]
          if (!entry.host || !(message.file instanceof File) || !reply) break
          releaseExport(entry)
          const file = message.file, transport = ctx.fileDrag?.actions
          if (!transport || !globalThis.dshDesktop?.fileDrag) { reply.postMessage({error:uiText("系统文件拖出需要 DSH 桌面端")}); break }
          const preparation = {token:message.token, abort:new AbortController()}
          entry.export = preparation
          transport.prepare({kind:'blob',blob:file,name:file.name,mediaType:file.type}, preparation.abort.signal)
            .then(operation => {
              if (entry.export !== preparation) { operation.release(); throw new Error(uiText("已切换拖出的文件")) }
              preparation.operation=operation
              preparation.timer=setTimeout(()=>releaseExport(entry),45000)
              reply.postMessage({value:true})
            })
            .catch(error=>reply.postMessage({error:error.message}))
          break
        }
        case 'start-export': {
          const reply=event.ports[0], preparation=entry.export
          if (!entry.host || !reply) break
          if (preparation?.token!==message.token || !preparation.operation) {
            reply.postMessage({error:uiText("拖出文件已过期，请再次拖动")})
            break
          }
          try { preparation.operation.start(); reply.postMessage({value:true}) }
          finally { releaseExport(entry) }
          break
        }
        case 'release-export': if (entry.export?.token===message.token) releaseExport(entry); break
        case 'chat-bound': {
          const finish=entry.requests.get(message.requestId)
          entry.requests.delete(message.requestId)
          finish?.(message.ok)
          break
        }
        case 'ready': update(entry,{ready:true,error:''}); clearTimeout(entry.loadTimer); surface(entry); break
        case 'selection':
          if (entry.state.selection?.content !== message.selection?.content || entry.state.selection?.label !== message.selection?.label) update(entry,{selection:message.selection})
          break
        case 'location': entry.itemId = message.itemId; if (entry.state.previewing !== message.previewing) update(entry,{previewing:message.previewing}); break
        case 'quick-submit': {
          const reply=event.ports[0];if(!reply||!entry.host)break
          const mode=entry.mode,sequence=entry.sequence,itemId=entry.itemId
          const getTarget=()=>mode==='side'?ctx.uiSession.adapter.current.getSnapshot().key:entry.state.chatTarget||entry.chatSession||ctx.uiSession.adapter.current.getSnapshot().key
          void (async()=>{
            if(!getTarget())ctx.uiWorkspace.startSession()
            for(let attempt=0;!getTarget()&&attempt<50;attempt++)await new Promise(resolve=>setTimeout(resolve,80))
            const target=getTarget();if(!target)throw new Error(uiText('请先在 DSH 中打开工作区。'))
            const valid=()=>Boolean(entry.host&&entry.sequence===sequence&&entry.mode===mode&&entry.itemId===itemId&&getTarget()===target)
            await bindChat(entry,target)
            const text=[quote(message.selection)?.split('\n').map(line=>'> '+line).join('\n'),message.submission?.prompt].filter(Boolean).join('\n\n')
            const result=await submitQuick(target,{...message.submission,text},{valid})
            if(valid()){
              if(mode==='main'&&!entry.chatSession&&!entry.state.chatTarget)update(entry,{chatTarget:target})
              compose(entry,{selection:message.selection,quoteSelection:false})
            }
            return result
          })().then(result=>reply.postMessage(result),error=>reply.postMessage({error:error.message})).finally(()=>reply.close())
          break
        }
        case 'compose': compose(entry,message); break
        case 'exit': update(entry,{chat:false,quoteRequest:null}); break
        case 'error': update(entry,{notice:message.message}); break
      }
      break
    }
  }
  function syncTheme() {
    for (const entry of entries.values()) if (entry.host) surface(entry)
    if(watch){
      const next=appearance(), key=JSON.stringify(next)
      if(key!==lastAppearance){lastAppearance=key;void windows('appearance',{appearance:next}).catch(()=>{lastAppearance=''})}
    }
  }
  function focusComposer() {
    const input=document.activeElement?.closest('[data-composer-input]')
    const sessionId=input?.closest('[data-conversation-session]')?.dataset.conversationSession
    if(!sessionId)return
    const documents=[...entries.values()].filter(entry=>entry.host && entry.documentId && (entry.chatSession===sessionId || entry.state.chatTarget===sessionId))
    if(documents.length===1)send(documents[0],'activate-document',{sessionId})
  }
  const observer = new MutationObserver(syncTheme)
  const unsubscribeLocale = subscribeLocale(syncTheme)
  observer.observe(document.documentElement, {attributes:true})
  observer.observe(document.body, {attributes:true})
  const media = matchMedia('(prefers-color-scheme: dark)')
  media.addEventListener('change',syncTheme)
  window.addEventListener('message',onMessage)
  document.addEventListener('focusin',focusComposer)
  window.addEventListener('focus',focusComposer)
  void poll()
  return {entryFor,attach,connect,update,compose,send,bindChat,windows,destroy,onCommand(fn){onCommand=fn},dispose() {
    disposed=true;clearTimeout(timer)
    drag.dispose()
    window.removeEventListener('message',onMessage)
    document.removeEventListener('focusin',focusComposer)
    window.removeEventListener('focus',focusComposer)
    observer.disconnect()
    unsubscribeLocale()
    media.removeEventListener('change',syncTheme)
    for (const entry of entries.values()) destroy(entry)
    parking.remove()
  }}
}

import { l as uiText, useLibraryLocale } from './i18n.js';
import {insertSelectionQuote} from './selection-quote.js';
export function registerPanels(ctx, React, {Icon, Chat, Conversation, useChatBinding, quote, publish, views, pool, css, kind, type, t, ui,SettingsButton}) {
  const h = React.createElement
  const panelId = 'moki-library'
  const browseId = 'browse-' + crypto.randomUUID()
  const previewType='dsh-moki-library/document',previewKind='moki-library-preview'
  const resourcePrefix='dsh-resource://moki-library/'
  const names=new Map()
  let mainDocument=null
  const mainListeners=new Set()
  const mainSource={getSnapshot:()=>mainDocument,subscribe(fn){mainListeners.add(fn);return ()=>mainListeners.delete(fn)}}
  function selectMain(id) {
    mainDocument=id
    for(const listener of mainListeners) listener()
    ctx.layout.selectPanel(panelId)
  }
  function documentEntry(id) {
    const entry=pool.entryFor('moki-document-'+id,id)
    if(entry.tabs)return entry
    entry.tabs=new Map()
    const release=()=>{if(!entry.inMain && !entry.tabs.size)pool.destroy(entry)}
    entry.leaveMain=()=>{
      entry.inMain=false
      if(mainDocument===id)selectMain(null)
      release()
    }
    entry.closeDocument=()=>{
      if(entry.mode==='main')entry.leaveMain()
      else entry.tabs.get(entry.chatSession)?.close()
    }
    entry.releaseDocument=()=>{
      if(entry.inMain)entry.leaveMain()
      for(const tab of entry.tabs.values())tab.close()
    }
    entry.registerTab=(sessionId,tab)=>{
      if(entry.tabs.get(sessionId)?.id===tab.id)return
      entry.tabs.set(sessionId,{id:tab.id,close:()=>ctx.sidebarRight.closeIn(sessionId,tab.id)})
      tab.signal.addEventListener('abort',()=>{
        if(entry.tabs.get(sessionId)?.id===tab.id)entry.tabs.delete(sessionId)
        release()
      },{once:true})
    }
    return entry
  }
  const empty = {getSnapshot:()=>undefined,subscribe:()=>()=>{}}
  const useSnapshot = (source = empty) => React.useSyncExternalStore(React.useCallback(fn=>source.subscribe(fn),[source]), React.useCallback(()=>source.getSnapshot(),[source]))
  const action = (label, onClick, props = {}) => h(ui.Button,{variant:'ghost',className:'ml-action',type:'button',onClick,...props},label)
  const actionLabel = (Glyph,label) => h(React.Fragment,null,h(Glyph,{size:16,'aria-hidden':true}),h('span',{className:'ml-action-label'},label))
  async function showSide(entry) {
    try {
      if (!ctx.uiSession.adapter.current.getSnapshot().key) ctx.uiWorkspace.startSession()
      for (let i=0;i<35;i++) {
        if (ctx.uiSession.adapter.current.getSnapshot().key) {
          ctx.layout.selectPanel(null)
          try { ctx.sidebarRight.openTab(kind); return } catch (error) { if(i===34) throw error }
        }
        await new Promise(resolve=>setTimeout(resolve,90))
      }
      throw new Error(uiText("请先在 DSH 选择工作区或打开对话"))
    } catch (error) { ctx.layout.selectPanel(panelId); pool.update(entry,{notice:error.message}) }
  }
  async function currentSession() {
    if(!ctx.uiSession.adapter.current.getSnapshot().key)ctx.uiWorkspace.startSession()
    for(let i=0;i<48;i++){
      const id=ctx.uiSession.adapter.current.getSnapshot().key
      if(id)return id
      await new Promise(resolve=>setTimeout(resolve,80))
    }
    throw new Error(uiText("请在 DSH 选择工作区或打开对话后重试"))
  }
  function waitDocument(entry) {
    if(entry.state.documentReady && entry.host)return Promise.resolve()
    return new Promise((resolve,reject)=>{
      const cleanup=()=>{clearTimeout(timeout);entry.listeners.delete(check)}
      const check=()=>{
        if(entry.state.error){cleanup();reject(new Error(entry.state.error))}
        else if(entry.state.documentReady && entry.host){cleanup();resolve()}
      }
      const timeout=setTimeout(()=>{cleanup();reject(new Error(uiText("DSH 未能载入此文件")))},18000)
      entry.listeners.add(check);check()
    })
  }
  pool.onCommand(async command=>{
    if(command.action!=='dock' && command.action!=='main')return
    if(command.name)names.set(command.id,command.name)
    const entry=documentEntry(command.id)
    entry.resumeOffice=Boolean(command.office)
    if(command.action==='main') {
      entry.inMain=true
      selectMain(command.id)
    } else {
      entry.chatSession=await currentSession()
      ctx.layout.selectPanel(null)
      ctx.sidebarRight.openResource(resourcePrefix+command.id,{kind:previewKind,destination:'sidebar'})
    }
    await waitDocument(entry)
  })
  function Panel({mode,sessionId,binding,visible,renderSlot,SessionProvider,documentId}) {
    useLibraryLocale(React)
    const entry = documentId?documentEntry(documentId):pool.entryFor(sessionId || browseId)
    if(visible)entry.chatSession=sessionId
    const state = React.useSyncExternalStore(React.useCallback(fn=>{entry.listeners.add(fn);return ()=>entry.listeners.delete(fn)},[entry]),()=>entry.state)
    const host = React.useRef(null)
    const main=mode==='main'
    const target=main?(state.chatTarget || sessionId):sessionId
    const chat=useChatBinding(ctx,pool,entry,target,visible && state.ready && Boolean(state.chat || state.chatTarget || state.quoteRequest))
    const selectedBinding=useSnapshot(chat.reference?ctx.uiSession.adapter.bindingSource(chat.reference):undefined)
    const destination=target===sessionId?binding:selectedBinding
    const input=useSnapshot(destination?.hooks.input)
    const actions=destination?.props.inputActions
    React.useLayoutEffect(()=>{if(visible && host.current) return pool.attach(entry,host.current,mode)},[entry,mode,visible])
    const selection=state.selection
    const quoted = React.useMemo(()=>quote(selection),[selection])
    const added = Boolean(quoted && String(input?.draft || '').replace(/^> ?/gm,'').includes(quoted))
    const disabled = !visible || !actions || !quoted || input?.phase !== 'plain' || added
    const add = React.useCallback(()=>{
      if (disabled) return
      if (actions.insertQuote(quoted)) {
        actions.persistDraft()
        pool.update(entry,{notice:uiText("已加入当前 DSH 对话草稿")})
      } else pool.update(entry,{notice:uiText("当前对话输入框暂时无法接收选区")})
    },[actions,disabled,quoted,entry])
    const handledQuote=React.useRef(null)
    React.useEffect(()=>{
      const request=state.quoteRequest
      if(!request||handledQuote.current===request.id||!visible||!target)return
      if((request.target&&request.target!==target)||request.destination!==(main?'floating':'main')){handledQuote.current=request.id;pool.update(entry,{quoteRequest:null});return}
      if(chat.error){handledQuote.current=request.id;pool.update(entry,{quoteRequest:null,notice:chat.error});return}
      if(!chat.reference)return
      const result=request.quoteSelection===false?(actions&&input?.phase==='plain'?{added:true}:null):insertSelectionQuote(request,input,actions,quote)
      if(!result)return
      handledQuote.current=request.id
      pool.update(entry,{quoteRequest:null,notice:result.added?'':uiText('当前对话输入框暂时无法接收选区')})
      if(result.added && !main){
        ctx.layout.selectPanel(null)
        requestAnimationFrame(()=>{
          if(!entry.host || entry.mode!=='side' || entry.state.quoteRequest || ctx.uiSession.adapter.current.getSnapshot().key!==target)return
          const selector='[data-conversation-content][data-conversation-session="'+CSS.escape(target)+'"]'
          const conversation=[...document.querySelectorAll(selector)].find(node=>node.getClientRects().length && !node.closest('.ml-dialog'))
          conversation?.querySelector('[data-composer-input]')?.focus({preventScroll:true})
        })
      }
    },[state.quoteRequest,visible,main,chat.reference,chat.error,target,input,actions,entry])
    React.useEffect(()=>{
      if (!visible || !target) return
      publish(target,{owner:entry,selection,add,added,disabled})
      return ()=>{if(views.get(target)?.owner === entry) publish(target,null)}
    },[visible,target,entry,selection,add,added,disabled])
    const closeChat=()=>{
      pool.update(entry,{chat:false,quoteRequest:null});entry.frame.focus();pool.send(entry,'focus-editor')
    }
    const switchLabel=main?uiText("在侧边工作区打开"):uiText("在主窗口打开")
    return h('section',{className:'ml-panel','data-ml-mode':mode,'data-file-open':state.previewing||undefined,onKeyDown:e=>{
      if (visible && !e.defaultPrevented && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.repeat && !e.nativeEvent.isComposing && (e.code==='KeyD' || e.key.toLowerCase()==='d')) {
        e.preventDefault();e.stopPropagation();pool.compose(entry)
      }
    },'aria-label':main?uiText("MOKI资料库主窗口"):uiText("MOKI资料库侧边工作区")},
      h('div',{className:'ml-bar'},main?h('h1',null,t('title')):null,
        h('div',{className:'ml-actions'},
          action(actionLabel(ui.IconPanelLeftOutlineRegular,main?uiText("侧边工作区"):uiText("主窗口")),()=>{
            if(documentId){
              if(main)void currentSession().then(()=>{ctx.layout.selectPanel(null);ctx.sidebarRight.openResource(resourcePrefix+documentId,{kind:previewKind,destination:'sidebar'})}).catch(error=>pool.update(entry,{notice:error.message}))
              else {entry.inMain=true;selectMain(documentId)}
            } else if(main)void showSide(entry)
            else selectMain(null)
          },{'aria-label':switchLabel,title:switchLabel}),
          action(actionLabel(added?ui.IconCheckOutlineRegular:ui.IconContextInjectionOutlineRegular,added?uiText("已加入草稿"):uiText("选区加入对话")),add,{disabled,'aria-label':added?uiText("已加入草稿"):uiText("选区加入对话"),onMouseDown:e=>e.preventDefault(),title:target?(state.selection?.label||uiText("请先选择资料或文字")):uiText("请在 DSH 浮窗中新建或选择会话")}),
          !state.previewing && action(actionLabel(ui.FishLogo,uiText("DSH 对话")),()=>main&&state.chat?closeChat():pool.compose(entry),{variant:'outline','aria-label':uiText("DSH 对话"),disabled:!state.ready,'aria-expanded':main?state.chat:undefined,'aria-keyshortcuts':'Alt+D',title:uiText("DSH 对话 (Alt+D)")}),
          !documentId && h(SettingsButton))),
      state.error?h('div',{className:'ml-notice',role:'alert'},state.error,' ',action(uiText("重试"),()=>pool.connect(entry))):null,
      !state.error&&!state.ready?h('div',{className:'ml-notice',role:'status'},uiText("正在打开资料库…")):null,
      state.notice?h('div',{className:'ml-notice',role:'status'},state.notice,action(h(ui.IconCloseOutlineRegular,{size:14,'aria-hidden':true}),()=>pool.update(entry,{notice:''}),{'aria-label':uiText("关闭提示")})):null,
      h('div',{className:'ml-frame-holder',ref:host}),
      main&&state.chat&&visible?h(Chat,{ctx,mode,slotMode:mode,currentId:sessionId,target,chat,SessionProvider,renderSlot,
        choose:id=>pool.update(entry,{chatTarget:id,chat:true}),selection,onClose:closeChat}):null)
  }
  function MainSeat({renderSlot,SessionProvider}) {
    useLibraryLocale(React)
    const binding = useSnapshot(ctx.uiSession.adapter.current)
    const documentId=useSnapshot(mainSource)
    return h(Panel,{mode:'main',documentId,renderSlot,SessionProvider,visible:true,sessionId:binding.key,binding:binding.key?binding:undefined})
  }
  function SideSeat({sessionId,useTabInfo,renderSlot,SessionProvider}) {
    useLibraryLocale(React)
    const current = useSnapshot(ctx.uiSession.adapter.current)
    const panel = useSnapshot(ctx.layout.panelInfo)
    const {tab}=useTabInfo()
    const documentId=tab.contentId.startsWith(resourcePrefix)?tab.contentId.slice(resourcePrefix.length):null
    React.useLayoutEffect(()=>{
      if(documentId)documentEntry(documentId).registerTab(sessionId,tab)
    },[sessionId,documentId,tab.id,tab.signal])
    const visible = tab.visible && panel.activePanelId === null && current.key === sessionId
    return h(Panel,{mode:'side',documentId,renderSlot,SessionProvider,visible,sessionId,binding:current.key === sessionId?current:undefined})
  }
  ctx.effect(()=>{
    const style=document.createElement('style')
    style.textContent=css
    document.head.append(style)
    return ()=>style.remove()
  },'moki-library: panel styles')
  // MOKI Whiteboard registers at 20 in the same sidebar slot.
  ctx.slots.inject('sidebar.panellist',()=>ctx.slots.register({name:'sidebar.panellist',id:panelId,order:19,label:()=>t('title'),locale:'mokiLibrary'},Icon))
  const chatChildren=mode=>({['moki-library.chat.'+mode]:{kind:'single',scope:'session'}})
  for (const mode of ['main','side','document']) {
    const name='moki-library.chat.'+mode
    ctx.slots.inject(name,()=>ctx.slots.register({name},Conversation))
  }
  ctx.slots.inject('main',()=>ctx.slots.register({name:'main',key:panelId,locale:'mokiLibrary',children:chatChildren('main')},MainSeat))
  ctx.slots.inject('sidebar.right.pane.tab',()=>ctx.slots.register({name:'sidebar.right.pane.tab',key:type,children:chatChildren('side')},SideSeat))
  ctx.effect(()=>ctx.sidebarRightTabs.register({id:previewType,kind:previewKind,patterns:[resourcePrefix+'**'],
    canOpen:address=>address.startsWith(resourcePrefix),title:address=>names.get(address.slice(resourcePrefix.length)) || uiText("文件预览"),keepMounted:true}),'moki-library: file tabs')
  ctx.slots.inject('sidebar.right.pane.tab',()=>ctx.slots.register({name:'sidebar.right.pane.tab',key:previewType,children:chatChildren('document')},SideSeat))
  ctx.slots.inject('sidebar.right.pane.tab.title',()=>ctx.slots.register({name:'sidebar.right.pane.tab.title',key:type},({useTabInfo})=>h(React.Fragment,null,h(Icon),useTabInfo().tab.title)))
}

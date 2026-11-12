import { l as uiText, useLibraryLocale } from './i18n.js';
import {useChatLayout} from './chat-layout.js'

export function createChatComponents(React,ui,{createPortal},conversationPhase) {
  const h=React.createElement
  function useSource(source) {
    return React.useSyncExternalStore(React.useCallback(fn=>source.subscribe(fn),[source]),()=>source.getSnapshot())
  }
  function useChatBinding(ctx,pool,entry,id,enabled) {
    const [result,setResult]=React.useState({})
    const [attempt,retry]=React.useReducer(n=>n+1,0)
    React.useEffect(()=>{
      if (!enabled || !id) {setResult({});return}
      let current=true, reference
      setResult({id})
      try {
        reference=ctx.sessions.retain(id,{source:'moki-library'})
        reference.ready.then(async()=>{
          if(!current)return
          await pool.bindChat(entry,id)
          if(current)setResult({id,reference})
        }).catch(error=>{if(current)setResult({id,error:error.message})})
      } catch(error) {setResult({id,error:error.message})}
      return ()=>{current=false;reference?.release()}
    },[ctx,pool,entry,id,enabled,attempt])
    return {...(enabled && result.id===id?result:{}),retry}
  }
  function Conversation({sessionId,useSession,useSessions,useConversation,renderFactorySlot}) {
    useLibraryLocale(React)
    const session=useSession(value=>value)
    const phase=conversationPhase(session,useConversation(value=>value))
    const blank=useSessions(state=>state.byId[sessionId]?.blank)
    const hero=phase==='blank' && (session.openState==='open' || blank===true)
    const settling=phase==='blank' && session.openState==='loading' && blank!==true
    return renderFactorySlot('conversation.content',{variant:'embedded',phase:settling?'settling':hero?'hero':'active',hero})
  }
  function ToolButton({label,Glyph,onClick,disabled,pressed}) {
    useLibraryLocale(React)
    return h(ui.Button,{type:'button',variant:'ghost',className:'ml-icon-button',title:label,'aria-label':label,
      'aria-expanded':pressed,disabled,onClick},h(Glyph,{size:16,'aria-hidden':true}))
  }
  // One session owns one native input editor. Present the existing conversation
  // in-place when the main chat and side workspace show the same session.
  function ExistingChat({scope,host,geometry,onClose,onEscape}) {
    useLibraryLocale(React)
    const [content,setContent]=React.useState(null)
    const close=React.useRef(onClose),escape=React.useRef(onEscape)
    close.current=onClose;escape.current=onEscape
    React.useLayoutEffect(()=>{
      const selector='[data-conversation-content][data-conversation-session="'+CSS.escape(scope)+'"]'
      const locate=()=>setContent([...document.querySelectorAll(selector)].find(el=>!el.closest('.ml-dialog') && el.getClientRects().length) || null)
      locate()
      const observer=new MutationObserver(records=>{
        if (records.some(record=>[...record.addedNodes,...record.removedNodes].some(node=>node.nodeType===1 && (node.matches(selector)||node.querySelector(selector))))) locate()
      })
      observer.observe(document.body,{childList:true,subtree:true})
      return ()=>observer.disconnect()
    },[scope])
    const place=React.useCallback(()=>{
      if(!content || !host.current)return
      const {top,left,width,height}=host.current.getBoundingClientRect()
      for(const [key,value] of Object.entries({top,left,width,height}))content.style.setProperty('--ml-float-'+key,value+'px')
    },[content,host])
    React.useLayoutEffect(()=>{
      if(!content || !host.current)return
      content.dataset.mlFloating=''
      const dialog=host.current.closest('[role="dialog"]'), originalId=content.id
      if(!originalId)content.id='ml-native-'+crypto.randomUUID()
      dialog.setAttribute('aria-owns',content.id)
      const key=e=>escape.current(e)
      content.addEventListener('keydown',key)
      const observer=new ResizeObserver(place)
      observer.observe(host.current)
      window.addEventListener('resize',place)
      place()
      content.querySelector('[data-composer-input]')?.focus({preventScroll:true})
      return ()=>{
        observer.disconnect();window.removeEventListener('resize',place)
        content.removeEventListener('keydown',key)
        delete content.dataset.mlFloating
        for(const prop of ['top','left','width','height'])content.style.removeProperty('--ml-float-'+prop)
        dialog.removeAttribute('aria-owns')
        if(!originalId)content.removeAttribute('id')
      }
    },[content,host,place])
    React.useLayoutEffect(place,[place,geometry])
    if(!content?.parentElement)return null
    return createPortal(h('div',{className:'ml-chat-return'},
      h(ui.Button,{variant:'outline',onClick:()=>{close.current();requestAnimationFrame(()=>content.querySelector('[data-composer-input]')?.focus({preventScroll:true}))}},h(ui.FishLogo,{size:18}),uiText("将浮窗对话放回主窗口"))),content.parentElement)
  }
  const historyTime=new Intl.DateTimeFormat('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})
  function Chat({ctx,mode,slotMode=mode,currentId,target,chat,choose,SessionProvider,renderSlot,selection,onClose,embeddedControls}) {
    useLibraryLocale(React)
    const layout=useChatLayout(React,embeddedControls?null:mode),host=React.useRef(null)
    const sessionList=useSource(ctx.sessions.list),workspaceList=useSource(ctx.workspaces.list)
    const summary=sessionList.byId[target]
    const [history,setHistory]=React.useState(false),[query,setQuery]=React.useState('')
    const [creating,setCreating]=React.useState(false),[error,setError]=React.useState('')
    const alive=React.useRef(true),creatingRef=React.useRef(false),choice=React.useRef(0),search=React.useRef(null)
    React.useEffect(()=>{alive.current=true;return ()=>{alive.current=false}},[])
    const borrowed=mode==='side' && Boolean(target) && target===currentId
    React.useEffect(()=>{
      if(history){search.current?.focus();return}
      if(chat.reference && !borrowed)host.current?.querySelector('[data-composer-input]')?.focus({preventScroll:true})
    },[history,chat.reference,borrowed])
    const groups=React.useMemo(()=>{
      const archived=new Set(workspaceList.archivedSessionIds)
      return workspaceList.items.map(workspace=>({workspace,sessions:workspace.sessionIds.map(id=>sessionList.byId[id])
        .filter(s=>s && !archived.has(s.id)).sort((a,b)=>b.updatedAt-a.updatedAt)}))
    },[workspaceList,sessionList])
    const groupFor=id=>groups.find(g=>g.workspace.sessionIds.includes(id))
    async function newChat() {
      if(creatingRef.current)return
      const group=groupFor(target) || groupFor(currentId) || [...groups].sort((a,b)=>(b.sessions[0]?.updatedAt||0)-(a.sessions[0]?.updatedAt||0))[0]
      if(!group){setError(uiText("请先在 DSH 中打开工作区。"));return}
      const request=++choice.current
      creatingRef.current=true;setCreating(true);setError('')
      try {
        const id=await ctx.sessions.create({workspaceId:group.workspace.workspaceId})
        if(alive.current && request===choice.current){choose(id);setHistory(false);setQuery('')}
      } catch(reason){if(alive.current && request===choice.current)setError(reason.message)}
      finally{creatingRef.current=false;if(alive.current)setCreating(false)}
    }
    function escape(event) {
      if(event.key!=='Escape'||event.defaultPrevented||(event.nativeEvent||event).isComposing)return
      if(history){event.preventDefault();event.stopPropagation();setHistory(false);return}
      if(document.querySelector('[role="menu"]:not([hidden]),[role="listbox"]:not([hidden]),[aria-modal="true"]:not([hidden])'))return
      if(chat.reference?.binding.session.getSnapshot().running)return
      event.preventDefault();event.stopPropagation();onClose()
    }
    const title=summary?.title?.trim() || uiText("新会话")
    function toggleHistory(){setQuery('');setError('');setHistory(!history)}
    React.useEffect(()=>{
      if(!embeddedControls)return
      embeddedControls.report({title:target?title:uiText("DSH 对话"),history,creating})
      const command=event=>{
        if(event.detail==='new')void newChat()
        if(event.detail==='history')toggleHistory()
        if(event.detail==='focus')host.current?.querySelector('[data-composer-input]')?.focus({preventScroll:true})
      }
      window.addEventListener('moki:preview-chat-command',command)
      return ()=>window.removeEventListener('moki:preview-chat-command',command)
    })
    const matches=history?groups.map(group=>({...group,sessions:group.sessions.filter(s=>((s.title||uiText("新会话"))+' '+group.workspace.title).toLowerCase().includes(query.trim().toLowerCase()))})).filter(g=>g.sessions.length):[]
    return h('section',{ref:layout.ref,style:layout.style,className:'ml-dialog',role:embeddedControls?'region':'dialog','aria-label':embeddedControls?uiText("DSH 会话"):uiText("DSH 编辑协作"),onKeyDown:escape},
      !embeddedControls && h('div',{className:'ml-chat-head'},
        h('button',{type:'button',className:'ml-chat-move','aria-label':uiText("移动 DSH 浮窗"),title:uiText("拖动移动，方向键微调"),...layout.handle('move')},
          h(ui.FishLogo,{size:22,'aria-hidden':true}),h('strong',{title},target?title:uiText("DSH 对话"))),
        h(ToolButton,{label:uiText("新建会话"),Glyph:ui.IconNewChatOutlineRegular,disabled:creating,onClick:newChat}),
        h(ToolButton,{label:uiText("历史会话"),Glyph:ui.IconClockOutlineRegular,pressed:history,onClick:toggleHistory}),
        h(ToolButton,{label:uiText("关闭 DSH 浮窗"),Glyph:ui.IconCloseOutlineRegular,onClick:onClose})),
      selection && h('div',{className:'ml-selection-line',title:selection.label},h(ui.IconContextInjectionOutlineRegular,{size:14}),uiText("资料库选区"),h('span',null,selection.label)),
      error && h('div',{className:'ml-chat-error',role:'alert'},error),
      history?h('div',{className:'ml-history'},
        h('label',{className:'ml-history-search'},h(ui.IconSearchOutlineRegular,{size:16}),h('input',{ref:search,value:query,onChange:e=>setQuery(e.target.value),placeholder:uiText("搜索历史会话"),'aria-label':uiText("搜索历史会话")})),
        h('div',{className:'ml-history-list'},matches.length?matches.map(({workspace,sessions})=>h('section',{key:workspace.workspaceId},
          h('h3',null,workspace.title==='default-workspace'?uiText("默认工作区"):workspace.title),
          sessions.map(s=>h('button',{type:'button',key:s.id,'aria-current':s.id===target?'true':undefined,
            onClick:()=>{choice.current++;choose(s.id);setHistory(false);setError('')}},h('span',null,s.title?.trim()||uiText("新会话")),Number.isFinite(s.updatedAt)?h('time',null,historyTime.format(s.updatedAt)):null,s.id===target?h(ui.IconCheckOutlineRegular,{size:15}):null)))):h('p',{role:'status'},query?uiText("没有匹配的会话"):uiText("暂无历史会话")))):
      h('div',{className:'ml-native-host',ref:host},
        !target?h('div',{className:'ml-chat-state'},h(ui.FishLogo,{size:34}),h(ui.Button,{variant:'outline',onClick:newChat,disabled:creating},uiText("新建会话"))):
        chat.error?h('div',{className:'ml-chat-state',role:'alert'},chat.error,h(ui.Button,{variant:'outline',onClick:chat.retry},uiText("重试"))):
        !chat.reference?h('div',{className:'ml-chat-state',role:'status'},uiText("正在打开会话…")):
        borrowed?h(ExistingChat,{scope:target,host,geometry:layout.style,onClose,onEscape:escape}):
        h(SessionProvider,{session:chat.reference,key:target},renderSlot('moki-library.chat.'+slotMode,{}))),
      !embeddedControls && ['n','s','e','w','nw','ne','sw','se'].map(edge=>h('button',{type:'button',key:edge,className:'ml-chat-resize','data-edge':edge,
        tabIndex:edge==='se'?0:-1,'aria-hidden':edge!=='se'||undefined,'aria-label':uiText("调整 DSH 浮窗大小"),title:uiText("拖动调整大小，方向键微调"),...layout.handle(edge)})))
  }
  return {Chat,Conversation,useChatBinding}
}

// This seat runs in the official DSH web client at DSH's own origin.
// The document in the parent can request UI actions, never DSH RPCs.
export function registerPreviewChat(ctx,React,{key,Chat,Conversation,useChatBinding,quote,QuoteContext,css,createPortal}) {
  const h=React.createElement, panel='moki-preview-chat', channel='moki-preview-chat'
  async function context(sessionId) {
    const headers={'x-moki-preview-chat':key}
    if(sessionId)headers['x-moki-chat-session']=sessionId
    const res=await fetch('/moki-library/preview-chat',{headers,cache:'no-store'})
    if(!res.ok)throw new Error('当前文件与 DSH 的连接已失效，请重新打开对话。')
    return res.json()
  }
  const binding={bindChat:(_,id)=>context(id)}, child='moki-library.chat.preview'
  const empty={subscribe:()=>()=>{},getSnapshot:()=>null}
  const useSource=source=>React.useSyncExternalStore(React.useCallback(fn=>source.subscribe(fn),[source]),()=>source.getSnapshot())
  function Seat({SessionProvider,renderSlot}) {
    const [info,setInfo]=React.useState(null),[target,choose]=React.useState(null),[error,setError]=React.useState('')
    const [selection,setSelection]=React.useState(null)
    const parentOrigin=React.useRef(null),anchor=React.useRef(null)
    React.useLayoutEffect(()=>{
      const shell=anchor.current?.closest('#root > *')
      if(!shell)return
      shell.dataset.mokiPreviewShell=''
      return ()=>{delete shell.dataset.mokiPreviewShell}
    },[])
    const post=React.useCallback((action,data={})=>{
      if(parentOrigin.current)parent.postMessage({channel,action,...data},parentOrigin.current)
    },[])
    React.useEffect(()=>{
      let live=true
      context().then(value=>{
        if(!live)return
        parentOrigin.current=value.parentOrigin
        setSelection(value.selection);choose(value.sessionId);setInfo(value)
        post('ready')
      }).catch(e=>{if(live)setError(e.message)})
      const receive=event=>{
        if(event.source!==parent || event.origin!==parentOrigin.current || event.data?.channel!==channel)return
        if(event.data.action==='selection')setSelection(event.data.selection)
        else if(['focus','new','history'].includes(event.data.action))window.dispatchEvent(new CustomEvent('moki:preview-chat-command',{detail:event.data.action}))
      }
      const activate=()=>post('activate')
      window.addEventListener('message',receive)
      window.addEventListener('focus',activate)
      return ()=>{live=false;window.removeEventListener('message',receive);window.removeEventListener('focus',activate)}
    },[])
    const catalog=useSource(ctx.sessions.list),current=useSource(ctx.uiSession.adapter.current)
    // A newly connected web client receives the catalog asynchronously.
    // Only retain an identity after this client knows it.
    const preferred=target || current.key
    const selected=catalog.byId[preferred] ? preferred : null
    const resolving=catalog.phase==='pending' && !selected
    const chat=useChatBinding(ctx,binding,key,selected,Boolean(info))
    const session=useSource(chat.reference?ctx.uiSession.adapter.bindingSource(chat.reference):empty)
    const input=useSource(session?.hooks.input || empty),actions=session?.props.inputActions
    const quoted=React.useMemo(()=>quote(selection),[selection])
    const added=Boolean(quoted && String(input?.draft||'').replace(/^> ?/gm,'').includes(quoted))
    const quoteProps={sessionId:selected,selection,added,disabled:!actions || input?.phase!=='plain' || added,
      add:()=>{if(actions?.insertQuote(quoted))actions.persistDraft()}}
    const controls=React.useMemo(()=>({report:state=>post('state',state)}),[post])
    return h(React.Fragment,null,h('span',{ref:anchor,hidden:true}),createPortal(h('div',{className:'ml-preview-seat'},
      error?h('p',{role:'alert'},error):
      resolving?h('p',{role:'status'},'正在载入 DSH 会话…'):
      info?h(QuoteContext.Provider,{value:quoteProps},h(Chat,{ctx,mode:'preview',target:selected,currentId:current.key,chat,choose,SessionProvider,renderSlot,selection,embeddedControls:controls,onClose:()=>post('close')})):null),document.body))
  }
  ctx.effect(()=>{
    const style=document.createElement('style')
    style.textContent=css+'\n[data-moki-preview-shell]{display:none!important} .ml-preview-seat{position:fixed;inset:0;background:var(--dsw-alias-bg-base)} .ml-preview-seat>.ml-dialog{inset:0;width:100%;height:100%;border:0;border-radius:0;box-shadow:none}'
    document.head.append(style)
    return ()=>style.remove()
  },'moki-library: preview conversation styles')
  ctx.slots.inject(child,()=>ctx.slots.register({name:child},Conversation))
  ctx.slots.inject('main',()=>{
    const release=ctx.slots.register({name:'main',key:panel,children:{[child]:{kind:'single',scope:'session'}}},Seat)
    ctx.layout.selectPanel(panel)
    return release
  })
}

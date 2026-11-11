const endpoint='/moki-library/attachments'
async function request(params,signal) {
  const response=await fetch(endpoint+'?'+new URLSearchParams(params),{signal,cache:'no-store',headers:{'x-moki-library':'1'}})
  if(!response.ok)throw new Error((await response.json().catch(()=>({}))).error || '无法读取资料库')
  return response
}

export function registerComposerActions(ctx,React,{Modal,useSettings,useQuote,Icon,ui}) {
  const h=React.createElement, button=(label,onClick,props={})=>h(ui.Button,{type:'button',variant:'ghost',onClick,...props},label)
  function Picker({sessionId,anchor,close}) {
    const [crumbs,setCrumbs]=React.useState([]),[query,setQuery]=React.useState(''),[page,setPage]=React.useState(0)
    const [rows,setRows]=React.useState([]),[more,setMore]=React.useState(false),[loading,setLoading]=React.useState(true)
    const [selected,setSelected]=React.useState(()=>new Map()),[error,setError]=React.useState(''),[adding,setAdding]=React.useState(false)
    const upload=React.useRef(null), parent=crumbs.at(-1)?.id
    React.useEffect(()=>()=>upload.current?.abort(),[])
    React.useEffect(()=>{
      const controller=new AbortController()
      setLoading(true);setError('')
      if(!page){setRows([]);setMore(false)}
      const timer=setTimeout(async()=>{
        try {
          const params={q:query,offset:String(page*60)}
          if(parent)params.parent=parent
          if(parent && !query.trim() && !page)params.refresh='1'
          const data=await (await request(params,controller.signal)).json()
          if(!controller.signal.aborted){
            setRows(old=>page?[...old,...data.items]:data.items);setMore(data.more)
            if(parent && !query && !page && data.ancestors?.at(-1)?.id===parent)setCrumbs(data.ancestors)
          }
        }catch(e){if(!controller.signal.aborted)setError(e.message)}
        finally {if(!controller.signal.aborted)setLoading(false)}
      },query?140:0)
      return ()=>{clearTimeout(timer);controller.abort()}
    },[query,parent,page])
    function navigate(next){setQuery('');setPage(0);setCrumbs(next)}
    function toggle(item){
      setSelected(old=>{const next=new Map(old);if(next.has(item.id))next.delete(item.id);else next.set(item.id,item);return next})
    }
    async function add(){
      if(!selected.size || upload.current)return
      const controller=new AbortController()
      upload.current=controller;setAdding(true);setError('')
      try {
        const transfer=new DataTransfer()
        for(const item of selected.values()){
          const response=await request({file:item.id},controller.signal)
          const encoded=/filename\*=UTF-8''([^;]+)/i.exec(response.headers.get('content-disposition') || '')
          const name=encoded?decodeURIComponent(encoded[1]):(item.target?.split(/[\\/]/).at(-1) || item.name)
          const blob=await response.blob()
          transfer.items.add(new File([blob],name,{type:blob.type}))
        }
        if(controller.signal.aborted)return
        const seat=anchor.current?.closest('[data-composer-seat]')
        const root=seat?.closest('[data-conversation-session]')
        const input=seat?.querySelector('[data-composer-card] input[type=file]:not(:disabled)')
        if(!input || root?.dataset.conversationSession!==sessionId)throw new Error('当前对话已切换或暂时无法接收附件')
        input.files=transfer.files
        input.dispatchEvent(new Event('change',{bubbles:true}))
        close()
        requestAnimationFrame(()=>seat.querySelector('[data-composer-input]')?.focus({preventScroll:true}))
      }catch(e){if(!controller.signal.aborted)setError(e.message)}
      finally{upload.current=null;if(!controller.signal.aborted)setAdding(false)}
    }
    return h(Modal,{title:'从资料库选择文件',className:'ml-picker',onClose:close},
      h('input',{className:'ml-picker-search',type:'search',placeholder:'搜索文件名、标签或路径','aria-label':'搜索资料库文件',autoFocus:true,
        value:query,disabled:adding,onChange:e=>{setPage(0);setQuery(e.target.value)}}),
      h('nav',{className:'ml-crumbs','aria-label':'资料库位置'},button('资料库',()=>navigate([]),{disabled:adding}),
        crumbs.map((item,i)=>h(React.Fragment,{key:item.id},' / ',button(item.name,()=>navigate(crumbs.slice(0,i+1)),{disabled:adding})))),
      h('div',{className:'ml-picker-list','aria-busy':loading},
        rows.map(item=>item.kind==='local_file'
          ? h('label',{key:item.id,className:'ml-picker-row',title:item.target},h('input',{type:'checkbox',checked:selected.has(item.id),disabled:adding,onChange:()=>toggle(item)}),
              h('span',null,h('strong',null,item.name),h('small',null,item.target)))
          : h('button',{key:item.id,type:'button',className:'ml-picker-row',disabled:adding,onClick:()=>navigate([...crumbs,item])},
              h('svg',{width:17,height:17,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.6,'aria-hidden':true},h('path',{d:'M3 7a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'})),
              h('span',null,h('strong',null,item.name),item.target && h('small',null,item.target)),h('span',{'aria-hidden':true},'›'))),
        loading && h('p',{role:'status'},'正在读取资料库…'),
        !loading && !rows.length && !error && h('p',null,query?'没有匹配的文件':'此文件夹中没有可选文件'),
        more && !loading && button('显示更多',()=>setPage(page+1),{disabled:adding})),
      error && h('div',{role:'alert',className:'ml-setting-error'},error),
      h('footer',{className:'ml-picker-footer'},h('span',{'aria-live':'polite'},'已选 '+selected.size+' 项'),
        button('取消',close),button(adding?'正在读取…':'添加附件',()=>void add(),{variant:'primary',disabled:!selected.size || adding})))
  }
  function PickerButton({sessionId}){
    const [target,setTarget]=React.useState(null),anchor=React.useRef(null)
    return h('span',{ref:anchor,className:'ml-picker-button'},
      h(ui.Tooltip,{label:'从资料库添加附件',side:'top',delayMs:500,portal:true},
        button(h(React.Fragment,null,h(Icon),h('span',{className:'ml-composer-label'},'资料库')),
          ()=>setTarget(anchor.current?.closest('[data-conversation-session]')?.dataset.conversationSession || sessionId),
          {variant:'outline',className:'ml-composer-action ml-picker-trigger','aria-label':'从资料库添加附件','aria-haspopup':'dialog','aria-expanded':!!target})),
      target && h(Picker,{sessionId:target,anchor,close:()=>setTarget(null)}))
  }
  function SelectionButton({quote}){
    const label=quote.added?'已加入草稿':'选区加入对话'
    return h(ui.Tooltip,{label:[label,quote.selection.label].filter(Boolean).join(' · '),side:'top',delayMs:500,portal:true},
      button(h(React.Fragment,null,h(quote.added?ui.IconCheckOutlineRegular:ui.IconContextInjectionOutlineRegular,{size:16,'aria-hidden':true}),
        h('span',{className:'ml-composer-label'},label)),quote.add,
        {className:'ml-composer-action ml-quote-trigger','aria-label':quote.added?'资料已加入草稿':'资料选区 · 加入对话',
          disabled:quote.disabled,onMouseDown:e=>e.preventDefault()}))
  }
  function Entry({sessionId,session,placement}){
    const settings=useSettings()
    const id=sessionId || session?.id
    const quote=useQuote(id),showPicker=settings.value?.composerPicker
    if(!quote?.selection && !showPicker)return null
    return h('div',{className:'ml-composer-actions','data-placement':placement},
      quote?.selection && h(SelectionButton,{quote}),
      showPicker && h(PickerButton,{key:id,sessionId:id}))
  }
  for(const [name,placement] of [['conversation.hero.options','hero'],['conversation.input.dock','dock']]){
    ctx.slots.inject(name,()=>ctx.slots.register({name,id:'moki-library-attachment',order:11},props=>h(Entry,{...props,placement})))
  }
}

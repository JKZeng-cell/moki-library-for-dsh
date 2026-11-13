import {l as uiText,useLibraryLocale} from './i18n.js'

export async function generatedRequest(input,signal) {
  const response=await fetch('/moki-library/generated-file',{signal,cache:'no-store',headers:{'x-moki-library':'1','x-moki-generated-file':encodeURIComponent(JSON.stringify(input))}})
  const result=await response.json()
  if(!response.ok||result.error)throw Error(uiText(result.error||'无法读取资料库'))
  return result
}

export function createFileDestination(React,{Modal,Icon,ui,pool}) {
  const h=React.createElement,button=(label,onClick,props={})=>h(ui.Button,{type:'button',variant:'ghost',onClick,...props},label)
  const colors=[['violet','紫色','#625bc5','#aaa4ff'],['blue','蓝色','#4c76c8','#8fb9ff'],['green','绿色','#259783','#68d1b8'],['amber','黄色','#b97625','#f6b75a'],['rose','粉色','#cf5b78','#ef8eac'],['slate','灰色','#697386','#bec9dc']]
  function FolderIcon({color='violet'}) {
    const palette=colors.find(row=>row[0]===color)||colors[0]
    return h('svg',{width:20,height:20,viewBox:'0 0 24 24',fill:'none',stroke:`light-dark(${palette[2]},${palette[3]})`,strokeWidth:1.6,'aria-hidden':true},h('path',{d:'M3 7a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'}))
  }
  return function FileDestination({file,onClose}) {
    useLibraryLocale(React)
    const [crumbs,setCrumbs]=React.useState([]),[query,setQuery]=React.useState(''),[page,setPage]=React.useState(0)
    const [rows,setRows]=React.useState([]),[more,setMore]=React.useState(false),[loading,setLoading]=React.useState(true),[error,setError]=React.useState('')
    const [source,setSource]=React.useState(null),[sourceError,setSourceError]=React.useState(''),[busy,setBusy]=React.useState(false),[created,setCreated]=React.useState(null),[complete,setComplete]=React.useState(null)
    const [name,setName]=React.useState(''),[color,setColor]=React.useState('violet')
    const parentId=crumbs.at(-1)?.id||null,currentName=crumbs.at(-1)?.name||uiText('资料库')
    React.useEffect(()=>{
      const abort=new AbortController()
      generatedRequest({action:'prepare',file},abort.signal).then(setSource).catch(e=>{if(!abort.signal.aborted)setSourceError(e.message)})
      return ()=>abort.abort()
    },[file])
    React.useEffect(()=>{
      const abort=new AbortController();setLoading(true);setError('')
      if(!page){setRows([]);setMore(false)}
      const timer=setTimeout(async()=>{
        try {
          const data=await generatedRequest({action:'folders',parentId,query,offset:page*60},abort.signal)
          if(abort.signal.aborted)return
          setRows(old=>page?[...old,...data.items]:data.items);setMore(data.more)
          if(!query&&!page)setCrumbs(data.ancestors)
        }catch(e){if(!abort.signal.aborted)setError(e.message)}
        finally{if(!abort.signal.aborted)setLoading(false)}
      },query?140:0)
      return ()=>{clearTimeout(timer);abort.abort()}
    },[parentId,query,page])
    function navigate(next){setCrumbs(next);setQuery('');setPage(0);setCreated(null)}
    const close=()=>{if(!busy)onClose()}
    async function create(event){
      event.preventDefault();if(busy||!name.trim())return
      setBusy(true);setError('')
      try {const data=await generatedRequest({action:'create-folder',parentId,name,folderColor:color});navigate([...crumbs,data.item]);setName('')}
      catch(e){setError(e.message)}finally{setBusy(false)}
    }
    async function add(){
      if(busy||!source)return
      setBusy(true);setError('')
      try {setComplete(await generatedRequest({action:'add',file,parentId}))}catch(e){setError(e.message)}finally{setBusy(false)}
    }
    return h(Modal,{title:uiText('添加到 MOKI资料库'),className:'ml-picker ml-destination',onClose:close},
      h('div',{className:'ml-destination-file'},h(Icon),h('div',null,h('strong',{title:source?.path},source?.name||uiText('正在读取…')),h('small',null,uiText('保留原文件位置，仅添加资料库映射。')))),
      complete ? h('div',{className:'ml-destination-success',role:'status'},h(ui.IconCheckOutlineRegular,{size:28}),
        h('strong',null,uiText(complete.existing?'此文件已在目标文件夹中':'已添加到资料库')),h('span',null,currentName)) : h(React.Fragment,null,
        h('div',{className:'ml-destination-tools'},h('input',{className:'ml-picker-search',type:'search',value:query,disabled:busy,autoFocus:true,placeholder:uiText('搜索文件夹'),'aria-label':uiText('搜索文件夹'),onChange:e=>{setQuery(e.target.value);setPage(0)}}),
          button(uiText('新建文件夹'),()=>{setCreated(true);setName('');setColor('violet')},{disabled:busy||loading||!!query,'aria-expanded':!!created})),
        h('nav',{className:'ml-crumbs','aria-label':uiText('资料库位置')},button(uiText('资料库'),()=>navigate([]),{disabled:busy}),crumbs.map((folder,i)=>h(React.Fragment,{key:folder.id},' / ',button(folder.name,()=>navigate(crumbs.slice(0,i+1)),{disabled:busy})))),
        created && h('form',{className:'ml-destination-create',onSubmit:create},h('input',{className:'ml-picker-search',value:name,maxLength:240,disabled:busy,autoFocus:true,'aria-label':uiText('文件夹名称'),placeholder:uiText('文件夹名称'),onChange:e=>setName(e.target.value)}),
          h('div',{className:'ml-destination-colors',role:'group','aria-label':uiText('文件夹颜色')},colors.map(([id,label])=>button(h(FolderIcon,{color:id}),()=>setColor(id),{key:id,'aria-label':uiText(label),'aria-pressed':color===id,title:uiText(label),disabled:busy}))),
          h('div',{className:'ml-destination-create-actions'},button(uiText('取消'),()=>setCreated(null),{disabled:busy}),h(ui.Button,{type:'submit',variant:'primary',disabled:busy||!name.trim()},uiText('创建')))),
        h('div',{className:'ml-picker-list','aria-busy':loading},rows.map(folder=>h('button',{key:folder.id,type:'button',className:'ml-picker-row',disabled:busy,onClick:()=>navigate([...crumbs,folder])},h(FolderIcon,{color:folder.folderColor}),h('span',null,h('strong',null,folder.name)),h('span',{'aria-hidden':true},'›'))),
          loading&&h('p',{role:'status'},uiText('正在读取资料库…')),!loading&&!rows.length&&!error&&h('p',null,uiText(query?'没有匹配的文件夹':'没有子文件夹，可添加到当前位置或新建文件夹')),
          more&&!loading&&button(uiText('显示更多'),()=>setPage(page+1),{disabled:busy}))),
      (sourceError||error)&&h('div',{role:'alert',className:'ml-setting-error'},sourceError||error),
      h('footer',{className:'ml-picker-footer'},!complete&&h('span',{title:currentName},uiText('添加到：')+currentName),
        button(uiText(complete?'完成':'取消'),close,{disabled:busy}),complete?button(uiText('在资料库中打开'),async()=>{setBusy(true);setError('');try{await pool.openFile(complete.item,file.sessionId);onClose()}catch(e){setError(e.message)}finally{setBusy(false)}},{variant:'primary',disabled:busy}):button(uiText(busy?'正在添加…':'添加到此文件夹'),()=>void add(),{variant:'primary',disabled:busy||loading||!source||!!created||!!query})))
  }
}

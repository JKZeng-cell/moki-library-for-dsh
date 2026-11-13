import {l as uiText,useLibraryLocale} from './i18n.js'

export async function generatedRequest(input,signal) {
  const response=await fetch('/moki-library/generated-file',{signal,cache:'no-store',headers:{'x-moki-library':'1','x-moki-generated-file':encodeURIComponent(JSON.stringify(input))}})
  const result=await response.json()
  if(!response.ok||result.error)throw Error(uiText(result.error||'无法读取资料库'))
  return result
}

export function createFileDestination(React,{Modal,ui,pool}) {
  const h=React.createElement,button=(label,onClick,props={})=>h(ui.Button,{type:'button',variant:'ghost',onClick,...props},label)
  const colors=[['violet','紫色','#625bc5','#aaa4ff'],['blue','蓝色','#4c76c8','#8fb9ff'],['green','绿色','#259783','#68d1b8'],['amber','黄色','#b97625','#f6b75a'],['rose','粉色','#cf5b78','#ef8eac'],['slate','灰色','#697386','#bec9dc']]
  function FolderIcon({color='violet'}) {
    const palette=colors.find(row=>row[0]===color)||colors[0]
    return h('svg',{width:20,height:20,viewBox:'0 0 24 24',fill:'none',stroke:`light-dark(${palette[2]},${palette[3]})`,strokeWidth:1.6,'aria-hidden':true},h('path',{d:'M3 7a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'}))
  }
  function Glyph({name,size=16}) {
    const paths={file:'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z M14 3v6h6 M8 13h8 M8 17h5',search:'m21 21-4.3-4.3 M18 10.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0',plus:'M12 5v14 M5 12h14',back:'m14 6-6 6 6 6',next:'m9 6 6 6-6 6',close:'m6 6 12 12 M18 6 6 18'}
    return h('svg',{width:size,height:size,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.6,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true},h('path',{d:paths[name]}))
  }
  return function FileDestination({file,onClose}) {
    useLibraryLocale(React)
    const [crumbs,setCrumbs]=React.useState([]),[query,setQuery]=React.useState(''),[page,setPage]=React.useState(0)
    const [rows,setRows]=React.useState([]),[more,setMore]=React.useState(false),[loading,setLoading]=React.useState(true),[error,setError]=React.useState('')
    const [source,setSource]=React.useState(null),[sourceError,setSourceError]=React.useState(''),[busy,setBusy]=React.useState(false),[created,setCreated]=React.useState(null),[complete,setComplete]=React.useState(null)
    const [name,setName]=React.useState(''),[color,setColor]=React.useState('violet')
    const searchRef=React.useRef(null),crumbRef=React.useRef(null),createFormId=React.useId()
    const parentId=crumbs.at(-1)?.id||null,currentName=crumbs.at(-1)?.name||uiText('资料库')
    const currentPath=[uiText('资料库'),...crumbs.map(folder=>folder.name)].join(' / ')
    React.useLayoutEffect(()=>{if(crumbRef.current)crumbRef.current.scrollLeft=crumbRef.current.scrollWidth},[parentId])
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
      h('div',{className:'ml-destination-file'},h('span',{className:'ml-destination-file-icon'},h(Glyph,{name:'file',size:22})),h('div',null,h('strong',{title:source?.path},source?.name||uiText('正在读取…')),h('small',null,uiText('原文件保留在当前位置')))),
      complete ? h('div',{className:'ml-destination-success',role:'status'},h('div',{className:'ml-destination-success-icon'},h(ui.IconCheckOutlineRegular,{size:26})),
        h('strong',null,uiText(complete.existing?'此文件已在目标文件夹中':'已添加到资料库')),h('span',null,currentPath)) : h(React.Fragment,null,
        h('div',{className:'ml-destination-path'},button(h(Glyph,{name:'back'}),()=>navigate(crumbs.slice(0,-1)),{className:'ml-destination-back',disabled:busy||!!created||!parentId,'aria-label':uiText('返回上一级'),title:uiText('返回上一级')}),
          h(FolderIcon,{color:crumbs.at(-1)?.folderColor}),h('nav',{ref:crumbRef,className:'ml-crumbs','aria-label':uiText('资料库位置'),title:currentPath},button(uiText('资料库'),()=>navigate([]),{disabled:busy||!!created,'aria-current':!parentId?'location':undefined}),crumbs.map((folder,i)=>h(React.Fragment,{key:folder.id},h(Glyph,{name:'next',size:12}),button(folder.name,()=>navigate(crumbs.slice(0,i+1)),{disabled:busy||!!created,'aria-current':i===crumbs.length-1?'location':undefined,title:folder.name}))))),
        created ? h('form',{id:createFormId,className:'ml-destination-create',onSubmit:create},h('h3',null,uiText('新建文件夹')),
          h('label',null,h('span',null,uiText('文件夹名称')),h('input',{className:'ml-picker-search',value:name,maxLength:240,disabled:busy,autoFocus:true,'aria-label':uiText('文件夹名称'),placeholder:uiText('输入文件夹名称'),onChange:e=>setName(e.target.value)})),
          h('fieldset',null,h('legend',null,uiText('文件夹颜色')),h('div',{className:'ml-destination-colors'},colors.map(([id,label])=>button(h(FolderIcon,{color:id}),()=>setColor(id),{key:id,'aria-label':uiText(label),'aria-pressed':color===id,title:uiText(label),disabled:busy}))),h('small',{className:'ml-destination-color-name'},uiText(colors.find(row=>row[0]===color)?.[1]||'紫色')))) : h(React.Fragment,null,
          h('div',{className:'ml-destination-tools'},h('div',{className:'ml-destination-search'},h(Glyph,{name:'search'}),h('input',{ref:searchRef,className:'ml-picker-search',type:'search',value:query,disabled:busy,autoFocus:true,placeholder:uiText('搜索文件夹'),'aria-label':uiText('搜索文件夹'),onChange:e=>{setQuery(e.target.value);setPage(0)}}),
            query&&button(h(Glyph,{name:'close',size:14}),()=>{setQuery('');setPage(0);searchRef.current?.focus()},{className:'ml-destination-clear',disabled:busy,'aria-label':uiText('清除搜索'),title:uiText('清除搜索')})),
            button(h(React.Fragment,null,h(Glyph,{name:'plus'}),h('span',{className:'ml-destination-new-label'},uiText('新建文件夹'))),()=>{setCreated(true);setName('');setColor('violet')},{variant:'outline',className:'ml-destination-new',disabled:busy||loading||!!query,'aria-label':uiText('新建文件夹'),title:uiText('新建文件夹')})),
          h('div',{className:'ml-picker-list','aria-busy':loading,'aria-label':uiText('目标文件夹')},rows.map(folder=>h('button',{key:folder.id,type:'button',className:'ml-picker-row',disabled:busy,onClick:()=>navigate([...crumbs,folder]),title:folder.name},h('span',{className:'ml-destination-folder-icon'},h(FolderIcon,{color:folder.folderColor})),h('span',{className:'ml-destination-folder-name'},h('strong',null,folder.name)),h(Glyph,{name:'next',size:14}))),
            loading&&h('p',{role:'status'},uiText('正在读取资料库…')),!loading&&!rows.length&&!error&&h('div',{className:'ml-destination-empty'},h(FolderIcon),h('strong',null,uiText(query?'没有匹配的文件夹':'此文件夹中没有子文件夹')),h('span',null,uiText(query?'试试其他名称，或清除搜索浏览文件夹':'可以直接添加到这里，或新建文件夹'))),
            more&&!loading&&button(uiText('显示更多'),()=>setPage(page+1),{disabled:busy})))),
      (sourceError||error)&&h('div',{role:'alert',className:'ml-setting-error'},sourceError||error),
      h('footer',{className:'ml-picker-footer'},!complete&&h('div',{className:'ml-destination-target',title:currentPath},h('small',null,uiText(created?'新建位置':'添加到')),h('strong',null,currentName)),
        created? h(React.Fragment,null,button(uiText('返回'),()=>setCreated(null),{disabled:busy}),h(ui.Button,{type:'submit',form:createFormId,variant:'primary',disabled:busy||!name.trim()},uiText(busy?'正在创建…':'创建并进入'))):h(React.Fragment,null,
          button(uiText(complete?'完成':'取消'),close,{disabled:busy}),complete?button(uiText('在资料库中打开'),async()=>{setBusy(true);setError('');try{await pool.openFile(complete.item,file.sessionId);onClose()}catch(e){setError(e.message)}finally{setBusy(false)}},{variant:'primary',disabled:busy}):button(uiText(busy?'正在添加…':'确认添加'),()=>void add(),{variant:'primary',disabled:busy||loading||!source||!!query}))))
  }
}

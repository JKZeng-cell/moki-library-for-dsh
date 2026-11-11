import {defaults} from './preferences.mjs'

export function librarySettings(ctx, React, createPortal, Icon, ui) {
  const h=React.createElement, form=ctx.configForms.get('moki-library')
  const subscribe=listener=>form.subscribe(listener), snapshot=()=>form.getSnapshot()
  const useSettings=()=>React.useSyncExternalStore(subscribe,snapshot)
  function Modal({title,children,onClose,className=''}) {
    const ref=React.useRef(null), titleId=React.useId()
    React.useLayoutEffect(()=>{
      const dialog=ref.current
      dialog.showModal()
      return ()=>dialog.close()
    },[])
    return createPortal(h('dialog',{ref,className:'ml-library-modal '+className,'aria-labelledby':titleId,
      onCancel:event=>{event.preventDefault();onClose()}},
      h('div',{className:'ml-dialog-heading'},h('h2',{id:titleId},title),
        h(ui.Button,{type:'button',variant:'ghost',className:'ml-icon-button','aria-label':'关闭',onClick:onClose},h(ui.IconCloseOutlineRegular,{size:16}))),
      children),document.body)
  }
  function Fields(){
    const state=useSettings(), [pending,setPending]=React.useState(null),[error,setError]=React.useState('')
    const opts={...defaults,...state.value,...pending}, disabled=!!pending || !state.writable
    async function save(field,value){
      setPending({[field]:value});setError('')
      try { if (!await form.set(field,value)) throw new Error('设置未能保存，请重试') }
      catch(e){setError(e.message)} finally {setPending(null)}
    }
    const row=(title,detail,control)=>h('label',{className:'ml-setting-row'},h('span',null,h('strong',null,title),h('small',null,detail)),control)
    const toggle=(field,title,detail)=>row(title,detail,h('input',{type:'checkbox',role:'switch',className:'ml-switch','aria-label':title,
      checked:!!opts[field],disabled,onChange:e=>void save(field,e.target.checked)}))
    return h('div',{className:'ml-setting-fields','aria-busy':!!pending},
      row('文件预览打开方式','从资料库打开文件时使用。',h('select',{'aria-label':'文件预览打开方式',value:opts.previewMode,disabled,
        onChange:e=>void save('previewMode',e.target.value)},
        Object.entries({auto:'跟随资料库位置（默认）',main:'DSH 主窗口打开',window:'DSH 独立窗口打开',system:'默认应用打开'}).map(([value,label])=>h('option',{key:value,value},label)))),
      toggle('autoMapTaskFiles','自动映射 DSH 任务文件','将 DSH 新建或交付的文件映射到「DSH 任务文件」，保留原文件位置。'),
      toggle('composerPicker','对话输入框显示资料库','从输入框上方选择资料库文件，作为附件加入当前草稿。'),
      h(About),
      (error || state.status==='unavailable') && h('div',{role:'alert',className:'ml-setting-error'},error || 'DSH 设置暂不可用，请重新打开资料库。'))
  }
  function About(){
    const [notice,setNotice]=React.useState('')
    return h('section',{className:'ml-about','aria-label':'关于 MOKI资料库'},
      h('h3',null,'关于'),
      h('div',{className:'ml-about-brand'},h(Icon,{size:28}),h('div',null,
        h('strong',null,'MOKI资料库 for DSH'),h('small',null,'版本 '+__MOKI_LIBRARY_VERSION__+' · 开发者 JKZeng'))),
      h('p',null,'本地资料管理，与 DSH 对话协同。'),
      h('div',{className:'ml-about-contact'},h('a',{href:'https://github.com/JKZeng-cell/moki-library-for-dsh/issues',target:'_blank',rel:'noopener noreferrer',className:'ml-about-link'},'联系开发者 · GitHub Issues'),
        h(ui.Button,{type:'button',variant:'ghost',onClick:async()=>{
          try{await navigator.clipboard.writeText('https://github.com/JKZeng-cell/moki-library-for-dsh/issues');setNotice('反馈地址已复制')}catch{setNotice('复制失败，请打开反馈链接')}
        }},'复制反馈地址')),
      notice && h('small',{role:'status'},notice))
  }
  function SettingsButton(){
    const [open,setOpen]=React.useState(false)
    return h(React.Fragment,null,h(ui.Button,{type:'button',variant:'ghost',className:'ml-action ml-icon-button','aria-label':'资料库设置',title:'资料库设置',onClick:()=>setOpen(true)},
      h('svg',{width:16,height:16,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.6,strokeLinecap:'round','aria-hidden':true},
        h('path',{d:'M4 6h9m4 0h3M4 12h3m4 0h9M4 18h8m4 0h4'}),h('circle',{cx:15,cy:6,r:2}),h('circle',{cx:9,cy:12,r:2}),h('circle',{cx:14,cy:18,r:2}))),
      open && h(Modal,{title:'MOKI资料库设置',onClose:()=>setOpen(false)},h(Fields)))
  }
  function Section(){return h('section',{className:'ml-settings-section'},h('h2',null,'MOKI资料库'),h(Fields))}
  ctx.slots.inject('settings.section',()=>ctx.slots.register({name:'settings.section',id:'moki-library',order:65,label:()=>'MOKI资料库'},Section))
  ctx.slots.inject('settings.section.icon',()=>ctx.slots.register({name:'settings.section.icon',id:'moki-library'},Icon))
  return {form,useSettings,Modal,SettingsButton}
}

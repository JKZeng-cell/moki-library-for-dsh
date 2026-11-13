import React from 'react'
import {createRoot} from 'react-dom/client'
import {createPortal} from 'react-dom'
import {registerGeneratedFileActions} from '../../src/client-generated-files.js'
import {librarySettings} from '../../src/client-settings.js'
import {setLocale} from '../../src/i18n.js'
import css from '../../src/client-shell.css'
const h=React.createElement,slots=new Map()
let menu
const ui={Button:({variant,...props})=>h('button',props),IconCloseOutlineRegular:()=>h('span',null,'×'),IconCheckOutlineRegular:()=>h('span',null,'✓')},Icon=()=>h('span',null,'▤')
const ctx={effect(fn){fn()},inject(_deps,fn){fn(this)},slots:{inject(_name,fn){fn()},register(options,component){slots.set(options.name+':'+(options.id||options.key||''),component)}},
  configForms:{get:()=>({})},contextMenus:{register(value){menu=value}},remote:{workspaceFiles:{stat:async()=>({ok:true,value:{absolutePath:window.qaFile}})}}}
const {Modal}=librarySettings(ctx,React,createPortal,Icon,ui)
registerGeneratedFileActions(ctx,React,{Modal,Icon,ui,pool:{openFile:async item=>window.qaOpened=item}})
const style=document.createElement('style');style.textContent=css;document.head.append(style)
setLocale(new URLSearchParams(location.search).get('locale')||'zh')
function App(){
  const [actions,setActions]=React.useState([]),Host=slots.get('shell.overlay:moki-library.destination')
  return h(React.Fragment,null,h('button',{id:'file-menu',onClick:async()=>setActions(await menu.resolve({sessionId:'chat',path:window.qaFile},new AbortController().signal))},'File menu'),
    h('div',{role:'menu'},actions.map(action=>h('button',{key:action.id,role:'menuitem',onClick:()=>{action.run();setActions([])}},action.label))),h(Host))
}
createRoot(document.querySelector('#root')).render(h(App))

import React from 'react'
import {createRoot} from 'react-dom/client'
import {createFramePool} from '../../src/client-frames.js'
import {registerPanels} from '../../src/client-panel.js'
import {createChatComponents} from '../../src/client-chat.js'
import {selectionQuote} from '../../src/selection-context.js'

const h=React.createElement
function source(initial){
  let value=initial
  const listeners=new Set()
  return {getSnapshot:()=>value,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn)},set(next){value=next;for(const fn of listeners)fn()}}
}
const useSource=value=>React.useSyncExternalStore(value.subscribe,value.getSnapshot)
const sessions=new Map()
function binding(id){
  if(sessions.has(id))return sessions.get(id)
  const input=source({phase:'plain',draft:id==='current'?'Keep my question.\n':'History draft.\n'})
  const stats={writes:0,persists:0}
  const value={key:id,hooks:{input},props:{inputActions:{
    insertQuote(text){stats.writes++;input.set({...input.getSnapshot(),draft:input.getSnapshot().draft+'> '+text+'\n'});return true},
    persistDraft(){stats.persists++},
  }},stats}
  sessions.set(id,value)
  return value
}
const current=source(binding('current')),panel=source({activePanelId:null}),slots=new Map(),cleanup=[]
const sent=[],drafts=new Map(),quickState={pauseUploads:false,fail:false,released:0,created:0}
const tab={id:'file-tab',contentId:'dsh-resource://moki-library/'+window.qaItemId,visible:true,signal:new AbortController().signal}
const ctx={
  effect(fn){const dispose=fn();if(typeof dispose==='function')cleanup.push(dispose)},
  slots:{inject(name,fn){fn()},register(spec,component){slots.set(spec.name+':'+spec.key,component);return()=>{}}},
  layout:{panelInfo:panel,selectPanel(id){panel.set({activePanelId:id})}},
  uiSession:{adapter:{current,bindingSource:reference=>source(binding(reference.id))}},
  sessions:{retain(id){return{id,ready:Promise.resolve(),binding:{session:{sessionId:id,getSnapshot:()=>({subagent:null})}},release(){}}}},
  conversation:{
    createDrafts(id,files){quickState.created+=files.length;return files.map(file=>{const draft={id:crypto.randomUUID(),kind:'file',file};drafts.set(draft.id,draft);return draft})},
    fileUploads:{getSnapshot:()=>Object.fromEntries([...drafts.keys()].map(id=>[id,{status:quickState.pauseUploads?'uploading':'ready'}]))},
    releaseDraftAttachments(items){quickState.released+=items.length;items.forEach(item=>drafts.delete(item.id))},
    async sendSession(session,text,ids){if(quickState.fail)throw new Error('Test send failed');sent.push({sessionId:session.sessionId,text,files:await Promise.all(ids.map(async id=>({name:drafts.get(id).file.name,text:await drafts.get(id).file.text()})))});return {kind:'success'}}
  },
  sidebarRight:{openResource(){},closeIn(){},openTab(){}},sidebarRightTabs:{register(){return()=>{}}},
  uiWorkspace:{startSession(){current.set(binding('current'))}},
}
const icon=()=>null
const ui=new Proxy({Button:({children,variant,...props})=>h('button',props,children)},{get(target,key){return target[key]||icon}})
const pool=createFramePool(()=>false,ctx,selectionQuote,source({value:{}}))
const {useChatBinding}=createChatComponents(React,ui,{},()=> 'blank')
function NativeInput({id}){
  const state=useSource(binding(id).hooks.input)
  return h('textarea',{'data-composer-input':'','data-input-session':id,value:state.draft,onChange:()=>{}})
}
function Chat({target,choose,onClose}){
  return h('div',{role:'dialog',className:'ml-dialog','data-chat-target':target},
    h('button',{'data-test-history':'',onClick:()=>choose('history')},'Switch history'),
    h('button',{'data-test-close':'',onClick:onClose},'Close'),h(NativeInput,{id:target}))
}
registerPanels(ctx,React,{Icon:icon,Chat,Conversation:icon,useChatBinding,quote:selectionQuote,publish(){},views:new Map(),pool,css:'',kind:'moki-library',type:'dsh-moki-library/catalog',t:()=> 'Library',ui,SettingsButton:icon})
const Main=slots.get('main:moki-library'),Side=slots.get('sidebar.right.pane.tab:dsh-moki-library/document')
const seat={renderSlot:()=>null,SessionProvider:({children})=>children}
function App(){
  const active=useSource(panel).activePanelId,bound=useSource(current)
  return h('div',{className:'qa-shell','data-main':Boolean(active)},
    active?h(Main,seat):h('div',{'data-conversation-content':'','data-conversation-session':bound.key},h(NativeInput,{id:bound.key})),
    h('aside',{hidden:Boolean(active)},h(Side,{...seat,sessionId:'current',useTabInfo:()=>({tab})})))
}
createRoot(document.getElementById('root')).render(h(App))
window.qa={pool,binding,current,sent,quickState,entry:()=>pool.entryFor('moki-document-'+window.qaItemId,window.qaItemId)}

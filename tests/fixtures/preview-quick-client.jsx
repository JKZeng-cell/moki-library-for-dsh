import React from 'react'
import {createRoot} from 'react-dom/client'
import {createPortal} from 'react-dom'
import {PreviewChat} from '../../web/preview-chat.tsx'
import {registerPreviewChat} from '../../src/client-preview-chat.js'
import {selectionQuote} from '../../src/selection-context.js'

const h=React.createElement
const source=value=>({getSnapshot:()=>value,subscribe:()=>()=>{}})
if(location.pathname==='/child'){
  const components=new Map(),state={sent:[],draft:'UNSENT MAIN DRAFT',fail:false}
  const binding={hooks:{input:source({phase:'plain',draft:state.draft})},props:{inputActions:{insertQuote(){throw Error('Must not modify the native draft')}}}}
  const session={sessionId:'current',getSnapshot:()=>({subagent:null})},reference={binding:{session}}
  const files=new Map()
  const ctx={
    sessions:{retain(){return{...reference,ready:Promise.resolve(),release(){}}},list:source({phase:'ready',byId:{current:{id:'current'}}})},
    uiSession:{adapter:{current:source({key:'current'}),bindingSource:()=>source(binding)}},
    conversation:{createDrafts(_,values){return values.map(file=>{const id=crypto.randomUUID();files.set(id,file);return{id,kind:'file'}})},fileUploads:{getSnapshot:()=>Object.fromEntries([...files.keys()].map(id=>[id,{status:'ready'}]))},releaseDraftAttachments(){},
      async sendSession(_,text,ids){if(state.fail)throw Error('Native send rejected');state.sent.push({text,files:await Promise.all(ids.map(async id=>({name:files.get(id).name,text:await files.get(id).text()})))});return{kind:'success'}}},
    effect:fn=>fn(),slots:{inject:(_,fn)=>fn(),register:(spec,component)=>{components.set(spec.name,component);return()=>{}}},layout:{selectPanel(){}}
  }
  registerPreviewChat(ctx,React,{key:'preview-key',Chat:()=>h('div',{'data-native-chat':''},'DSH conversation'),Conversation:()=>null,useChatBinding:()=>({reference}),quote:selectionQuote,QuoteContext:React.createContext(null),css:'',createPortal})
  const Seat=components.get('main');createRoot(document.getElementById('root')).render(h(Seat,{SessionProvider:({children})=>children,renderSlot:()=>null}))
  window.qa=state
}else{
  createRoot(document.getElementById('root')).render(h(PreviewChat,{origin:location.origin,action:async action=>{
    if(action==='compose')for(let attempt=0;attempt<30;attempt++){
      const frame=document.querySelector('[data-moki-preview-chat]');if(frame){if(!frame.src)frame.src=location.origin+'/child';return}await new Promise(resolve=>setTimeout(resolve,20))
    }
  }}))
  window.qaResults=[];window.addEventListener('moki:quick-submit-result',event=>qaResults.push(event.detail))
  window.qaSend=(id,prompt)=>window.dispatchEvent(new CustomEvent('moki:preview-compose',{detail:{
    selection:{label:'Sheet1 · B2',content:JSON.stringify({selectedText:'42',location:{range:'B2'}})},
    submission:{id,prompt,files:[new File(['ATTACHED'],'brief.txt',{type:'text/plain'})]}
  }}))
}

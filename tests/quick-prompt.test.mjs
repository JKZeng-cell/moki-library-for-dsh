import test from 'node:test'
import assert from 'node:assert/strict'
import {createQuickPromptSender} from '../src/quick-prompt.js'

function harness(){
  const state={upload:'uploading',sends:[],released:0,retained:0,outcome:'success'}
  const session={sessionId:'chat-a',getSnapshot:()=>({subagent:null})}
  const ctx={sessions:{retain(id){assert.equal(id,'chat-a');state.retained++;return{binding:{session},ready:Promise.resolve(),release(){state.retained--}}}},conversation:{
    createDrafts(id,files){return files.map((file,index)=>({id:'file-'+index,kind:'file',file}))},
    fileUploads:{getSnapshot:()=>({'file-0':{status:state.upload}})},
    releaseDraftAttachments(drafts){state.released+=drafts.length},
    async sendSession(target,text,ids,mode){assert.equal(target,session);state.sends.push({text,ids,mode});return{kind:state.outcome}}
  }}
  return {state,send:createQuickPromptSender(ctx),request:{id:'request-1',text:'> exact selection\n\nEdit it',files:[new File(['brief'],'brief.txt',{type:'text/plain'})]}}
}
test('quick submission waits for native uploads and admits duplicate clicks only once',async()=>{
  const {state,send,request}=harness()
  const first=send('chat-a',request),second=send('chat-a',request)
  assert.equal(first,second);await new Promise(resolve=>setTimeout(resolve,20));assert.equal(state.sends.length,0)
  state.upload='ready';await first
  assert.deepEqual(state.sends,[{text:request.text,ids:['file-0'],mode:'queue'}]);assert.equal(state.released,0);assert.equal(state.retained,0)
  await send('chat-a',request);assert.equal(state.sends.length,1)
})
test('upload failure and navigation cancel before admission and release only quick attachments',async()=>{
  const {state,send,request}=harness();state.upload='error'
  await assert.rejects(send('chat-a',request),/附件上传失败/);assert.equal(state.sends.length,0);assert.equal(state.released,1)
  state.upload='uploading';let active=true
  const pending=send('chat-a',request,{valid:()=>active});await new Promise(resolve=>setTimeout(resolve,20));active=false
  await assert.rejects(pending,/会话已切换/);assert.equal(state.sends.length,0);assert.equal(state.released,2);assert.equal(state.retained,0)
  state.upload='ready';await send('chat-a',request);assert.equal(state.sends.length,1)
})
test('a rejected native admission is retryable without losing the caller files',async()=>{
  const {state,send,request}=harness();state.upload='ready';state.outcome='error'
  await assert.rejects(send('chat-a',request),/DSH 未能发送/)
  assert.equal(await request.files[0].text(),'brief');assert.equal(state.released,1)
  state.outcome='success';await send('chat-a',request);assert.equal(state.sends.length,2);assert.equal(state.retained,0)
})

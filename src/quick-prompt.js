// Use DSH's native attachment and submission service without touching its draft.
// This file is shared with MOKI Canvas for the same quick-composer contract.
export function createQuickPromptSender(ctx,t=value=>value){
  const requests=new Map();
  return function sendQuickPrompt(sessionId,request,{valid=()=>true,signal}={}){
    if(!request?.id||typeof request.text!=='string')return Promise.reject(new Error(t('快捷指令无效，请重新输入')));
    const key=sessionId+':'+request.id;
    if(requests.has(key))return requests.get(key);
    const pending=(async()=>{
      let reference,drafts=[],accepted=false;
      const check=()=>{if(signal?.aborted||!valid())throw new Error(t('当前文件或会话已切换，请重新发送'));};
      try{
        check();reference=ctx.sessions.retain(sessionId,{source:'moki-quick-composer'});await reference.ready;check();
        const session=reference.binding.session,files=request.files??[];
        if(files.some(file=>!(file instanceof File)||file.size>32*1024*1024))throw new Error(t('单个对话附件不能超过 32 MB'));
        drafts=ctx.conversation.createDrafts(sessionId,files,session.getSnapshot().subagent===null);
        const deadline=Date.now()+120000;
        while(drafts.length){
          check();const uploads=ctx.conversation.fileUploads.getSnapshot();
          const states=drafts.map(draft=>uploads[draft.id]??(draft.kind==='image'?{status:'ready'}:null));
          const failed=states.find(upload=>upload?.status==='error');
          if(failed)throw new Error(t('附件上传失败，请重试'));
          if(states.every(upload=>upload?.status==='ready'))break;
          if(Date.now()>deadline)throw new Error(t('附件上传超时，请重试'));
          await new Promise(resolve=>setTimeout(resolve,80));
        }
        check();const result=await ctx.conversation.sendSession(session,request.text,drafts.map(draft=>draft.id),'queue',signal);
        if(result?.kind==='error')throw new Error(t('DSH 未能发送，请检查会话后重试'));
        accepted=true;return {sent:true};
      }finally{if(!accepted&&drafts.length)ctx.conversation.releaseDraftAttachments(drafts);reference?.release();}
    })();
    requests.set(key,pending);pending.catch(()=>requests.delete(key));
    if(requests.size>100)requests.delete(requests.keys().next().value);
    return pending;
  };
}

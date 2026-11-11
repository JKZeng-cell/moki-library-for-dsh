import {randomUUID} from 'node:crypto'
import {createPreviewBrowser} from './preview-browser.mjs'

export const documentOwner = id => 'moki-document-'+id

export function createPreviewService({find,makeFrame,dropFrame,origin,chatHost,browser=createPreviewBrowser()}) {
  const windows=new Map(), requests=new Map(), attached=new Map(), chats=new Map()
  function finish(key,error) {
    const command=requests.get(key)
    if (!command) return
    requests.delete(key); clearTimeout(command.timer)
    if (error) command.reject(new Error(error))
    else command.resolve()
  }
  function forget(record) {
    if (windows.get(record.item.id)!==record) return
    windows.delete(record.item.id)
    chats.delete(record.chatKey)
    detach(record.frame)
    dropFrame(record.frame)
    for (const [key,command] of requests) if (command.record===record) finish(key,'预览窗口已关闭')
  }
  async function open({id,client,session,appearance,office}) {
    const item=find(id)
    if (!item || !['local_file','url'].includes(item.kind)) throw new Error('未找到可预览的文件或链接')
    let record=windows.get(id)
    if (!record) {
      const frame=makeFrame(documentOwner(id),origin())
      frame.documentId=id;frame.desktop=client;frame.appearance=appearance;frame.chatId=session
      record={item,frame,client,session,chatKey:randomUUID()}
      windows.set(id,record)
      chats.set(record.chatKey,record)
      const url=new URL('/view/'+frame.key+'/index.html',origin())
      url.search=new URLSearchParams({document:id,mode:'window',theme:appearance.dark?'dark':'light'})
      if(office)url.searchParams.set('resumeOffice','1')
      record.opening=browser.open(url.href).then(page=>{
        record.page=page
        page.once('close',()=>forget(record))
        return page.waitForSelector('[data-moki-document]',{timeout:18000}).then(()=>page).catch(async error=>{await page.close().catch(()=>{});throw error})
      }).catch(error=>{forget(record);throw error})
    }
    const page=await record.opening
    record.client=client;record.session=session;record.frame.desktop=client
    await page.bringToFront()
    return {opened:true}
  }
  function owned(frame) {
    const record=windows.get(frame.documentId)
    if (!record || record.frame!==frame) throw new Error('独立预览窗口已关闭')
    return record
  }
  function request(frame,action,office=false) {
    const record=owned(frame)
    const key=randomUUID()
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>finish(key,'DSH 未能接收预览，请回到 DSH 后重试'),25000)
      requests.set(key,{record,action,office,timer,resolve,reject})
    })
  }
  function poll(client) {
    return {open:[...windows.values()].filter(r=>r.client===client).map(r=>r.item.id),
      commands:[...requests].filter(([,c])=>c.record.client===client).map(([key,{record,action,office}])=>({
        key,action,office,id:record.item.id,name:record.item.name,session:record.session,selection:record.frame.selection
      }))}
  }
  function detach(frame) {
    for (const [session,current] of attached) if(current===frame)attached.delete(session)
  }
  function bind(client,id,chatId) {
    const record=windows.get(id)
    if (!record || record.client!==client) throw new Error('独立预览窗口已关闭')
    detach(record.frame)
    if (chatId) attached.set(chatId,record.frame)
    record.frame.chatId=chatId
  }
  function chatInfo(key,sessionId) {
    const record=chats.get(key)
    if(!record?.chatStarted) throw new Error('请重新唤起当前文件的 DSH 对话')
    if(sessionId) {
      record.chatSession=sessionId
      if(record.chatVisible)bind(record.client,record.item.id,sessionId)
    }
    const initial=record.session.startsWith('browse-') ? null : record.session
    return {parentOrigin:origin(),sessionId:record.chatSession || initial,selection:record.frame.selection}
  }
  async function enterChat(record) {
    const page=await record.opening
    const ownerUrl=new URL(page.url())
    if(ownerUrl.origin!==origin() || ownerUrl.pathname!=='/view/'+record.frame.key+'/index.html') throw new Error('预览地址已更改，请重新打开文件')
    const holder=await page.waitForSelector('iframe[data-moki-preview-chat]',{timeout:8000})
    try {
      const child=await holder.contentFrame()
      if(!child)throw new Error()
      const fragment='#moki-preview-chat='+record.chatKey
      if(child.url()===chatHost.origin+'/'+fragment)return
      // The DSH host performs its normal browser sign-in. Only the owned child
      // frame navigates there. The document UI receives no DSH launch credential.
      const launch=new URL(chatHost.launch())
      if(launch.origin!==chatHost.origin || launch.pathname!=='/')throw new Error()
      launch.hash=fragment
      const response=await child.goto(launch.href,{waitUntil:'domcontentloaded',timeout:18000})
      if(!response?.ok() || new URL(child.url()).origin!==chatHost.origin)throw new Error()
      if(new URL(child.url()).hash!==fragment)await child.goto(chatHost.origin+'/'+fragment,{waitUntil:'domcontentloaded',timeout:12000})
    } catch {throw new Error('DSH 对话未能载入，请重试')}
    finally {await holder.dispose()}
  }
  function openChat(frame) {
    const record=owned(frame)
    if(!chatHost)throw new Error('本机 DSH 对话服务不可用')
    record.chatStarted=true
    record.chatVisible=true
    if(record.chatSession)bind(record.client,record.item.id,record.chatSession)
    record.chatOpening??=enterChat(record).finally(()=>{record.chatOpening=undefined})
    return record.chatOpening
  }
  function hideChat(frame) {
    const record=owned(frame)
    record.chatVisible=false
    detach(frame)
  }
  function activateChat(frame) {
    const record=owned(frame)
    if(record.chatVisible && record.chatSession)bind(record.client,record.item.id,record.chatSession)
  }
  function active(id) {
    const frame=attached.get(id)
    if (frame && windows.get(frame.documentId)?.frame===frame) return frame
    attached.delete(id)
  }
  return {open,poll,request,bind,active,openChat,hideChat,activateChat,chatInfo,
    releaseSession(chatId) { attached.delete(chatId) },
    async dockOpen(client,id,destination='sidebar') {
      const record=windows.get(id)
      if(!record)return false
      const page=await record.opening
      record.client=client
      await page.evaluate(target=>window.dispatchEvent(new CustomEvent('moki:dock-document',{detail:target})),destination)
      return true
    },
    async appearance(client,next) {
      await Promise.all([...windows.values()].filter(r=>r.client===client).map(async r=>{
        r.frame.appearance=next
        await r.page?.evaluate(value=>window.dispatchEvent(new CustomEvent('moki:document-appearance',{detail:value})),next).catch(()=>{})
      }))
    },
    ack(client,key,error) { if (requests.get(key)?.record.client===client) finish(key,error) },
    closeWindow(frame) { const r=owned(frame); setTimeout(()=>void r.page?.close().catch(()=>{}),60) },
    async close() {
      for (const key of requests.keys()) finish(key,'资料库正在关闭')
      await browser.close();attached.clear()
    }
  }
}

import Fastify from 'fastify'
import serveStatic from '@fastify/static'
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomBytes, createHash } from 'node:crypto'
import { createServer } from 'node:net'
import { readFileSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import schema from '@deepseek-ai/schemastery'
import {defaults, option} from './preferences.mjs'
import {taskFileMapper, listenForTaskFiles} from './task-files.mjs'
import { ResourceLibraryRepository } from '../vendor/moki/server/repositories/resource-library-repository.ts'
import { registerResourceLibraryRoutes } from '../vendor/moki/server/routes/resource-library-routes.ts'
import {registerPreviewFiles} from './preview-files.mjs'
import {registerStreamUpload} from './stream-upload.mjs'
import { registerWorkspaceEditorRoutes } from '../vendor/moki/server/routes/workspace-editor-routes.ts'
import { WorkspaceEditorBridge } from '../vendor/moki/server/services/workspace-editor-bridge.ts'
import { UniverOfficeRuntime } from '../vendor/moki/documents/univer-office-runtime.ts'
import { EditorDraftStore } from '../vendor/moki/documents/editor-draft-store.ts'
import { prepareOffice } from './office-assets.mjs'
import { openCatalog, workbenchCatalog } from './catalog.mjs'
import { openItem, pickPath, copyLocalFiles, focusDsh } from './desktop.mjs'
import { createWindowsFileTransfer } from './windows-file-transfer.mjs'
import { createPreviewService, documentOwner } from './preview-service.mjs'
import { libraryTools, guidance } from './tools.mjs'

const pluginVersion = JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version
export const Config = schema.object({
  previewMode:schema.union(['auto','main','window','system']).default(defaults.previewMode).volatile(),
  autoMapTaskFiles:schema.boolean().default(defaults.autoMapTaskFiles).volatile(),
  composerPicker:schema.boolean().default(defaults.composerPicker).volatile()
})
const root = fileURLToPath(new URL('../app/',import.meta.url))
const stateSchema = z.object({active:z.boolean(), focused:z.boolean().optional(), seq:z.number().int().nonnegative(),
  chatId:z.string().min(1).max(240).nullable().optional(), previewId:z.string().uuid().nullable().optional(),
  selection:z.object({label:z.string().max(1000),content:z.string().max(4000000),itemCount:z.number().int().nonnegative()}).nullable()})
const sessionIdOf = agent => agent?.session?.id ?? agent?.sessionId
const localParent = origin => /^dsh-app:\/\/app$|^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(origin)
const appearanceSchema=z.object({dark:z.boolean(),theme:z.record(z.string().regex(/^--dsw-(?:alias|font|radius)-[a-z0-9-]+$/),z.string().max(4096)),font:z.string().max(4096),rootSize:z.string().max(32)})
const windowRequest=z.discriminatedUnion('action',[
  z.object({action:z.literal('open'),client:z.string().uuid(),session:z.string().min(1).max(240),id:z.string().uuid(),appearance:appearanceSchema,office:z.boolean().optional()}),
  z.object({action:z.literal('dock-open'),client:z.string().uuid(),id:z.string().uuid(),destination:z.enum(['main','sidebar']).optional()}),
  z.object({action:z.literal('poll'),client:z.string().uuid()}),
  z.object({action:z.literal('appearance'),client:z.string().uuid(),appearance:appearanceSchema}),
  z.object({action:z.literal('ack'),client:z.string().uuid(),key:z.string().uuid(),error:z.string().max(1000).optional()}),
  z.object({action:z.literal('bind'),client:z.string().uuid(),id:z.string().uuid(),chatId:z.string().min(1).max(240).nullable()})
])

async function availablePort() {
  const socket = createServer()
  await new Promise((resolve,reject)=>socket.once('error',reject).listen(0,'127.0.0.1',resolve))
  const port = socket.address().port
  await new Promise(resolve=>socket.close(resolve))
  return port
}

export async function createRuntime(config={}) {
  const dataDir = config.dataDir ?? join(process.env.DSH_HOME || join(homedir(),'.dsh'),'moki-library')
  const db = openCatalog(dataDir,config.sourceDb === undefined ? workbenchCatalog() : config.sourceDb)
  const repository = new ResourceLibraryRepository(db)
  const fileTransfer = process.platform === 'win32' ? createWindowsFileTransfer() : undefined
  const scope = new AsyncLocalStorage()
  const frames = new Map(), sessions = new Map(), changes = []
  let version = 0, appUrl
  function session(id) {
    if (!id) throw new Error('DSH 会话不可用')
    if (!sessions.has(id)) {
      const dir = join(dataDir,'sessions',createHash('sha256').update(id).digest('hex'))
      const editors = new WorkspaceEditorBridge()
      const textDrafts = new EditorDraftStore(join(dir,'editor-drafts'))
      sessions.set(id,{dir,editors,textDrafts})
    }
    return sessions.get(id)
  }
  function office(id) {
    const s=session(id)
    if (!s.office) s.office=prepareOffice().then(availablePort).then(port=>new UniverOfficeRuntime(s.dir,{gatewayPort:port})).catch(error=>{s.office=undefined;throw error})
    return s.office
  }
  function change(itemId,operation='catalog',owner) {
    changes.push({version:++version,itemId,operation,owner})
    if (changes.length>256) changes.shift()
  }
  const makeFrame=(sessionId,parentOrigin,internal=false)=>{
    const key=randomBytes(24).toString('hex')
    const frame={key,sessionId,parentOrigin,internal,lastSeen:Date.now(),seq:-1,selection:null}
    frames.set(key,frame)
    return frame
  }
  const taskFiles=taskFileMapper(db,repository,config,change)
  const disposeFrame=frame=>{
    const target=sessions.get(frame.chatId ?? frame.sessionId)
    if(target?.active===frame) target.active=undefined
    for(const id of frame.editors || [])sessions.get(frame.sessionId)?.editors.remove(id)
    frames.delete(frame.key)
  }
  const app=Fastify({logger:false,bodyLimit:8_000_000,rewriteUrl(req){
    const match=/^\/view\/([a-f0-9]{48})(\/[^#]*)$/.exec(req.url)
    const frame=match && frames.get(match[1])
    if (!frame) return '/denied'
    req.libraryFrame=frame
    return match[2]
  }})
  const previews=createPreviewService({find:id=>repository.find(id),makeFrame,dropFrame:disposeFrame,origin:()=>appUrl,chatHost:config.chatHost,browser:config.previewBrowser})
  app.addHook('onRequest',(req,reply,done)=>{
    const frame=req.raw.libraryFrame
    if(!frame) return reply.code(403).send({error:'需要从 DSH 资料库入口打开'})
    if(!frame.internal && req.headers.host!==new URL(appUrl).host) return reply.code(403).send({error:'无效的资料库地址'})
    if(req.headers.origin && req.headers.origin!==appUrl) return reply.code(403).send({error:'请求来源不匹配'})
    if(!['GET','HEAD'].includes(req.method) && req.headers['sec-fetch-site']==='cross-site') return reply.code(403).send({error:'请求来源不匹配'})
    frame.lastSeen=Date.now()
    reply.header('referrer-policy','no-referrer').header('x-content-type-options','nosniff')
    if(req.url.startsWith('/api/')) reply.header('cache-control','no-store')
    if(/\/(?:preview|attachment)(?:\?|$)/.test(req.url)) reply.header('content-security-policy',"sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:")
    else if(!frame.internal) reply.header('content-security-policy',"frame-ancestors 'self' "+frame.parentOrigin)
    scope.run(frame,done)
  })
  app.setErrorHandler((error,req,reply)=>reply.code(error.statusCode ?? (error instanceof z.ZodError?400:500)).send({error:error.message}))
  const current=()=>session(scope.getStore().sessionId)
  const officeProxy=new Proxy({}, {get:(_t,name)=>(...args)=>office(scope.getStore().sessionId).then(instance=>instance[name](...args))})
  try {
    registerPreviewFiles(app,repository)
    registerStreamUpload(app,repository,dataDir)
    await registerResourceLibraryRoutes(app,{repository,stateDirectory:dataDir,univerOfficeRuntime:officeProxy,
      onIndexChanged:folderId=>change(folderId),
      getTextDrafts:()=>current().textDrafts,
      getChatAnalysisSettings:()=>({deepseekOcrEnabled:Boolean(config.ocr?.baseUrl || process.env.MOKI_LIBRARY_OCR_URL),
        deepseekOcrBaseUrl:config.ocr?.baseUrl || process.env.MOKI_LIBRARY_OCR_URL,deepseekOcrModel:config.ocr?.model || process.env.MOKI_LIBRARY_OCR_MODEL,
        deepseekOcrApiKey:config.ocr?.apiKey || process.env.MOKI_LIBRARY_OCR_KEY}),assistantAttachmentDirectory:join(dataDir,'attachments'),
      openResource:item=>openItem(item),revealResource:item=>openItem(item,true)})
    const editorProxy=new Proxy({}, {get:(_t,name)=>(...args)=>{
      const frame=scope.getStore()
      if(!frame.internal && name==='register')(frame.editors ??= new Set()).add(args[0].editorId)
      if(name==='remove')frame.editors?.delete(args[0])
      return current().editors[name](...args)
    }})
    registerWorkspaceEditorRoutes(app,editorProxy)
    app.get('/api/dsh/document',async(req,reply)=>{
      const frame=req.raw.libraryFrame, item=frame.documentId && repository.find(frame.documentId)
      if(!item) return reply.code(404).send({error:'预览资料不存在'})
      return {item,appearance:frame.appearance,chatId:frame.chatId,chatOrigin:config.chatHost?.origin}
    })
    app.post('/api/dsh/document-action',async req=>{
      const {action,office}=z.object({action:z.enum(['close','dock','main','compose','hide-chat','activate-chat']),office:z.boolean().optional()}).parse(req.body)
      if(action==='close') previews.closeWindow(req.raw.libraryFrame)
      else if(action==='compose') await previews.openChat(req.raw.libraryFrame)
      else if(action==='hide-chat') previews.hideChat(req.raw.libraryFrame)
      else if(action==='activate-chat') previews.activateChat(req.raw.libraryFrame)
      else {const pending=previews.request(req.raw.libraryFrame,action,office);void focusDsh();await pending}
      return {ok:true}
    })
    app.post('/api/dsh/state',async req=>{
      const next=stateSchema.parse(req.body), frame=req.raw.libraryFrame
      if(next.seq>frame.seq) {
        frame.seq=next.seq
        const target=next.chatId ?? frame.sessionId
        const activateDocument=frame.documentId && !frame.desktop && next.active && (next.focused || !frame.active || target!==frame.chatId)
        const previous=sessions.get(frame.chatId ?? frame.sessionId)
        if(previous?.active===frame && (!next.active || target!==frame.chatId)) previous.active=undefined
        frame.active=next.active
        frame.chatId=target
        frame.previewId=next.previewId
        frame.selection=next.selection
        if(activateDocument)previews.releaseSession(target)
        if(next.active && !frame.desktop) session(target).active=frame
      }
      return {ok:true}
    })
    app.post('/api/dsh/close',async req=>{disposeFrame(req.raw.libraryFrame);return {closed:true}})
    app.post('/api/dsh/selection-image',async req=>{
      const image=z.object({token:z.string().uuid(),data:z.string().max(2800000).regex(/^[A-Za-z0-9+/]+={0,2}$/),mediaType:z.literal('image/webp'),width:z.number().int().positive().max(1600),height:z.number().int().positive().max(1600)}).parse(req.body)
      req.raw.libraryFrame.selectionImage=image
      return {ok:true}
    })
    app.get('/api/dsh/changes',async req=>{
      const after=Number(req.query.after)
      return {version,changes:Number.isSafeInteger(after)&&after>=0 ? changes.filter(e=>e.version>after && (!e.owner||e.owner===req.raw.libraryFrame.sessionId)).map(({owner,...change})=>change):[]}
    })
    async function transferPaths(req) {
      const request=z.union([z.object({ids:z.array(z.string().uuid()).min(1)}),z.object({id:z.string().uuid()})]).parse(req.body)
      const ids='ids' in request ? request.ids : [request.id]
      const paths=ids.map(id=>{
        const item=repository.find(id)
        if(item?.kind!=='local_file' || !item.target) throw new Error('请选择本地文件')
        return item.target
      })
      const files=[...new Set(paths)]
      await Promise.all(files.map(async path=>{if(!(await stat(path)).isFile()) throw new Error('请选择现有的本地文件')}))
      return files
    }
    app.post('/api/dsh/prepare-file-drag',async()=>{await fileTransfer?.warm();return {native:Boolean(fileTransfer)}})
    app.post('/api/dsh/drag-files',async(req,reply)=>{
      if(!fileTransfer) return reply.code(400).send({error:'当前平台没有 Windows 文件拖放服务'})
      return {effect:await fileTransfer.transfer('drag',await transferPaths(req))}
    })
    app.post('/api/dsh/copy-file',async req=>{
      const paths=await transferPaths(req)
      if(fileTransfer) await fileTransfer.transfer('copy',paths)
      else await copyLocalFiles(paths)
      return {copied:true}
    })
    app.post('/api/dsh/picker',async req=>{
      const {kind,name}=z.object({kind:z.enum(['folder','file','save']),name:z.string().max(240).optional()}).parse(req.body)
      return {path:await pickPath(kind,name)}
    })
    app.addHook('onResponse',async(req,reply)=>{
      if(reply.statusCode>=300 || ['GET','HEAD'].includes(req.method)) return
      const route=req.routeOptions.url || ''
      if(route==='/api/library/items' || route==='/api/library/files' || route==='/api/library/workspace-files' || route==='/api/library/workspace-files/stream' ||
        /^\/api\/library\/items\/:id(?:\/(?:move|import-local|permanent-delete|content|office-content))?$/.test(route)) {
        if(req.body && Object.keys(req.body).length===1 && 'thumbnailDataUrl' in req.body) return
        change(req.params?.id,route.endsWith('/content')||route.endsWith('/office-content')?'file':'catalog')
      }
    })
    await app.register(serveStatic,{root,index:['index.html'],cacheControl:false})
    await app.listen({host:'127.0.0.1',port:0})
    appUrl='http://127.0.0.1:'+app.server.address().port
  } catch(error) { await app.close();db.close();throw error }
  async function api(sessionId,method,path,payload) {
    const frame=makeFrame(sessionId,appUrl,true)
    try {
      const res=await app.inject({method,url:'/view/'+frame.key+path,payload})
      if(res.statusCode>=400) throw new Error(res.json().error || '资料操作失败')
      return res.statusCode===204?{removed:true}:res.json()
    } finally {disposeFrame(frame)}
  }
  function active(id) {
    const preview=previews.active(id)
    if(preview) return preview
    const frame=sessions.get(id)?.active
    return frame && Date.now()-frame.lastSeen<65000 ? frame : undefined
  }
  function collaboration(id) {
    const frame=active(id)
    const owner=frame?.sessionId ?? id
    const shared=owner!==id
    const editors=session(owner).editors.list().filter(editor=>!shared || (editor.active!==false && editor.id===frame.previewId))
    return {owner,shared,editors}
  }
  const runtime={db,repository,session,office,api,change,active,collaboration,dataDir,appUrl,previews,taskFiles,
    async picker(request) {
      if (!option(config,'composerPicker')) return Response.json({error:'资料库对话组件已关闭'},{status:403})
      const params=new URL(request.url).searchParams, id=params.get('file')
      if (id!==null) {
        if (!z.string().uuid().safeParse(id).success || repository.find(id)?.kind!=='local_file')
          return Response.json({error:'请选择资料库中的本地文件'},{status:404})
        const frame=makeFrame('attachment-picker',appUrl,true)
        try {
          return await fetch(new URL('/view/'+frame.key+'/api/library/items/'+id+'/attachment',appUrl),{signal:request.signal})
        } finally {disposeFrame(frame)}
      }
      const query=(params.get('q') || '').trim().slice(0,256)
      const parent=params.get('parent') || null
      const offset=z.coerce.number().int().nonnegative().safeParse(params.get('offset') || 0)
      if (!offset.success || (parent && !z.string().uuid().safeParse(parent).success)) return Response.json({error:'资料库位置无效'},{status:400})
      if (parent && !query && !offset.data && params.get('refresh')==='1' && repository.find(parent)?.kind==='local_folder') {
        const status='/api/library/items/'+parent+'/index-status'
        let job=await api('attachment-picker','GET',status)
        while (job.status==='queued' || job.status==='indexing') {
          if (request.signal.aborted || !option(config,'composerPicker')) return Response.json({error:'选择已取消'},{status:409})
          await new Promise(resolve=>setTimeout(resolve,120))
          job=await api('attachment-picker','GET',status)
        }
        if (job.status==='error') return Response.json({error:job.error || '本地文件夹无法读取'},{status:400})
      }
      const where=query ? "instr(lower(name),lower(?)) OR instr(lower(target),lower(?)) OR instr(lower(tags_json),lower(?))" : 'parent_id IS ?'
      const rows=db.prepare(`SELECT id,name,kind,target FROM resource_library_items
        WHERE kind IN ('local_file','local_folder','folder') AND (${where})
        ORDER BY (kind='local_file'),name COLLATE NOCASE,id LIMIT 61 OFFSET ?`).all(...(query?[query,query,query]:[parent]),offset.data)
      const ancestors=[]
      if (parent && !query && !offset.data) {
        const lookup=db.prepare("SELECT id,name,parent_id FROM resource_library_items WHERE id=? AND kind IN ('folder','local_folder')")
        const visited=new Set()
        for(let id=parent;id && !visited.has(id);) {
          const current=lookup.get(id)
          if(!current)break
          ancestors.unshift({id:current.id,name:current.name});visited.add(id);id=current.parent_id
        }
      }
      return Response.json({items:rows.slice(0,60),more:rows.length>60,ancestors},{headers:{'cache-control':'no-store'}})
    },
    openFrame(id,origin,documentId) {
      if(typeof id!=='string'||!id.trim()||id.length>240||!localParent(origin)) throw new Error('无效的 DSH 会话或来源')
      const frame=makeFrame(id,origin)
      if(documentId) {
        if(!z.string().uuid().safeParse(documentId).success || id!==documentOwner(documentId)) {disposeFrame(frame);throw new Error('无效的文件预览')}
        frame.documentId=documentId
      }
      return {url:appUrl+'/view/'+frame.key+'/index.html',version:pluginVersion,previewMode:option(config,'previewMode'),nativeFileDrag:Boolean(fileTransfer)}
    },
    async close(){
      clearInterval(sweeper)
      taskFiles.close()
      fileTransfer?.close()
      await previews.close()
      for(const s of sessions.values()) s.editors.close()
      await app.close()
      for(const s of sessions.values()) if(s.office) await (await s.office).close()
      db.close()
    }}
  const sweeper=setInterval(()=>{for(const frame of frames.values())if(!frame.internal && Date.now()-frame.lastSeen>86400000)disposeFrame(frame)},60000)
  sweeper.unref()
  return runtime
}

export const inject=['tools','webServer','connection','systemPrompt','approval','attachments']
export async function apply(ctx,config={}) {
  const origin=ctx.webServer.protocol+'//127.0.0.1:'+ctx.webServer.port
  const chatHost=ctx.connection && {origin,launch:()=>ctx.connection.authenticatedUrl(origin)}
  const runtime=await createRuntime({...config,chatHost})
  ctx.effect(()=>()=>runtime.close(),'moki-library: store')
  listenForTaskFiles(ctx,runtime.taskFiles)
  ctx.inject(['settings'],child=>child.effect(()=>child.settings.configure({auto:false},ctx.fiber)))
  ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/moki-library/attachments',resource:async request=>{
    if (request.method!=='GET' || request.headers.get('x-moki-library')!=='1' || request.headers.get('sec-fetch-site')==='cross-site')
      return new Response('Forbidden',{status:403})
    if (new URL(request.url).protocol!=='dsh-app:' && ctx.connection?.requestRejection(request)) return new Response('Forbidden',{status:403})
    return runtime.picker(request)
  }}),'moki-library: conversation attachments')
  ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/moki-library/preview-chat',resource:async request=>{
    const key=request.headers.get('x-moki-preview-chat')
    if(request.method!=='GET'||!key||request.headers.get('sec-fetch-site')!=='same-origin')return new Response('Forbidden',{status:403})
    const rejection=ctx.connection.requestRejection(request)
    if(rejection)return new Response('Forbidden',{status:rejection})
    try {
      const session=z.string().min(1).max(240).nullable().parse(request.headers.get('x-moki-chat-session'))
      return Response.json(runtime.previews.chatInfo(key,session),{headers:{'cache-control':'no-store'}})
    } catch {return Response.json({error:'当前预览对话已关闭，请重新唤起'},{status:404})}
  }}),'moki-library: preview chat')
  ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/moki-library/open',resource:async request=>{
    const u=new URL(request.url)
    if(request.headers.get('x-moki-library')!=='1' || request.headers.get('sec-fetch-site')==='cross-site') return new Response('Forbidden',{status:403})
    try { return Response.json(runtime.openFrame(u.searchParams.get('session'),u.searchParams.get('parent'),u.searchParams.get('document')),{headers:{'cache-control':'no-store'}}) }
    catch(error){return Response.json({error:error.message},{status:400})}
  }}),'moki-library: panel')
  ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/moki-library/windows',resource:async request=>{
    const command=request.headers.get('x-moki-window-request')
    if(request.method!=='GET'||!command||request.headers.get('x-moki-library')!=='1'||request.headers.get('sec-fetch-site')==='cross-site') return new Response('Forbidden',{status:403})
    try {
      const data=windowRequest.parse(JSON.parse(decodeURIComponent(command))), service=runtime.previews
      if(data.action==='open') return Response.json(await service.open(data))
      if(data.action==='dock-open') return Response.json({moving:await service.dockOpen(data.client,data.id,data.destination)})
      if(data.action==='poll') return Response.json(service.poll(data.client),{headers:{'cache-control':'no-store'}})
      if(data.action==='appearance'){await service.appearance(data.client,data.appearance);return Response.json({ok:true})}
      if(data.action==='bind') service.bind(data.client,data.id,data.chatId)
      else service.ack(data.client,data.key,data.error)
      return Response.json({ok:true})
    } catch(error){return Response.json({error:error.message},{status:400})}
  }}),'moki-library: preview windows')
  for(const tool of libraryTools(runtime)) {
    ctx.effect(()=>ctx.tools.register({name:tool.name,description:tool.description,parameters:tool.parameters,
      presentCall:()=>({card:'generic',title:tool.title,kind:tool.kind}),
      output:{schema:{type:'object'},render:(_args,value)=>{const {images,...body}=value;return [{type:'text',text:JSON.stringify(body)},...(images||[]).map(attachment=>({type:'image',attachment}))]}},
      execute:async(args,exec)=>{
        const id=sessionIdOf(exec.agent)
        if(!id)throw new Error('请在 DSH 对话中调用资料库工具')
        return tool.invoke(args,id,async reason=>{
          const result=await ctx.approval.request({agent:exec.agent,toolName:tool.name,callId:exec.callId,reason,signal:exec.signal})
          if(result!=='allowed-once')throw new Error('DSH 未授权此次写入：'+result)
        },inputs=>ctx.attachments.saveImages(inputs))
      }
    }),'moki-library: '+tool.name)
  }
  ctx.effect(()=>ctx.systemPrompt.section({name:'moki-library',order:905,interpolate:false,text:guidance}),'moki-library: guidance')
  ctx.effect(()=>ctx.systemPrompt.context({name:'moki-library-selection',order:905,interpolate:false,text:({scope})=>{
    const frame=runtime.active(sessionIdOf(scope))
    return frame?'当前对话已连接 MOKI资料库。当前选区标签（资料数据）：'+JSON.stringify(frame.selection?.label ?? '')+'。用户要求修改当前文件、此处或所选内容时，先用 moki_library_context 读取精确的选区与活动草稿。':''
  }}),'moki-library: selection')
}

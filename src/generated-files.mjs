import {z} from 'zod'
import {basename} from 'node:path'
const coordinate=z.number().int().nonnegative()
export const generatedFileRequest=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('present'),sessionId:z.string().min(1).max(240),seq:coordinate,index:coordinate}),
  z.object({kind:z.literal('change'),sessionId:z.string().min(1).max(240),seq:coordinate,index:coordinate}),
  z.object({kind:z.literal('path'),sessionId:z.string().min(1).max(240),path:z.string().min(1).max(4096)})
])
const parentId=z.string().uuid().nullable()
const folderRequest=z.discriminatedUnion('action',[
  z.object({action:z.literal('folders'),parentId,query:z.string().max(256).default(''),offset:coordinate.default(0)}),
  z.object({action:z.literal('create-folder'),parentId,name:z.string().trim().min(1).max(240),folderColor:z.enum(['violet','blue','green','amber','rose','slate']).default('violet')}),
  z.object({action:z.literal('prepare'),file:generatedFileRequest}),
  z.object({action:z.literal('add'),file:generatedFileRequest,parentId})
])
export async function generatedFileAction(ctx,runtime,input,signal) {
  if(!input.action){const path=await resolveGeneratedFile(ctx,input,signal);return {item:await runtime.taskFiles.open(path)}}
  const data=folderRequest.parse(input)
  if(data.action==='prepare' || data.action==='add') {
    const path=await resolveGeneratedFile(ctx,data.file,signal)
    return data.action==='prepare'?{name:basename(path),path}:runtime.taskFiles.add(path,data.parentId)
  }
  const {repository,db}=runtime
  const parent=data.parentId&&repository.find(data.parentId)
  if(data.parentId && !['folder','local_folder'].includes(parent?.kind))throw Error('目标文件夹已不存在，请重新选择')
  if(data.action==='create-folder') {
    if(repository.list({parentId:data.parentId,thumbnails:'omit'}).some(item=>['folder','local_folder'].includes(item.kind)&&item.name.toLocaleLowerCase()===data.name.toLocaleLowerCase()))throw Error('此位置已存在同名文件夹')
    const item=repository.create({kind:'folder',parentId:data.parentId,name:data.name,folderColor:data.folderColor,tags:[]})
    runtime.change(data.parentId);return {item}
  }
  if(parent?.kind==='local_folder' && !data.query && !data.offset) {
    const status='/api/library/items/'+parent.id+'/index-status'
    let job=await runtime.api('generated-file-picker','GET',status)
    while(job.status==='queued'||job.status==='indexing') {
      signal?.throwIfAborted();await new Promise(resolve=>setTimeout(resolve,120))
      job=await runtime.api('generated-file-picker','GET',status)
    }
    if(job.status==='error')throw Error(job.error||'本地文件夹无法读取')
  }
  signal?.throwIfAborted()
  const query=data.query.trim(),where=query?'instr(lower(name),lower(?))':'parent_id IS ?'
  const items=db.prepare(`SELECT id,name,kind,parent_id AS parentId,folder_color AS folderColor FROM resource_library_items WHERE kind IN ('folder','local_folder') AND (${where}) ORDER BY name COLLATE NOCASE,id LIMIT 61 OFFSET ?`).all(query||data.parentId,data.offset)
  const ancestors=[],visited=new Set()
  for(let folder=parent;folder&&!visited.has(folder.id);folder=folder.parentId&&repository.find(folder.parentId)) {
    ancestors.unshift({id:folder.id,name:folder.name,folderColor:folder.folderColor});visited.add(folder.id)
  }
  return {items:items.slice(0,60),more:items.length>60,ancestors}
}
export async function resolveGeneratedFile(ctx,input,signal) {
  const data=generatedFileRequest.parse(input)
  let path,root
  if(data.kind==='present') {
    const {target,session}=await ctx.sessionQuery.readEvent({sessionId:data.sessionId,seq:data.seq,before:0,after:0},signal)
    path=target.type==='deliverables/presented'&&target.data.files?.[data.index]?.path
    root=session.cwd??ctx.sandboxPolicy.workspaceRoot
  }else if(data.kind==='change') {
    const summary=ctx.workspaceChanges.summary(data.sessionId,data.seq)
    path=summary?.files[data.index]?.path;root=summary?.cwd
  }else {path=data.path;root=ctx.sandboxPolicy.workspaceRoot}
  if(typeof path!=='string'||!path)throw Error('文件已不可用，请重新生成或选择文件')
  const info=await ctx.workspaceFiles.stat({sessionId:data.sessionId,workspaceRoot:root},path,signal)
  const mapped=ctx.fs.processPathFromHostPath(info.absolutePath)
  if(mapped===undefined || ctx.fs.processPath(await ctx.fs.resolve(mapped,{signal}))!==info.absolutePath)throw Error('文件不在本机可访问的位置')
  signal?.throwIfAborted();return info.absolutePath
}
export function registerGeneratedFiles(ctx,runtime) {
  ctx.inject(['sessionQuery','workspaceFiles','workspaceChanges','sandboxPolicy','fs'],child=>{
    child.effect(()=>child.webServer.register({kind:'exact',path:'/moki-library/generated-file',resource:async request=>{
      if(request.method!=='GET'||request.headers.get('x-moki-library')!=='1'||request.headers.get('sec-fetch-site')==='cross-site')return new Response('Forbidden',{status:403})
      if(new URL(request.url).protocol!=='dsh-app:' && child.connection.requestRejection(request))return new Response('Forbidden',{status:403})
      try {
        const input=JSON.parse(decodeURIComponent(request.headers.get('x-moki-generated-file')||''))
        return Response.json(await generatedFileAction(child,runtime,input,request.signal),{headers:{'cache-control':'no-store'}})
      }catch(error){return Response.json({error:error.message},{status:400})}
    }}),'moki-library: generated file opening')
  })
}

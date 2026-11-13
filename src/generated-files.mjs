import {z} from 'zod'
const coordinate=z.number().int().nonnegative()
export const generatedFileRequest=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('present'),sessionId:z.string().min(1).max(240),seq:coordinate,index:coordinate}),
  z.object({kind:z.literal('change'),sessionId:z.string().min(1).max(240),seq:coordinate,index:coordinate}),
  z.object({kind:z.literal('path'),sessionId:z.string().min(1).max(240),path:z.string().min(1).max(4096)})
])
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
        const path=await resolveGeneratedFile(child,input,request.signal)
        return Response.json({item:await runtime.taskFiles.open(path)},{headers:{'cache-control':'no-store'}})
      }catch(error){return Response.json({error:error.message},{status:400})}
    }}),'moki-library: generated file opening')
  })
}

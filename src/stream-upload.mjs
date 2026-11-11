import {randomUUID} from 'node:crypto'
import {createWriteStream} from 'node:fs'
import {lstat,mkdir,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {Transform} from 'node:stream'
import {pipeline} from 'node:stream/promises'

export function registerStreamUpload(app,repository,stateDirectory){
  // Return the request stream directly. Fastify must not buffer it into a string
  // or Buffer; the byte count is checked while copying to an exclusively owned file.
  app.addContentTypeParser('application/octet-stream',(req,stream,done)=>done(null,stream))
  app.post('/api/library/workspace-files/stream',async(req,reply)=>{
    if(req.headers['x-moki-library-upload']!=='1')return reply.code(403).send({error:'文件导入仅接受资料库请求'})
    const name=String(req.query.name||''),size=Number(req.query.size),parentId=req.query.parentId||null
    if(!name||name.length>240||/[<>:"/\\|?*\u0000-\u001f]/u.test(name)||/[. ]$/u.test(name)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(name)
      ||!Number.isSafeInteger(size)||size<0)return reply.code(400).send({error:'文件名或文件长度无效'})
    const parent=parentId?repository.find(parentId):null
    if(parentId&&(!parent||!['folder','local_folder'].includes(parent.kind)))return reply.code(400).send({error:'目标文件夹不存在'})
    if(!req.body?.pipe)return reply.code(400).send({error:'文件数据无效'})
    const managed=parent?.kind!=='local_folder',directory=managed?join(stateDirectory,'resource-library-files',randomUUID()):parent.target
    let created=false,target
    try{
      if(managed)await mkdir(directory,{recursive:true});else{const folder=await lstat(directory);if(!folder.isDirectory()||folder.isSymbolicLink())throw Error('目标文件夹不可用')}
      target=join(directory,name);let copied=0
      const writer=createWriteStream(target,{flags:'wx'});writer.once('open',()=>{created=true})
      await pipeline(req.body,new Transform({transform(chunk,encoding,callback){copied+=chunk.length;callback(copied>size?Error('文件长度与声明不符'):null,chunk)}}),writer)
      if(copied!==size)throw Error('文件传输不完整')
      const item=repository.create({kind:'local_file',name,target,parentId,tags:[]})
      return reply.code(201).send(item)
    }catch(error){
      if(created)await rm(target,{force:true}).catch(()=>{})
      if(managed)await rm(directory,{recursive:true,force:true}).catch(()=>{})
      return reply.code(error.code==='ENOSPC'?507:400).send({error:error.code==='EEXIST'?'同名文件已存在，原文件未被覆盖':error.code==='ENOSPC'?'磁盘空间不足，未完成的文件已移除':error.message})
    }
  })
}

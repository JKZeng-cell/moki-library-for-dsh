import {open,stat,realpath} from 'node:fs/promises'
import {createReadStream} from 'node:fs'
import {dirname,extname,resolve,relative,isAbsolute} from 'node:path'
import {Worker} from 'node:worker_threads'
import {spawn} from 'node:child_process'
import {zipDirectory,rarDirectory,otherArchiveDirectory} from './preview-archive.mjs'

const images=new Set('png jpg jpeg jpe jfif gif webp svg bmp avif ico'.split(' '))
const converted=new Set('psd psb tga tif tiff heic heif'.split(' '))
const textTypes=new Set('txt md markdown log json jsonl ndjson html htm xml yaml yml js jsx mjs cjs ts tsx css scss less py java c cpp h hpp cs go rs sql sh ps1 bat cmd ini conf cfg toml env srt vtt ass ssa lrc po properties url'.split(' '))
const archives=new Set('zip zipx rar 7z tar gz tgz bz2 xz cab ccx mokiapp moki-data'.split(' '))
const fonts=new Set('ttf otf woff woff2'.split(' '))
const models=new Set('glb gltf obj stl ply fbx'.split(' '))
const mime={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',svg:'image/svg+xml',bmp:'image/bmp',avif:'image/avif',ico:'image/x-icon',pdf:'application/pdf',mp4:'video/mp4',mov:'video/quicktime',m4v:'video/mp4',mkv:'video/x-matroska',webm:'video/webm',ogv:'video/ogg',mp3:'audio/mpeg',wav:'audio/wav',flac:'audio/flac',m4a:'audio/mp4',aac:'audio/aac',ogg:'audio/ogg',opus:'audio/ogg',ttf:'font/ttf',otf:'font/otf',woff:'font/woff',woff2:'font/woff2',glb:'model/gltf-binary',gltf:'model/gltf+json'}
const factCache=new Map()
export async function inspectPreviewFile(path){
  const info=await stat(path);if(!info.isFile())throw Error('映射目标不是文件')
  const key=path+'|'+info.size+'|'+info.mtimeMs,cached=factCache.get(key);if(cached)return cached
  const file=await open(path,'r'),buffer=Buffer.alloc(Math.min(4096,info.size));let header
  try{const result=await file.read(buffer,0,buffer.length,0);header=buffer.subarray(0,result.bytesRead)}finally{await file.close()}
  let extension=extname(path).slice(1).toLowerCase(),detected=false
  const initialExtension=extension,ascii=header.toString('latin1'),hex=header.toString('hex')
  // Signatures override absent/misleading suffixes, but never execute downloaded content.
  if(ascii.startsWith('%PDF-'))extension='pdf'
  else if(hex.startsWith('89504e470d0a1a0a'))extension='png'
  else if(hex.startsWith('ffd8ff'))extension='jpg'
  else if(/^GIF8[79]a/.test(ascii))extension='gif'
  else if(ascii.startsWith('RIFF')&&ascii.slice(8,12)==='WEBP')extension='webp'
  else if(!extension&&ascii.startsWith('PK\x03\x04'))extension='zip'
  else if(!extension&&ascii.startsWith('8BPS'))extension='psd'
  else if(!extension&&header.length&&!header.includes(0)&&!ascii.startsWith('MZ')){
    try{new TextDecoder('utf-8',{fatal:true}).decode(header.subarray(0,Math.max(0,header.length-4)),{stream:true});extension='txt'}catch{}
  }
  detected=initialExtension!==extension
  let kind='unsupported'
  if(images.has(extension)||converted.has(extension))kind='image'
  else if(['mp4','webm','m4v','mov','ogv','mkv','avi'].includes(extension))kind='video'
  else if(['mp3','wav','flac','aac','m4a','ogg','opus'].includes(extension))kind='audio'
  else if(extension==='pdf')kind='embedded'
  else if(fonts.has(extension))kind='font'
  else if(models.has(extension))kind='model'
  else if(archives.has(extension))kind='archive'
  else if(extension==='ofd')kind='ofd'
  else if(['moki','moki-board'].includes(extension))kind='moki'
  else if(textTypes.has(extension))kind='text'
  const value={extension,originalExtension:initialExtension,detected,size:info.size,modified:info.mtime.toISOString(),mime:mime[extension]||'application/octet-stream',kind,converted:converted.has(extension),textPaged:kind==='text'&&(info.size>5_000_000 || !['txt','md','markdown','log','json','html','htm','xml','yaml','yml','js','jsx','ts','tsx','css','scss','less','py','java','c','cpp','h','hpp','cs','go','rs','sql','sh','ps1'].includes(extension)||detected)}
  if(factCache.size>256)factCache.delete(factCache.keys().next().value);factCache.set(key,value);return value
}

export function byteRange(value,size){
  if(!value)return null
  const m=/^bytes=(\d*)-(\d*)$/.exec(value)
  if(!m||(!m[1]&&!m[2])||!size)return false
  let start=m[1]?Number(m[1]):Math.max(0,size-Number(m[2])),end=m[1]?(m[2]?Number(m[2]):size-1):size-1
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=size||end<start||(!m[1]&&Number(m[2])===0))return false
  return {start,end:Math.min(end,size-1)}
}

export async function textPage(path,offset=0){
  const file=await open(path,'r')
  try{
    const {size}=await file.stat(),first=Buffer.alloc(4096);const head=await file.read(first,0,first.length,0)
    const header=first.subarray(0,head.bytesRead)
    let encoding=header[0]===255&&header[1]===254?'utf-16le':header[0]===254&&header[1]===255?'utf-16be':'utf-8'
    if(encoding==='utf-8'){try{new TextDecoder('utf-8',{fatal:true}).decode(header,{stream:true})}catch{encoding='gb18030'}}
    if(encoding.startsWith('utf-16'))offset-=offset%2
    const bytes=Buffer.alloc(Math.min(256*1024,Math.max(0,size-offset))),result=await file.read(bytes,0,bytes.length,offset)
    let end=result.bytesRead
    // Do not split a multibyte character across pages. Each page is independently decoded.
    if(offset+end<size&&encoding==='utf-8'){
      let start=end-1;while(start>=0&&(bytes[start]&192)===128)start--
      const lead=bytes[start],length=lead>=240?4:lead>=224?3:lead>=192?2:1
      if(start+length>end)end=start
    }else if(offset+end<size&&encoding==='gb18030'){
      let i=0;while(i<end){const n=bytes[i]<128?1:bytes[i+1]>=48&&bytes[i+1]<=57?4:2;if(i+n>end){end=i;break}i+=n}
    }else if(offset+end<size&&encoding.startsWith('utf-16')&&end>=2){const last=encoding==='utf-16le'?bytes.readUInt16LE(end-2):bytes.readUInt16BE(end-2);if(last>=0xd800&&last<=0xdbff)end-=2}
    return {text:new TextDecoder(encoding).decode(bytes.subarray(0,end)),encoding,offset,next:offset+end<size?offset+end:null,size}
  }finally{await file.close()}
}

const imageCache=new Map(),pendingImages=new Map();let imageBytes=0,running=0;const waiting=[]
export async function imagePreview(path,width){
  const facts=await inspectPreviewFile(path),key=path+'|'+facts.size+'|'+facts.modified+'|'+width
  if(imageCache.has(key))return imageCache.get(key)
  if(pendingImages.has(key))return pendingImages.get(key)
  if(waiting.length>=16)throw Error('正在生成预览，请稍后再试')
  const job=(async()=>{
    if(running>=2)await new Promise(resolve=>waiting.push(resolve));running++
    try{
      const data=await new Promise((resolve,reject)=>{
        const worker=new Worker(new URL('./preview-image-worker.mjs',import.meta.url),{execArgv:[],workerData:{path,extension:facts.extension,width}})
        const timer=setTimeout(()=>{void worker.terminate();reject(Error('图像解码超时，请使用默认应用打开'))},45000)
        worker.once('message',result=>{clearTimeout(timer);void worker.terminate();result.error?reject(Error(result.error)):resolve(Buffer.from(result.data))})
        worker.once('error',error=>{clearTimeout(timer);reject(error)})
        worker.once('exit',code=>{clearTimeout(timer);if(code!==0)reject(Error('图像解码器已停止'))})
      })
      imageCache.set(key,data);imageBytes+=data.length
      while(imageCache.size>48||imageBytes>32*1024*1024){const k=imageCache.keys().next().value;imageBytes-=imageCache.get(k).length;imageCache.delete(k)}
      return data
    }finally{running--;waiting.shift()?.();pendingImages.delete(key)}
  })();pendingImages.set(key,job);return job
}

export function registerPreviewFiles(app,repository){
  let mediaJobs=0
  const route=(suffix,handler)=>app.get('/api/library/items/:id/'+suffix,async(req,reply)=>{
    const item=repository.find(req.params.id)
    if(!item?.target||item.kind!=='local_file')return reply.code(404).send({error:'本地文件不存在'})
    try{return await handler(item,req,reply)}catch(error){return reply.code(422).type('application/json').send({error:error.message||'无法读取文件预览'})}
  })
  route('preview-info',item=>inspectPreviewFile(item.target))
  route('preview-media',async(item,req,reply)=>{
    const info=await inspectPreviewFile(item.target);if(!['video','audio'].includes(info.kind))throw Error('此文件不是音视频')
    if(mediaJobs>=2)throw Error('已有两个兼容播放任务，请关闭其他播放后重试')
    mediaJobs++
    const child=spawn('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-protocol_whitelist','file,pipe,crypto','-i',item.target,
      '-map','0:v:0?','-map','0:a:0?','-sn','-dn','-vf',"scale=w='min(1920,iw)':h=-2",'-c:v','libx264','-preset','veryfast','-threads','2','-crf','23','-pix_fmt','yuv420p',
      '-c:a','aac','-b:a','160k','-movflags','frag_keyframe+empty_moov+default_base_moof','-f','mp4','pipe:1'],{windowsHide:true,stdio:['ignore','pipe','pipe']})
    let ended=false;const stop=()=>{if(ended)return;ended=true;clearTimeout(timeout);mediaJobs--;child.kill()}
    const timeout=setTimeout(()=>{child.stdout.destroy(Error('兼容播放启动超时'));stop()},30000)
    child.stdout.once('data',()=>clearTimeout(timeout));child.stderr.resume()
    child.once('error',()=>{clearTimeout(timeout);child.stdout.destroy(Error('本机未找到 FFmpeg，请使用默认应用播放此编码'));stop()})
    child.once('exit',code=>{clearTimeout(timeout);if(code&&!ended)child.stdout.destroy(Error('此媒体无法转换为浏览器兼容编码'));stop()})
    reply.raw.once('close',stop)
    return reply.type('video/mp4').header('cache-control','no-store').send(child.stdout)
  })
  route('preview-asset',async(item,req,reply)=>{
    const info=await inspectPreviewFile(item.target);if(info.kind!=='model')throw Error('此文件没有模型附属资源')
    const part=String(req.query.path||'');if(!part||part.includes('\0')||isAbsolute(part)||part.includes(':')||part.includes('?'))throw Error('模型资源路径无效')
    const root=await realpath(dirname(item.target)),path=await realpath(resolve(root,part)),rel=relative(root,path)
    if(rel==='..'||rel.startsWith('..\\')||rel.startsWith('../')||isAbsolute(rel))throw Error('模型资源必须位于模型所在文件夹内')
    const ext=extname(path).slice(1).toLowerCase();if(!['bin','png','jpg','jpeg','webp','gif','bmp','ktx2','dds','tga'].includes(ext))throw Error('此模型附属资源格式不支持')
    const file=await stat(path);if(!file.isFile())throw Error('模型资源不是文件')
    return reply.type(mime[ext]||'application/octet-stream').header('content-length',file.size).send(createReadStream(path))
  })
  route('preview-image',async(item,req,reply)=>{
    const info=await inspectPreviewFile(item.target);if(info.kind!=='image')throw Error('此文件不是图片')
    const width=req.query.size==='hover'?640:2560
    const etag='"'+info.size+'-'+Date.parse(info.modified)+'-'+width+'"'
    reply.header('etag',etag).header('cache-control','private, max-age=0, must-revalidate')
    if(req.headers['if-none-match']===etag)return reply.code(304).send()
    return reply.type('image/webp').send(await imagePreview(item.target,width))
  })
  route('preview-text',async(item,req)=>{
    const facts=await inspectPreviewFile(item.target);if(!['text','moki'].includes(facts.kind))throw Error('此文件不是文本')
    const offset=Number(req.query.offset||0);if(!Number.isSafeInteger(offset)||offset<0)throw Error('读取位置无效')
    return textPage(item.target,offset)
  })
  route('preview-archive',async(item,req)=>{
    const info=await inspectPreviewFile(item.target);if(info.kind!=='archive')throw Error('此文件不是压缩包')
    const offset=Number(req.query.offset||0);if(!Number.isSafeInteger(offset)||offset<0)throw Error('目录位置无效')
    const opts={offset,query:String(req.query.q||'').slice(0,200)}
    if(['zip','zipx','ccx','mokiapp'].includes(info.extension))return zipDirectory(item.target,opts)
    if(info.extension==='rar')return rarDirectory(item.target,opts)
    return otherArchiveDirectory(item.target,opts)
  })
}

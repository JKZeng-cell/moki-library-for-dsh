import yauzl from 'yauzl'
import {open} from 'node:fs/promises'
import {spawn} from 'node:child_process'
import sevenZip from '7zip-bin'

export const openZip=path=>new Promise((resolve,reject)=>yauzl.open(path,{lazyEntries:true,autoClose:false},(error,zip)=>error?reject(error):resolve(zip)))

// Only inflate the requested document parts, never embedded Office media or the
// entire archive. ZIP64 offsets remain file offsets rather than buffer indices.
export async function readZipParts(path,include,maxBytes=256*1024*1024){
  const zip=await openZip(path),parts=Object.create(null)
  let total=0
  try{return await new Promise((resolve,reject)=>{
    zip.on('error',reject);zip.on('end',()=>resolve(parts))
    zip.on('entry',entry=>{
      if(!include(entry.fileName) || entry.fileName.endsWith('/'))return zip.readEntry()
      if(entry.isEncrypted())return reject(Error('文件内容已加密，请使用默认应用打开'))
      if(total+entry.uncompressedSize>maxBytes)return reject(Error('文档展开后的数据过大，请使用默认应用打开完整内容'))
      zip.openReadStream(entry,(error,stream)=>{
        if(error)return reject(error)
        const chunks=[];let size=0
        stream.on('data',chunk=>{size+=chunk.length;if(total+size>maxBytes)stream.destroy(Error('文档展开后的数据过大'));else chunks.push(chunk)})
        stream.on('error',reject);stream.on('end',()=>{total+=size;parts[entry.fileName]=Buffer.concat(chunks,size);zip.readEntry()})
      })
    });zip.readEntry()
  })}finally{zip.close()}
}

export async function zipDirectory(path,{offset=0,query='',limit=200}={}){
  const zip=await openZip(path),entries=[];let matches=0
  try{return await new Promise((resolve,reject)=>{
    const done=more=>resolve({entries,offset,next:more?offset+entries.length:null,total:zip.entryCount,filtered:!!query})
    zip.on('error',reject);zip.on('end',()=>done(false))
    zip.on('entry',e=>{
      if(!query || e.fileName.toLocaleLowerCase().includes(query.toLocaleLowerCase())){
        if(matches++>=offset){
          if(entries.length===limit)return done(true)
          entries.push({name:e.fileName,size:e.uncompressedSize,packed:e.compressedSize,directory:e.fileName.endsWith('/'),encrypted:e.isEncrypted()})
        }
      }
      zip.readEntry()
    });zip.readEntry()
  })}finally{zip.close()}
}

// RAR5 headers are seekable; compressed payloads are skipped without decoding.
// Specification: https://www.rarlab.com/technote.htm . No extraction or execution.
export async function rarDirectory(path,{offset=0,query='',limit=200}={}){
  const file=await open(path,'r'),entries=[];let matched=0,total=0,position=8
  const read=async(position,size)=>{const b=Buffer.alloc(size);const {bytesRead}=await file.read(b,0,size,position);return b.subarray(0,bytesRead)}
  try{
    const stat=await file.stat(),signature=await read(0,8)
    if(!signature.equals(Buffer.from('526172211a070100','hex')))throw Error('当前支持 RAR5 目录预览；此 RAR 请使用默认应用打开')
    while(position<stat.size){
      const prefix=await read(position,16);let at=4,b=prefix
      const vint=()=>{let value=0,multiplier=1;for(let i=0;i<8;i++){
        if(at>=b.length)throw Error('RAR 目录不完整');const n=b[at++];value+=(n&127)*multiplier
        if(!Number.isSafeInteger(value))throw Error('RAR 偏移量超出支持范围');if(!(n&128))return value;multiplier*=128
      }throw Error('RAR 目录字段无效')}
      const length=vint(),start=at
      if(length<2 || length>2*1024*1024 || position+start+length>stat.size)throw Error('RAR 目录不完整')
      b=await read(position,start+length)
      const type=vint(),flags=vint();if(flags&1)vint();const packed=flags&2?vint():0
      if(type===4)throw Error('RAR 目录已加密，请使用默认应用输入密码')
      if(type===5)break
      if(type===2){
        const fileFlags=vint(),size=vint();vint();if(fileFlags&2)at+=4;if(fileFlags&4)at+=4;vint();vint()
        const nameLength=vint();if(at+nameLength>b.length)throw Error('RAR 文件名不完整')
        const name=b.toString('utf8',at,at+nameLength);total++
        if(!query || name.toLocaleLowerCase().includes(query.toLocaleLowerCase())){
          if(matched++>=offset){if(entries.length===limit)return {entries,offset,next:offset+entries.length,total:null}
            entries.push({name,size:fileFlags&8?null:size,packed,directory:!!(fileFlags&1)})}
        }
      }
      const next=position+start+length+packed
      if(!Number.isSafeInteger(next)||next<=position||next>stat.size)throw Error('RAR 数据区不完整')
      position=next
    }
    return {entries,offset,next:null,total}
  }finally{await file.close()}
}

export function otherArchiveDirectory(path,{offset=0,query='',limit=200}={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(sevenZip.path7za,['l','-slt','-ba','-sccUTF-8','--',path],{windowsHide:true,stdio:['ignore','pipe','pipe']})
    let buffer='',record={},total=0,matched=0,done=false,bytes=0;const entries=[]
    const finish=(error,more=false)=>{if(done)return;done=true;clearTimeout(timer);child.kill();error?reject(error):resolve({entries,offset,next:more?offset+entries.length:null,total:more?null:total})}
    const timer=setTimeout(()=>finish(Error('压缩包目录读取超时，请使用默认应用打开')),30000)
    const flush=()=>{if(!record.Path)return;const name=record.Path;total++
      if(!query||name.toLocaleLowerCase().includes(query.toLocaleLowerCase())){if(matched++>=offset){
        if(entries.length===limit)return finish(null,true)
        entries.push({name,size:Number(record.Size)||0,packed:Number(record['Packed Size'])||0,directory:record.Folder==='+'||record.Attributes?.startsWith('D'),encrypted:record.Encrypted==='+'})
      }}record={}}
    child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{
      bytes+=chunk.length;if(bytes>64*1024*1024)return finish(Error('压缩包目录过大，请缩小查询范围或使用默认应用'))
      buffer+=chunk;let i
      while(!done&&(i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i).replace(/\r$/,'');buffer=buffer.slice(i+1);if(!line.trim())flush();else{const p=line.indexOf(' = ');if(p>=0)record[line.slice(0,p)]=line.slice(p+3)}}
    })
    child.stderr.resume();child.on('error',finish);child.on('close',code=>{if(done)return;if(code)finish(Error('压缩包已加密、损坏或格式不支持，请使用默认应用打开'));else{flush();finish(null)}})
  })
}

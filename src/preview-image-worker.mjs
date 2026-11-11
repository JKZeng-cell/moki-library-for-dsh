import {parentPort,workerData} from 'node:worker_threads'
import {readFile,stat} from 'node:fs/promises'
import sharp from 'sharp'
import {readPsd,initializeCanvas} from 'ag-psd'

function tga(bytes){
  const width=bytes.readUInt16LE(12),height=bytes.readUInt16LE(14),bits=bytes[16],type=bytes[2],flags=bytes[17]
  if(bytes[1] || ![2,3,10,11].includes(type)||![8,24,32].includes(bits)||!width||!height||width*height>64*1024*1024)throw Error('此 TGA 编码或分辨率不支持预览')
  const channels=bits/8,data=Buffer.alloc(width*height*4);let cursor=18+bytes[0],pixel=0
  const color=()=>{if(cursor+channels>bytes.length)throw Error('TGA 图像不完整');const p=bytes.subarray(cursor,cursor+=channels);return channels===1?[p[0],p[0],p[0],255]:[p[2],p[1],p[0],channels===4?p[3]:255]}
  const put=c=>{if(pixel>=width*height)throw Error('TGA 像素数量无效');const row=Math.floor(pixel/width),col=pixel%width,y=flags&32?row:height-row-1,x=flags&16?width-col-1:col;data.set(c,(y*width+x)*4);pixel++}
  while(pixel<width*height){if(type<8)put(color());else{if(cursor>=bytes.length)throw Error('TGA 图像不完整');const packet=bytes[cursor++],n=(packet&127)+1;if(packet&128){const c=color();for(let i=0;i<n;i++)put(c)}else for(let i=0;i<n;i++)put(color())}}
  return {data,width,height}
}
try{
  const {path,extension,width}=workerData;let image
  if(['psd','psb','tga'].includes(extension)){
    if((await stat(path)).size>512*1024*1024)throw Error('此设计文件超出解码器内存容量，请使用默认应用打开')
    const bytes=await readFile(path)
    let decoded
    if(extension==='tga')decoded=tga(bytes)
    else{
      const w=bytes.readUInt32BE(18),h=bytes.readUInt32BE(14)
      if(w*h>64*1024*1024)throw Error('此 PSD 分辨率超出解码器容量，请使用默认应用打开')
      initializeCanvas(()=>{throw Error('PSD 没有合并图像')},(width,height)=>({width,height,data:new Uint8ClampedArray(width*height*4)}))
      const psd=readPsd(bytes,{skipLayerImageData:true,skipThumbnail:true,useImageData:true})
      decoded=psd.imageData;if(!decoded)throw Error('PSD 未保存合并图像，请在 Photoshop 中开启最大兼容性后保存')
    }
    image=sharp(decoded.data,{raw:{width:decoded.width,height:decoded.height,channels:4}})
  }else image=sharp(path,{limitInputPixels:268402689,animated:false})
  const data=await image.rotate().resize({width,height:width,fit:'inside',withoutEnlargement:true}).webp({quality:88}).toBuffer()
  parentPort.postMessage({data})
}catch(error){parentPort.postMessage({error:error.message})}

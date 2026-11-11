import {posix} from 'node:path'
import {parse} from 'parse5'
import {inspectPreviewFile,textPage,imagePreview} from './preview-files.mjs'
import {readZipParts,zipDirectory,rarDirectory,otherArchiveDirectory} from './preview-archive.mjs'

const nodes=(root,name)=>{const result=[];function visit(n){if(n.nodeName?.split(':').at(-1)===name)result.push(n);for(const c of n.childNodes||[])visit(c)}visit(root);return result}
const text=n=>(n?.value||'')+(n?.childNodes||[]).map(text).join('')
export async function readOfdText(path,page=1){
  const part=async name=>{const parts=await readZipParts(path,n=>n===name,16*1024*1024);if(!parts[name])throw Error('OFD 页面资源不存在');return parse(Buffer.from(parts[name]).toString('utf8'))}
  const manifest=await part('OFD.xml'),doc=text(nodes(manifest,'docroot')[0]).trim();
  if(!doc)throw Error('OFD 文档路径不存在')
  const document=await part(doc),pages=nodes(document,'page'),entry=pages[page-1];if(!entry)throw Error('OFD 页码超出范围')
  const base=entry.attrs.find(a=>a.name==='baseloc')?.value;
  if(!base)throw Error('OFD 页面路径不存在')
  const body=await part(posix.normalize(posix.join(posix.dirname(doc),base))),content=nodes(body,'textcode').map(text).join('\n');
  return {kind:'ofd',page,totalPages:pages.length,text:content.slice(0,64000),truncated:content.length>64000,readOnly:true,note:'页面文字层；复杂路径、模板和签章以原文件为准。'}
}
export async function readExtraPreview(item,options,images){
  const facts=await inspectPreviewFile(item.target),base={id:item.id,name:item.name,format:facts.extension,size:facts.size,modified:facts.modified,readOnly:true};
  if(options.mode==='metadata')return {...base,...facts}
  if(facts.kind==='image'){
    const data=images?await imagePreview(item.target,1600):undefined;
    return {...base,kind:'image',...(data?{images:await images([{data,mediaType:'image/webp',name:item.name+' 预览'}])}:{}),note:'预览用图像，不改原文件；框选区域通过 moki_library_context 读取。'}
  }
  if(['text','moki'].includes(facts.kind))return {...base,kind:'text',...await textPage(item.target,options.offset)}
  if(facts.kind==='ofd')return {...base,...await readOfdText(item.target,options.page||1)}
  if(facts.kind==='archive'){
    const opts={offset:options.offset,query:options.query||'',limit:100};
    const directory=['zip','zipx','ccx','mokiapp'].includes(facts.extension)?await zipDirectory(item.target,opts):facts.extension==='rar'?await rarDirectory(item.target,opts):await otherArchiveDirectory(item.target,opts);
    return {...base,kind:'archive',...directory,note:'压缩包目录；未解压或修改包内文件。'}
  }
  return {...base,kind:facts.kind,note:'此格式不按文本读取。当前页、时间、区域和预览画面可通过 moki_library_context 获取；原格式编辑需使用支持该格式的应用。'}
}

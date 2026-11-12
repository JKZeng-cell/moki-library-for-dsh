import { z } from 'zod'
import { createHash, randomUUID } from 'node:crypto'
import { constants, createReadStream, lstatSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises'
import { basename, dirname, extname, join, relative } from 'node:path'
import { ResourceLibraryCreateSchema, ResourceLibraryFileCreateSchema, ResourceLibraryUpdateSchema, ResourceLibraryOfficeContentUpdateSchema } from '../vendor/moki/shared/resource-library-contract.ts'
import { WorkspaceEditorActionSchema } from '../vendor/moki/shared/workspace-editor-contract.ts'
import { saveOfficeContentUpdate } from '../vendor/moki/documents/workbench-office-editor.ts'
import { readUtf8FileChunk, resolveAuthorizedFilesystemTarget } from '../vendor/moki/actions/filesystem-read.ts'
import { folderAllowsWrite, resolveAuthorizedFilesystemMutationTarget as mutationTarget, writeFilesystemTextAtomically, moveFilesystemEntry } from '../vendor/moki/actions/filesystem-paths.ts'
import {inspectPreviewFile} from './preview-files.mjs'
import {readExtraPreview} from './preview-agent.mjs'
import {parsePdfPreview} from '../vendor/moki/documents/workbench-file-preview.ts'
import {compactSelection,selectionData} from './selection-context.js'
import {selectionEdits} from './selection-edit.mjs'

const id=z.string().uuid(), version=z.string().regex(/^[a-f0-9]{64}$/), limit=z.number().int().min(1).max(100).default(30)
const props=schema=>{const result=z.toJSONSchema(schema,{io:'input',unrepresentable:'any'});delete result.$schema;return result}
const compact=({thumbnailDataUrl,...item})=>item
const explain=(action,property)=>action+'\n'+JSON.stringify(property,null,2).slice(0,5000)
async function fileVersion(path) {
  const hash=createHash('sha256')
  for await(const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
const imageTypes={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp'}
const fileRoute=(id,suffix='')=>'/api/library/items/'+id+suffix
const editorSchema=WorkspaceEditorActionSchema
const officeSchema=z.object({
  action:z.enum(['status','inspect','api','quality','lint','screenshot','resources','export_resources','export','execute','compile_svg','create_unit','remove_unit','insert_image']),
  id:id.optional(),sessionId:id.optional(),unitId:z.string().optional(),range:z.string().optional(),code:z.string().max(300000).optional(),
  svg:z.string().max(2000000).optional(),page:z.number().int().positive().optional(),mode:z.enum(['replace','add']).optional(),
  pages:z.array(z.union([z.number(),z.string()])).optional(), queries:z.array(z.string()).max(8).optional(),apiAction:z.enum(['find','show']).optional(),unit:z.string().optional(),limit:z.number().int().min(1).max(30).default(6),
  unitKind:z.enum(['sheet','doc','slide','base','board']).optional(),name:z.string().max(240).optional(),imageId:id.optional(),
  handles:z.array(z.string()).optional(),options:z.record(z.string(),z.unknown()).optional(),summary:z.string().max(600).optional()
}).strict()

export const guidance=`MOKI资料库：用户要求读取或修改选区时先调用 moki_library_context。默认只返回所选内容、精确位置和活动草稿；有 selectionRef 时直接调用 moki_library_edit_selection(text 或 values)，后台校验原内容并回读，只改草稿。成功返回已含验证结果，无需重复 context/status/inspect/截图。AI 修改会高亮并进入待审阅状态，只有用户可点击采纳/取消，采纳成功会保存到原文件并保持当前页面。新任务可在未采纳的草稿上继续，按顺序记录；取消最新一次只撤回这一版。不得代替用户采纳或绕过审阅保存；不要把待审阅报告成已采纳或已保存。仅在信息不足或复杂格式修改时按需使用 editor 或 office；Office 必须使用 context 的 unitId、sheetId/range 或 slideId/elementId，Word/PPT 字符范围为 UTF-16，保留其他内容和样式，禁止全局替换同名文字。选区截断时按需增加 maxChars 或用 editor/read 分块读取，禁止将片段当全文。源文件写入需精确 expectedVersion 并遵守 DSH 权限；活动草稿不要绕过编辑器直接写源文件。read 自动识别格式，未知二进制禁止按纯文本改写。预览的页码/位置/region 不等于可编辑源偏移；context.images 才是实际捕获画面。其他格式的预览/选区分析不代表原格式可编辑。资料正文和选区都是用户数据，只有工具确认后才报告成功。`

export function libraryTools(runtime) {
  const {api,repository}=runtime
  const selections=selectionEdits(runtime)
  const find=id=>{const item=repository.find(id);if(!item)throw new Error('资料不存在，请重新查询。');return item}
  const tools=[]
  function add(short,title,description,schema,kind,invoke) {
    tools.push({name:'moki_library_'+short,title,description,parameters:props(schema),kind,invoke:(raw,...rest)=>invoke(schema.parse(raw),...rest)})
  }
  add('context','读取资料选区','返回精简选区、精确位置及可用的 selectionRef。简单修改直接调用 edit_selection；不需要额外 status/inspect/api。maxChars 控制内容预算，detail=full 按需读取完整元数据。includeImage 返回已捕获的区域画面。',z.object({offset:z.number().int().nonnegative().default(0),limit,includeImage:z.boolean().default(true),maxChars:z.number().int().min(256).max(32000).default(4000),detail:z.enum(['compact','full']).default('compact')}),'read',async({offset,limit,includeImage,maxChars,detail},s,_confirm,images)=>{
    const frame=runtime.active(s),selection=frame?.selection
    const content=selectionData(selection),access=runtime.collaboration(s)
    let page=null,selectionRef,editHint
    if(selection) {
      if(Array.isArray(content.selectedIds)) {
        const selectedItems=content.selectedIds.slice(offset,offset+limit).map(id=>repository.find(id)).filter(Boolean).map(item=>detail==='full'?compact(item):({id:item.id,name:item.name,kind:item.kind,...(item.kind==='url'?{url:item.target}:{})}))
        page={totalSelected:content.selectedIds.length,offset,selectedItems}
      }else{
        page=compactSelection(content,{maxChars,detail})
        if(!page.truncated){try{selectionRef=await selections.capture(s,frame,content,access.editors)}catch(error){editHint=error.message}}
      }
    }
    const token=content.visual?.token
    const visual=includeImage&&token&&frame?.selectionImage?.token===token?frame.selectionImage:null
    const editors=detail==='full'?access.editors:access.editors.filter(e=>e.id===content.file?.id||e.active!==false).map(({editorId,id,mode,revision,sessionId,pendingReviews})=>({editorId,id,mode,revision,...(sessionId?{sessionId}:{}),...(pendingReviews?{pendingReviews}:{})}))
    return {selection:page,...(selectionRef?{selectionRef}:{}),...(editHint?{editHint}:{}),editors,...(visual&&images?{images:await images([{data:Buffer.from(visual.data,'base64'),mediaType:visual.mediaType,name:'资料库当前选区'}])}:{})}
  })
  add('edit_selection','修改资料选区','用 context 返回的 selectionRef 修改原选区：文字传 text；Excel 传与选区行列数一致的 values（可含 = 公式）。自动验证原内容并回读，不需重复 ID/原文或查询 API。仅更新草稿，不自动保存；过期引用需重读 context。',z.object({selectionRef:id,text:z.string().max(900000).optional(),values:z.array(z.array(z.union([z.string().max(32767),z.number().finite(),z.boolean(),z.null()])).max(1000)).max(1000).optional()}).strict().refine(a=>(a.text!==undefined)!==(a.values!==undefined),'只提供 text 或 values 中的一项'),'edit',(a,s)=>selections.edit(s,a))
  add('list','查找资料','按名称、标签、类型、路径或当前目录查找资料。parentId=null 表示根目录。结果可分页。',z.object({query:z.string().optional(),parentId:id.nullable().optional(),tag:z.string().optional(),limit,offset:z.number().int().nonnegative().default(0)}),'read',a=>{
    const q=a.query?.replace(/^#/,'').toLocaleLowerCase()
    const hits=repository.list({parentId:a.parentId,thumbnails:'omit'}).filter(i=>(!a.tag||i.tags.includes(a.tag)) && (!q||[i.name,i.target,i.kind,...i.tags].join('\n').toLocaleLowerCase().includes(q)))
    return {total:hits.length,items:hits.slice(a.offset,a.offset+a.limit).map(compact)}
  })
  add('read','读取资料内容','按 id 识别格式并读取：文本分块、Office/PDF/OFD 文字、图片预览、压缩包目录、模型/媒体元信息。mode=preview 读预览，metadata 只读属性。page 指定 PDF/OFD 页，offset 为文本字节或目录条目位置。仅可写源文件返回 version；活动选区与草稿用 context/editor。',z.object({
    id,mode:z.enum(['auto','text','structured','preview','metadata']).default('auto'),offset:z.number().int().nonnegative().default(0),maxBytes:z.number().int().min(1024).max(2000000).default(64000),page:z.number().int().positive().optional(),query:z.string().max(200).optional()
  }),'read',async(a,s,_confirm,images)=>{
    const item=find(a.id)
    if(['folder','local_folder'].includes(item.kind))return {item:compact(item),items:repository.list({parentId:item.id,thumbnails:'omit'}).slice(0,100).map(compact)}
    if(item.kind==='url' && a.mode!=='structured')return {item:compact(item),url:item.target}
    const facts=item.kind==='local_file'?await inspectPreviewFile(item.target):null
    const office=/\.(docx?|xlsx|pptx?|key|pages|numbers)$/i.test(item.target)
    if(facts&&a.mode==='metadata')return {id:item.id,name:item.name,...facts}
    if(facts&&a.mode==='text'&&!['text','moki'].includes(facts.kind)&&!['csv','tsv'].includes(facts.extension))throw Error('此文件不是纯文本；请使用 auto 或 preview 按实际格式读取')
    if(facts&&facts.extension==='pdf'){
      if(facts.size>256*1024*1024)throw Error('PDF 文字解析超出内存保护，请在预览中选页或框选画面协作')
      const data=await parsePdfPreview(new Uint8Array(await readFile(item.target)))
      if(a.page){if(a.page>data.totalPages)throw Error('PDF 页码超出范围');data.pages=data.pages.filter(p=>p.number===a.page);data.text=data.pages.map(p=>p.text).join('\n')}
      return {id:item.id,name:item.name,readOnly:true,...data}
    }
    if(facts&&!office&&!(facts.kind==='text'&&!facts.textPaged&&a.mode!=='preview')&&!['csv','tsv'].includes(facts.extension))return readExtraPreview(item,a,images)
    const structured=a.mode==='structured'||a.mode==='auto'&&office||a.mode==='preview'&&office
    const stamp=item.kind==='local_file'?await fileVersion(item.target):undefined
    const data=structured?await api(s,'GET',fileRoute(a.id,'/structured-preview')):readUtf8FileChunk(item.target,a.offset,a.maxBytes)
    if(stamp && await fileVersion(item.target)!==stamp)throw new Error('读取期间文件已变化，请重读')
    return {id:a.id,name:item.name,version:stamp,...data}
  })
  add('attach','取用资料附件','将资料复制为此对话的可用本地附件。图像以 DSH 原生图片传入；链接直接返回原 URL。',z.object({id}),'read',async(a,s,_confirm,images)=>{
    const item=find(a.id)
    if(item.kind==='url')return {id:item.id,name:item.name,url:item.target}
    if(item.kind!=='local_file')throw new Error('请选择本地文件')
    const metadata=await stat(item.target)
    if(!metadata.isFile()||metadata.size>32*1024*1024)throw new Error('附件需为 32 MB 以内的文件')
    const dir=join(runtime.session(s).dir,'attachments',randomUUID())
    await mkdir(dir,{recursive:true})
    const name=basename(item.target),path=join(dir,name)
    await copyFile(item.target,path,constants.COPYFILE_EXCL)
    const mime=imageTypes[extname(path).toLowerCase()]
    return {id:item.id,name,localPath:path,size:(await stat(path)).size,...(mime&&images?{images:await images([{data:await readFile(path),mediaType:mime,name}])}:{})}
  })
  add('manage','整理资料库','创建虚拟目录或映射、改名、改标签、移动/重排、移除映射、刷新映射目录索引。remove 仅移除库记录。',z.object({
    action:z.enum(['create','update','move','remove','index']),id:id.optional(),parentId:id.nullable().optional(),beforeId:id.nullable().optional(),kind:z.enum(['folder','local_file','local_folder','url']).optional(),name:z.string().optional(),target:z.string().optional(),tags:z.array(z.string()).optional(),folderColor:z.enum(['violet','blue','green','amber','rose','slate']).optional()
  }).strict(),'edit',async({action,id,beforeId,...data},s,confirm)=>{
    if(action==='create'){
      const parsed=ResourceLibraryCreateSchema.parse(data)
      await confirm(explain('新建资料库条目',parsed))
      return await api(s,'POST','/api/library/items',parsed)
    }
    const item=find(id)
    if(action==='index')return await api(s,'POST',fileRoute(id,'/index'))
    const seen=item.updatedAt
    const patch=action==='update'?ResourceLibraryUpdateSchema.parse(data):data
    await confirm(explain(action+' · '+item.name,{id,...patch,beforeId}))
    if(find(id).updatedAt!==seen)throw new Error('确认期间资料已变化，请重读')
    if(action==='remove')return await api(s,'DELETE',fileRoute(id))
    if(action==='move')return await api(s,'POST',fileRoute(id,'/move'),{parentId:data.parentId??null,beforeId})
    return await api(s,'PATCH',fileRoute(id),patch)
  })
  add('create','新建资料文件','生成资料库文件。支持 Markdown、HTML、CSV、DOCX、XLSX、PPTX 和多组件 Univer；表格用 columns/rows，演示用 slides。',ResourceLibraryFileCreateSchema,'edit',async(a,s,confirm)=>{
    await confirm(explain('创建 '+a.name,a))
    return await api(s,'POST','/api/library/files',a)
  })
  add('write','编辑源文件','更新已读源文本，或 DOCX/XLSX/PPTX 的结构化内容。必须携带读取时的 expectedVersion。活动编辑器请改用草稿工具。',z.object({
    id,expectedVersion:version,content:z.string().max(5000000).optional(),office:ResourceLibraryOfficeContentUpdateSchema.optional()
  }).strict(),'edit',async(a,s,confirm)=>{
    if((a.content===undefined)===(!a.office))throw new Error('请提供 content 或 office 中的一项')
    const item=find(a.id)
    if(item.kind!=='local_file')throw new Error('请选择本地文件')
    if(runtime.collaboration(s).editors.some(e=>e.id===a.id&&e.mode!=='preview'))throw new Error('文件有活动草稿，请用编辑器或 Office 草稿工具。')
    await confirm(explain('写回源文件 '+item.name,a))
    if(find(a.id).target!==item.target)throw new Error('文件映射已变化')
    if(a.office) {
      const result=await saveOfficeContentUpdate(item.target,a.office,a.expectedVersion)
      runtime.change(a.id,'file');return {saved:true,...result}
    }
    return await api(s,'PUT',fileRoute(a.id,'/content'),{content:a.content,expectedVersion:a.expectedVersion})
  })
  add('editor','操作活动编辑器','以本对话返回的 editorId/id 操作当前草稿。read_text 读取未保存内容；patch_text(唯一 before/after)、replace_text、replace_range（精确 start/end/expectedText）、undo/redo 均只改草稿。修改需传 revision。save/save_as/discard 需要确认。',editorSchema,'edit',async(a,s,confirm)=>{
    const access=runtime.collaboration(s)
    if(access.shared && !access.editors.some(e=>e.id===a.id && e.editorId===a.editorId)) throw new Error('该编辑器不在当前浮窗协作范围内')
    const bridge=runtime.session(access.owner).editors
    const state=bridge.require(a)
    if(!['edit','read_text'].includes(a.operation) && a.revision===undefined) throw new Error('请传入最近读取的 revision')
    if(['save','save_as','discard'].includes(a.operation))await confirm(explain(a.operation+' · '+state.name,a))
    const result=await bridge.request(a)
    return {...result,editor:bridge.list().find(e=>e.editorId===a.editorId)}
  })
  add('office','协作编辑 Office 草稿','复杂 Office 操作：status/inspect/api、execute、截图/导出、资源、SVG、图片与 Unit。简单选区替换优先 edit_selection。使用 context 的 draft.sessionId、location.unitId 和精确位置；PPT 的 textSelection 是指定对象内 UTF-16 范围，无此字段不能假定选中了某段文字。api 按 queries 按需查询，limit 默认 6。保留选区外文字、样式和位置，草稿由用户保存。',officeSchema,'edit',async(a,s,_confirm,images)=>{
    const access=runtime.collaboration(s)
    const reference=a.action==='api' || a.action==='resources'
    if(access.shared && !reference && !access.editors.some(e=>e.id===a.id && e.sessionId && e.sessionId===a.sessionId)) throw new Error('请先从当前浮窗的选区读取 Office 草稿标识')
    const office=await runtime.office(reference?s:access.owner)
    if(a.action==='api')return {reference:await office.apiReference(a.apiAction??'find',a.queries??[],{unit:a.unit,limit:a.limit})}
    if(a.action==='resources') {
      const options=a.options??{}
      if(!['registries','find','read'].includes(options.action))throw new Error('资源查询支持 registries/find/read，导出使用 export_resources')
      return await office.resources(options)
    }
    if(!a.id||!a.sessionId)throw new Error('请先从当前编辑器读取准确的 id 和 sessionId')
    const x=[a.sessionId,a.id], need=(v,label)=>{if(v===undefined||v==='')throw new Error('请提供 '+label);return v}
    switch(a.action) {
      case 'status':return await office.status(...x)
      case 'inspect':return await office.inspect(...x,a.range,a.unitId)
      case 'quality':return await office.quality(...x)
      case 'lint':return await office.lint(...x,a.pages,a.unitId)
      case 'export':return await office.exportDraft(...x,a.unitId)
      case 'export_resources':return await office.exportResources(...x,need(a.handles,'handles'))
      case 'screenshot':{
        const result=await office.screenshot(...x,a.options,a.unitId)
        const path=result.path??result.file
        if(typeof path==='string'&&images)return {...result,images:await images([{data:await readFile(path),mediaType:'image/png',name:'Office 草稿'}])}
        return result
      }
    }
    const editor=access.editors.find(e=>e.id===a.id&&e.sessionId===a.sessionId)
    if(!editor)throw new Error('请先在资料库打开该文件的编辑器，以查看并确认 AI 修改')
    const result=await runtime.reviewOffice(access.owner,editor,async()=>{
    let result
    if(a.action==='execute')result=await office.execute(...x,need(a.code,'code'),a.unitId)
    if(a.action==='compile_svg')result=await office.compileSvgText(...x,need(a.svg,'svg'),need(a.page,'page'),a.mode,a.unitId)
    if(a.action==='create_unit')result=await office.createUnit(...x,need(a.unitKind,'unitKind'),need(a.name,'name'))
    if(a.action==='remove_unit')result=await office.removeUnit(...x,need(a.unitId,'unitId'))
    if(a.action==='insert_image'){
      const image=find(need(a.imageId,'imageId'))
      if(image.kind!=='local_file')throw new Error('请选择资料库中的本地图片')
      result=await office.insertLibraryImage(...x,image.target,{...a.options,unitId:a.unitId})
    }
    return result
    },['create_unit','remove_unit'].includes(a.action)?undefined:a.unitId)
    if(a.action!=='execute'||result.committed)runtime.change(a.id,'office-draft',access.owner)
    return {draft:true,...result,...(result.review?{review:{...result.review,status:'pending',next:'User reviews highlighted changes in the file; only the user may accept or cancel.'}}:{})}
  })
  add('filesystem','操作映射目录','在已映射的本地文件夹中列举、读取、创建、写入、移动或删除。path、destination 都是 rootId 下的相对路径。遵守资料库中最具体的读写授权。',z.object({
    action:z.enum(['roots','list','stat','read_text','mkdir','write_text','move','delete']),rootId:id.optional(),path:z.string().default(''),destination:z.string().optional(),
    content:z.string().max(5000000).optional(),overwrite:z.boolean().default(false),recursive:z.boolean().default(false),offset:z.number().int().nonnegative().default(0),maxBytes:z.number().int().min(1024).max(2000000).default(64000),limit
  }).strict(),'edit',async(a,s,confirm)=>{
    const items=repository.list()
    if(a.action==='roots')return {roots:items.filter(i=>i.kind==='local_folder' && (!i.parentId||i.assistantPermission||items.find(p=>p.id===i.parentId)?.kind!=='local_folder')).map(compact).slice(0,a.limit)}
    const root=find(a.rootId)
    if(['list','stat','read_text'].includes(a.action)) {
      const {targetPath}=resolveAuthorizedFilesystemTarget(root,a.path)
      if(a.action==='read_text')return readUtf8FileChunk(targetPath,a.offset,a.maxBytes)
      const meta=statSync(targetPath)
      if(a.action==='stat')return {path:a.path,directory:meta.isDirectory(),size:meta.size,modified:meta.mtime.toISOString()}
      return {entries:readdirSync(targetPath,{withFileTypes:true}).filter(e=>!e.isSymbolicLink()).slice(0,a.limit).map(e=>({name:e.name,directory:e.isDirectory()}))}
    }
    const target=()=>mutationTarget(root,a.path,['mkdir','write_text'].includes(a.action)).targetPath
    const destination=()=>mutationTarget(root,a.destination??'',true).targetPath
    const path=target(),dest=a.action==='move'?destination():undefined
    if(!folderAllowsWrite(items,path,['move','delete'].includes(a.action)) || dest&&!folderAllowsWrite(items,dest,true))await confirm(explain(a.action+' · '+root.name,{...a,path,destination:dest}))
    if(find(a.rootId).target!==root.target || path!==target() || dest && dest!==destination())throw new Error('映射路径已变化')
    if(a.action==='mkdir')mkdirSync(path,{recursive:true})
    if(a.action==='write_text'){if(a.content===undefined)throw new Error('需要 content');writeFilesystemTextAtomically(path,a.content,a.overwrite)}
    if(a.action==='move')moveFilesystemEntry(path,dest,a.overwrite)
    if(a.action==='delete')rmSync(path,{recursive:lstatSync(path).isDirectory()&&a.recursive})
    await api(s,'POST',fileRoute(root.id,'/index'))
    runtime.change(root.id,'catalog')
    return {completed:true,path:a.path,destination:a.destination}
  })
  return tools
}

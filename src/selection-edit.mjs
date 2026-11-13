import {randomUUID} from 'node:crypto'

// Runs inside the existing Univer execution transaction. Guard comparison and
// mutation share one snapshot; the collaboration engine handles commit conflicts.
async function officeSelection(api,target,change){
  const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))).map(x=>x.toString(16).padStart(2,'0')).join('')
  const stale=()=>{throw Error('选区内容或格式已变化，请重新读取 moki_library_context')}
  let text,guard,apply,read,location
  if(target.kind==='sheet'){
    const book=api.getActiveWorkbook()
    if(book?.getId()!==target.unitId)throw Error('工作簿已变化')
    const sheet=book.getSheetBySheetId(target.sheetId)
    if(!sheet)throw Error('工作表已关闭')
    const rows=target.endRow-target.row+1,columns=target.endColumn-target.column+1
    if(rows<1||columns<1||rows*columns>1000||target.ranges?.length>1)throw Error('此选区请使用 office 按明确范围操作')
    const range=sheet.getRange(target.row,target.column,rows,columns)
    const values=range.getValues(),formulas=range.getFormulas()
    guard=await digest([values,formulas])
    location={sheetId:target.sheetId,range:range.getA1Notation()}
    if(!change)return {guard,values,formulas}
    if(guard!==change.guard)stale()
    if(!Array.isArray(change.values)||change.values.length!==rows||change.values.some(row=>row.length!==columns))throw Error('values 的行列数必须与选区完全一致')
    range.setValues(change.values)
    const after=range.getValues(),afterFormulas=range.getFormulas()
    for(let r=0;r<rows;r++)for(let c=0;c<columns;c++){
      const value=change.values[r][c]
      if(typeof value==='string'&&value.startsWith('=')){if(afterFormulas[r][c]!==value)throw Error('公式未通过回读校验')}
      else if(afterFormulas[r][c]||String(after[r][c]??'')!==String(value??''))throw Error('单元格未通过回读校验')
    }
    return {location,values:after,formulas:afterFormulas}
  }
  if(target.kind==='document'){
    const doc=api.getActiveDocument()
    if(doc?.getId()!==target.unitId)throw Error('文档已变化')
    if(target.segmentId)throw Error('页眉页脚等段请使用 office 按 segmentId 操作')
    const body=doc.getBody()
    guard=await digest(body)
    text=body.dataStream.slice(target.startOffset,target.endOffset)
    read=(start,end)=>doc.getTextRange(start,end,target.segmentId||'').getText()
    apply=(start,end,value)=>{if(!doc.getTextRange(start,end,target.segmentId||'').setText(value))throw Error('未能修改文档选区')}
    location={startOffset:target.startOffset,endOffset:target.endOffset}
  }else if(target.kind==='slide'){
    const pres=api.getActivePresentation(),range=target.textSelection
    if(pres?.getId()!==target.unitId||!range||range.collapsed||range.segmentId)throw Error('请先选择幻灯片中的文字')
    const shape=pres.getSlideById(target.slideId)?.getShape(range.elementId),facade=shape?.getText()
    if(!facade)throw Error('幻灯片对象已变化')
    const rich=facade.getRichText(),data=rich.getData()
    // Univer creates a new internal section ID on each load of shape text.
    // It is not a content/style change; all other rich-text data is guarded.
    const guardData=JSON.parse(JSON.stringify(data))
    for(const section of guardData.body?.sectionBreaks||[])delete section.sectionId
    guard=await digest(guardData)
    text=data.body.dataStream.slice(range.startOffset,range.endOffset)
    read=(start,end)=>facade.getRichText().getData().body.dataStream.slice(start,end)
    apply=(start,end,value)=>{
      const builder=rich.copy(),run=builder.getTextRuns().find(r=>{const p=r.getRange();return p.startOffset<=start&&p.endOffset>=end})
      if(!run||/[\r\n]/.test(value))throw Error('选区跨富文本样式或段落，请使用 office 精确编辑并保留样式')
      const bounds=run.getRange(),original=run.getText()
      run.setText(original.slice(0,start-bounds.startOffset)+value+original.slice(end-bounds.startOffset))
      facade.setRichText(builder)
    }
    location={slideId:target.slideId,elementId:range.elementId,startOffset:range.startOffset,endOffset:range.endOffset}
  }else throw Error('此格式不支持直接修改选区')
  if(!text||location.endOffset-location.startOffset!==text.length)throw Error('请先选择有效文字范围')
  if(!change)return {guard,text}
  if(guard!==change.guard||text!==change.expectedText)stale()
  if(text===change.text)return {location,text}
  // Selecting a paragraph by mouse commonly includes its final CR. A plain
  // text replacement should keep that boundary and the next paragraph intact.
  const suffix=text.endsWith('\r')&&!/[\r\n]$/.test(change.text)?'\r':''
  const end=location.endOffset-suffix.length,replacement=change.text
  if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text))throw Error('选区包含结构标记，请使用 office 编辑')
  apply(location.startOffset,end,replacement)
  const after=read(location.startOffset,location.startOffset+replacement.length+suffix.length)
  if(after!==replacement+suffix)throw Error('修改后的选区未通过回读校验')
  return {location:{...location,endOffset:location.startOffset+after.length},text:after}
}
const code=(target,change)=>`return await (${officeSelection.toString()})(univerAPI,${JSON.stringify(target)},${JSON.stringify(change)});`
export function selectionEdits(runtime){
  const snapshots=new Map(),ttl=10*60*1000
  const prune=()=>{for(const [key,value] of snapshots)if(Date.now()-value.at>ttl)snapshots.delete(key);while(snapshots.size>=128)snapshots.delete(snapshots.keys().next().value)}
  async function capture(chat,frame,data,editors){
    prune()
    const editor=editors.find(e=>e.id===data.file?.id&&e.mode!=='preview'&&e.active!==false)
    if(!editor)return null
    const owner=runtime.collaboration(chat).owner,rawTarget=data.editorSelection
    const target=rawTarget&&Object.fromEntries(['kind','unitId','sheetId','range','ranges','row','column','endRow','endColumn','startOffset','endOffset','segmentId','slideId','textSelection'].filter(key=>rawTarget[key]!==undefined).map(key=>[key,rawTarget[key]]))
    let snapshot
    if(editor.mode==='text'&&data.htmlSelection?.segments?.length&&!data.selectedTextTruncated){
      if(data.revision!==editor.revision)throw Error('HTML 选区正在同步，请重新读取 context')
      const {segments,expectedText}=data.htmlSelection
      if(!Array.isArray(segments)||segments.length>256||typeof expectedText!=='string'||!expectedText||expectedText.length>8000)return null
      snapshot={html:segments,expectedText,start:Math.min(...segments.map(s=>s.start)),end:Math.max(...segments.map(s=>s.end))}
    }else if(editor.mode==='text'&&data.mode==='text-editor'&&data.caret&&typeof data.selectedText==='string'&&!data.selectedTextTruncated&&data.caret.end>data.caret.start){
      if(data.revision!==editor.revision)throw Error('文本选区正在同步，请重新读取 context')
      if(data.caret.end-data.caret.start!==data.selectedText.length)return null
      snapshot={expectedText:data.selectedText,start:data.caret.start,end:data.caret.end}
    }else if(editor.mode==='office'&&editor.sessionId===data.unsavedDraft?.sessionId&&target){
      if(rawTarget.truncated||target.kind==='sheet'&&target.ranges?.length>1)return null
      // A caret is a valid conversation location, but has no text to replace.
      if(target.kind==='document'&&(target.endOffset<=target.startOffset||target.endOffset-target.startOffset>8000))return null
      if(target.kind==='slide'&&(!target.textSelection||target.textSelection.endOffset<=target.textSelection.startOffset||target.textSelection.endOffset-target.textSelection.startOffset>8000))return null
      if(!['sheet','document','slide'].includes(target.kind))return null
      const office=await runtime.office(owner)
      const result=await office.execute(editor.sessionId,editor.id,code(target),target.unitId)
      const current=result.value
      if(target.kind==='sheet'){
        if(JSON.stringify(current.values.map(row=>row.map(x=>String(x??''))))!==JSON.stringify(rawTarget.values)||JSON.stringify(current.formulas)!==JSON.stringify(rawTarget.formulas))throw Error('单元格选区正在同步，请重新读取 context')
      }else if(current.text!==(data.selectedText??rawTarget.selectedText))throw Error('文字选区正在同步，请重新读取 context')
      snapshot={target,guard:current.guard,expectedText:current.text}
    }else return null
    const ref=randomUUID()
    snapshots.set(ref,{...snapshot,chat,frame,owner,editor:{...editor},at:Date.now()})
    return ref
  }
  async function edit(chat,{selectionRef,text,values}){
    prune()
    const snapshot=snapshots.get(selectionRef),access=runtime.collaboration(chat)
    if(!snapshot||snapshot.chat!==chat||runtime.active(chat)!==snapshot.frame||access.owner!==snapshot.owner)throw Error('选区引用已失效，请重新读取 context')
    const current=access.editors.find(e=>e.id===snapshot.editor.id&&e.editorId===snapshot.editor.editorId&&e.sessionId===snapshot.editor.sessionId)
    if(!current||current.revision!==snapshot.editor.revision)throw Error('草稿已变化，请重新读取 context')
    if(snapshot.busy)throw Error('该选区已有修改正在执行')
    snapshot.busy=true
    try{
      let result
      if(current.mode==='text'){
        if(text===undefined||values!==undefined)throw Error('文字选区需要 text')
        result=await runtime.session(access.owner).editors.request({editorId:current.editorId,id:current.id,revision:current.revision,operation:'replace_range',range:{start:snapshot.start,end:snapshot.end,expectedText:snapshot.expectedText,...(snapshot.html?{html:snapshot.html}:{})},content:text})
        if(result.status!=='completed')throw Error(result.message)
        result={text,location:{start:snapshot.start,end:snapshot.start+text.length},review:result.review}
      }else{
        if((snapshot.target.kind==='sheet')!==(values!==undefined)||snapshot.target.kind!=='sheet'&&text===undefined)throw Error('Excel 需要 values；文字选区需要 text')
        const office=await runtime.office(access.owner)
        const applied=await runtime.reviewOffice(access.owner,current,()=>office.execute(current.sessionId,current.id,code(snapshot.target,{guard:snapshot.guard,expectedText:snapshot.expectedText,text,values}),snapshot.target.unitId),snapshot.target.unitId)
        if(applied.committed)runtime.change(current.id,'office-draft',access.owner)
        result={...applied.value,revision:applied.revision,review:applied.review}
      }
      snapshots.delete(selectionRef)
      // The caller already sent the replacement; do not echo a large payload.
      const response={status:'completed',saved:false,verified:true,...(result.review?{review:{...result.review,status:'pending',next:'User reviews highlighted changes in the file. Do not accept or save on their behalf.'}}:{}),location:result.location,...(result.revision!==undefined?{revision:result.revision}:{})}
      if(result.text!==undefined){response.text=result.text.slice(0,1000);if(result.text.length>1000)response.truncated=true}
      if(result.values){response.cells=result.values.reduce((n,row)=>n+row.length,0);if(JSON.stringify([result.values,result.formulas]).length<=2000){response.values=result.values;if(result.formulas.some(row=>row.some(Boolean)))response.formulas=result.formulas}}
      return response
    }finally{snapshot.busy=false}
  }
  return {capture,edit}
}

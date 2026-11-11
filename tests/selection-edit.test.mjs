import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {unzipSync,strFromU8} from 'fflate'
import {createRuntime} from '../lib/host.mjs'
import {selectionEdits} from '../src/selection-edit.mjs'
import {compactSelection,selectionQuote} from '../src/selection-context.js'

test('compact selections preserve exact locations with one copy of content and bounded quotes',()=>{
  const selectedText='selected '.repeat(600),editorSelection={kind:'slide',unitId:'unit',slideId:'page-2',page:2,selectedText,
    textSelection:{elementId:'shape-3',startOffset:23,endOffset:23+selectedText.length},elements:[{id:'shape-3',text:'whole shape '.repeat(1000)}]}
  const data={file:{id:randomUUID(),name:'a.pptx'},mode:'office-editor',selectedText,editorSelection,location:editorSelection,unsavedDraft:{sessionId:randomUUID(),unitId:'unit',units:Array(20).fill({id:'unit',name:'noise'})},assistantContext:'unneeded instructions'}
  const compact=compactSelection(data),full=JSON.stringify(data)
  assert.equal(compact.text.length,4000);assert.equal(compact.truncated,true)
  assert.deepEqual(compact.location.textSelection,editorSelection.textSelection)
  assert.equal(compact.location.selectedText,undefined);assert.equal(compact.elements,undefined)
  assert.ok(JSON.stringify(compact).length<full.length*.2)
  const quote=selectionQuote({label:'PPT range',content:full,itemCount:1})
  assert.ok(quote.length<1800);assert.ok(quote.includes('moki_library_context'));assert.ok(!quote.includes('whole shape'))
  const cells=compactSelection({editorSelection:{kind:'sheet',range:'A1:B2',ranges:['A1:B2'],values:[[1,2],[3,4]],formulas:[['',''],['','=A2+1']]}})
  assert.equal(cells.text,undefined);assert.equal(cells.location.ranges,undefined)
  assert.deepEqual(cells.formulas,[{row:1,column:1,formula:'=A2+1'}])
})

test('direct Office selection edits validate snapshots, preserve exact occurrences, and persist only on save',{timeout:150000},async t=>{
  const dir=await mkdtemp(join(tmpdir(),'moki-edit-selection-')),runtime=await createRuntime({dataDir:dir,sourceDb:null})
  t.after(async()=>{await runtime.close();await rm(dir,{recursive:true,force:true})})
  const owner='selection-test',office=await runtime.office(owner),edits=selectionEdits(runtime)
  const frame=runtime.openFrame(owner,'dsh-app://app');let seq=0,currentEditor
  const heartbeat=setInterval(()=>{if(currentEditor)runtime.session(owner).editors.register(currentEditor)},1000);t.after(()=>clearInterval(heartbeat))
  async function fixture(input){
    const {item}=await runtime.api(owner,'POST','/api/library/files',input)
    const {session}=await runtime.api(owner,'POST','/api/library/items/'+item.id+'/univer-session',{})
    const exec=code=>office.execute(session.sessionId,item.id,code,session.unitId)
    currentEditor={id:item.id,editorId:randomUUID(),sessionId:session.sessionId,mode:'office',active:true,revision:1,dirty:false,operations:['save','discard']}
    runtime.session(owner).editors.register(currentEditor)
    const select=async target=>{
      const data={file:{id:item.id,name:item.name},mode:'office-editor',editorSelection:{...target,unitId:session.unitId},selectedText:target.selectedText,unsavedDraft:{sessionId:session.sessionId,unitId:session.unitId}}
      await fetch(new URL('./api/dsh/state',frame.url),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({seq:++seq,active:true,previewId:item.id,selection:{label:item.name,itemCount:1,content:JSON.stringify(data)}})})
      return edits.capture(owner,runtime.active(owner),data,[currentEditor])
    }
    const save=()=>runtime.api(owner,'POST',`/api/library/items/${item.id}/univer-session/${session.sessionId}/save`,{})
    return {item,session,exec,select,save}
  }
  const doc=await fixture({name:'selected.docx',format:'docx',content:'KEEP TOP\nREPEAT WORD\nKEEP MIDDLE\nREPEAT WORD\nKEEP END'})
  const docOriginal=await readFile(doc.item.target)
  const body=(await doc.exec('return univerAPI.getActiveDocument().getBody()')).value
  const start=body.dataStream.lastIndexOf('REPEAT WORD'),end=start+12,target={kind:'document',segmentId:'',startOffset:start,endOffset:end,selectedText:'REPEAT WORD\r'}
  const ref=await doc.select(target)
  t.diagnostic('Word selection captured')
  assert.ok(ref)
  await assert.rejects(edits.edit('another-chat',{selectionRef:ref,text:'WRONG'}),/失效/)
  const result=await edits.edit(owner,{selectionRef:ref,text:'WORD-EFFICIENT'})
  t.diagnostic('Word selection edited')
  assert.equal(result.status,'completed');assert.equal(result.saved,false);assert.equal(result.text,'WORD-EFFICIENT\r')
  const after=(await doc.exec('return univerAPI.getActiveDocument().getBody()')).value
  assert.equal(after.dataStream,body.dataStream.slice(0,start)+'WORD-EFFICIENT\r'+body.dataStream.slice(end))
  assert.equal(after.paragraphs.length,body.paragraphs.length)
  assert.deepEqual(await readFile(doc.item.target),docOriginal)
  await assert.rejects(edits.edit(owner,{selectionRef:ref,text:'WRONG'}),/失效/)
  const stale=await doc.select({...target,endOffset:start+15,selectedText:'WORD-EFFICIENT\r'})
  await doc.exec("univerAPI.getActiveDocument().insertText(0,'USER ')")
  await assert.rejects(edits.edit(owner,{selectionRef:stale,text:'WRONG'}),/已变化/)
  await doc.save()
  assert.match(strFromU8(unzipSync(await readFile(doc.item.target))['word/document.xml']),/WORD-EFFICIENT/)

  const ppt=await fixture({name:'selected.pptx',format:'pptx',slides:[{title:'CONTROL',paragraphs:['KEEP PAGE']},{title:'TARGET',paragraphs:['REPEAT PPT then REPEAT PPT','KEEP END']}]})
  const pptOriginal=await readFile(ppt.item.target)
  const info=(await ppt.exec("const shape=univerAPI.getActivePresentation().getSlideById('slide-2').getShape('shape-3');return {data:shape.getText().getRichText().getData(),transform:shape.getTransform()}")).value
  const offset=info.data.body.dataStream.lastIndexOf('REPEAT PPT')
  const pptRef=await ppt.select({kind:'slide',slideId:'slide-2',page:2,selectedElementIds:['shape-3'],textSelection:{elementId:'shape-3',startOffset:offset,endOffset:offset+10},selectedText:'REPEAT PPT'})
  t.diagnostic('PPT selection captured')
  assert.ok(pptRef)
  const pptResult=await edits.edit(owner,{selectionRef:pptRef,text:'PPT-EFFICIENT'})
  t.diagnostic('PPT selection edited')
  assert.equal(pptResult.text,'PPT-EFFICIENT')
  const pptAfter=(await ppt.exec("const shape=univerAPI.getActivePresentation().getSlideById('slide-2').getShape('shape-3');return {data:shape.getText().getRichText().getData(),transform:shape.getTransform()}")).value
  assert.equal(pptAfter.data.body.dataStream,info.data.body.dataStream.replace('then REPEAT PPT','then PPT-EFFICIENT'))
  assert.deepEqual(pptAfter.transform,info.transform)
  assert.deepEqual(pptAfter.data.body.textRuns.map(x=>x.ts),info.data.body.textRuns.map(x=>x.ts))
  assert.deepEqual(await readFile(ppt.item.target),pptOriginal)
  await ppt.save()
  assert.match(strFromU8(unzipSync(await readFile(ppt.item.target))['ppt/slides/slide2.xml']),/PPT-EFFICIENT/)

  const sheet=await fixture({name:'selected.xlsx',format:'xlsx',columns:['KEEP','TARGET'],rows:[[1,2],[3,4]]})
  const sheetInfo=(await sheet.exec("const s=univerAPI.getActiveWorkbook().getActiveSheet(),r=s.getRange('B2:B3');return {sheetId:s.getSheetId(),values:r.getValues(),formulas:r.getFormulas()}")).value
  const sheetRef=await sheet.select({kind:'sheet',sheetId:sheetInfo.sheetId,range:'B2:B3',ranges:['B2:B3'],row:1,column:1,endRow:2,endColumn:1,values:sheetInfo.values.map(row=>row.map(String)),formulas:sheetInfo.formulas})
  t.diagnostic('Excel selection captured')
  assert.ok(sheetRef)
  await assert.rejects(edits.edit(owner,{selectionRef:sheetRef,values:[[9,10]]}),/行列数/)
  const sheetResult=await edits.edit(owner,{selectionRef:sheetRef,values:[[156],['=A3*10']]})
  assert.equal(sheetResult.values[0][0],156);assert.equal(sheetResult.formulas[1][0],'=A3*10')
  assert.deepEqual((await sheet.exec("return univerAPI.getActiveWorkbook().getActiveSheet().getRange('A2:A3').getValues()")).value,[[1],[3]])
  await sheet.save()
  // Import the saved files into an independent runtime, rather than reading a
  // still-open draft or a cached preview.
  const freshDir=await mkdtemp(join(tmpdir(),'moki-selection-reopen-')),fresh=await createRuntime({dataDir:freshDir,sourceDb:null})
  try{
    for(const [original,expression,expected] of [[doc,"univerAPI.getActiveDocument().getBody().dataStream",'WORD-EFFICIENT'],[ppt,"univerAPI.getActivePresentation().getSlideById('slide-2').getShape('shape-3').getText().getPlainText()",'PPT-EFFICIENT'],[sheet,"univerAPI.getActiveWorkbook().getActiveSheet().getRange('B2').getValue()",156]]){
      const item=fresh.repository.create({kind:'local_file',name:original.item.name,target:original.item.target,tags:[]})
      const {session}=await fresh.api(owner,'POST',`/api/library/items/${item.id}/univer-session`,{})
      const value=(await (await fresh.office(owner)).execute(session.sessionId,item.id,'return '+expression,session.unitId)).value
      if(typeof expected==='string')assert.ok(value.includes(expected));else assert.equal(value,expected)
    }
  }finally{await fresh.close();await rm(freshDir,{recursive:true,force:true})}
})

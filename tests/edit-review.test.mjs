import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createRuntime} from '../lib/host.mjs'
import {textChange,textChanges,officeChanges} from '../src/edit-review.js'

test('review diffs identify exact cell and text locations without writing document styles',()=>{
  assert.deepEqual(textChange('keep old tail','keep new tail'),{kind:'text',start:5,end:8,before:'old',after:'new',removed:false})
  assert.equal(textChange('same','same'),null)
  assert.equal(textChange('delete','').removed,true)
  const spans=textChanges('状态：草稿\r\n计划：5\r\n保留','状态：待审核\r\n计划：7\r\n保留')
  assert.deepEqual(spans.map(c=>[c.start,c.end,c.after]),[[3,6,'待审核'],[11,12,'7']])
  const a={sheets:{s:{name:'Sheet',cellData:{1:{1:{v:2,s:{bg:'red'}}}}}}},b=structuredClone(a);b.sheets.s.cellData[1][1].v=3
  const changes=officeChanges(a,b,'book','sheet');assert.equal(changes.count,1);assert.equal(changes.changes[0].range,'B2');assert.equal(changes.changes[0].before,'2');assert.equal(changes.changes[0].after,'3')
})

test('Office review stack preserves manual baseline, cancels only latest, survives restart and requires acceptance before save',{timeout:180000},async t=>{
  const dir=await mkdtemp(join(tmpdir(),'moki-review-'));let runtime=await createRuntime({dataDir:dir,sourceDb:null})
  t.after(async()=>{await runtime.close();await rm(dir,{recursive:true,force:true})})
  const chat='review',office=await runtime.office(chat)
  for(const spec of [
    {input:{name:'review.xlsx',format:'xlsx',columns:['Name','Value'],rows:[['One',2]]},read:"univerAPI.getActiveWorkbook().getActiveSheet().getRange('B2').getValue()",write:v=>`univerAPI.getActiveWorkbook().getActiveSheet().getRange('B2').setValue(${JSON.stringify(v)});`,expectedKind:'sheet'},
    {input:{name:'review.docx',format:'docx',content:'ORIGINAL\nKEEP'},read:"univerAPI.getActiveDocument().getBody().dataStream",write:v=>`const d=univerAPI.getActiveDocument();d.getTextRange(0,d.getBody().dataStream.indexOf('\\r')).setText(${JSON.stringify(v)});`,expectedKind:'document'},
    {input:{name:'review.pptx',format:'pptx',slides:[{title:'ORIGINAL',paragraphs:['KEEP']}]},read:"univerAPI.getActivePresentation().getSlideById('slide-1').getShape('shape-2').getText().getPlainText()",write:v=>`const text=univerAPI.getActivePresentation().getSlideById('slide-1').getShape('shape-2').getText(),rich=text.getRichText().copy();rich.getTextRuns()[0].setText(${JSON.stringify(v)});text.setRichText(rich);`,expectedKind:'slide'}
  ]) {
    const {item}=await runtime.api(chat,'POST','/api/library/files',spec.input)
    const original=await readFile(item.target),{session}=await runtime.api(chat,'POST',`/api/library/items/${item.id}/univer-session`,{})
    const exec=code=>office.execute(session.sessionId,item.id,code,session.unitId)
    await exec(spec.write('MANUAL'))
    const manual=(await exec('return '+spec.read)).value
    const review=code=>office.reviewedEdit(session.sessionId,item.id,()=>exec(code),session.unitId)
    const first=await review(spec.write('AI-ONE'));assert.equal(first.review.pending,1)
    const second=await review(spec.write('AI-TWO'));assert.equal(second.review.pending,2)
    const state=office.reviewStatus(session.sessionId,item.id)
    assert.equal(state.entries.length,2);assert.ok(state.entries[1].changes.some(c=>c.kind===spec.expectedKind));assert.ok(state.entries[1].changes.some(c=>c.after?.includes('TWO')))
    await assert.rejects(office.save(session.sessionId,item.id),/采纳或取消/)
    await assert.rejects(office.resolveReview(session.sessionId,item.id,'reject',first.review.id),/版本已变化/)
    await office.resolveReview(session.sessionId,item.id,'reject',second.review.id)
    assert.ok(String((await exec('return '+spec.read)).value).includes('AI-ONE'))
    assert.equal(office.reviewStatus(session.sessionId,item.id).entries.length,1)
    await office.resolveReview(session.sessionId,item.id,'reject',first.review.id)
    assert.equal((await exec('return '+spec.read)).value,manual)
    assert.deepEqual(await readFile(item.target),original)
    const third=await review(spec.write('ACCEPTED'))
    await office.resolveReview(session.sessionId,item.id,'accept',third.review.id)
    assert.equal(office.reviewStatus(session.sessionId,item.id).entries.length,0)
    await office.save(session.sessionId,item.id)
    const reopened=await office.open(item.id,item.target,item.name)
    assert.ok(String((await office.execute(reopened.sessionId,item.id,'return '+spec.read,reopened.unitId)).value).includes('ACCEPTED'))
    t.diagnostic(spec.input.format+' review, rollback, accept/save/reopen passed')
  }
  const {item}=await runtime.api(chat,'POST','/api/library/files',{name:'recovery.xlsx',format:'xlsx',columns:['Value'],rows:[[1]]})
  const opened=await office.open(item.id,item.target,item.name)
  const edit=()=>office.execute(opened.sessionId,item.id,"univerAPI.getActiveWorkbook().getActiveSheet().getRange('A2').setValue(88)",opened.unitId)
  const pending=await office.reviewedEdit(opened.sessionId,item.id,edit,opened.unitId)
  await runtime.close();runtime=await createRuntime({dataDir:dir,sourceDb:null})
  const recoveredOffice=await runtime.office(chat),recovered=await recoveredOffice.open(item.id,item.target,item.name)
  assert.equal(recovered.kind,'spreadsheet');assert.equal(recovered.unitId,opened.unitId)
  assert.equal(recoveredOffice.reviewStatus(recovered.sessionId,item.id).entries[0].id,pending.review.id)
  await recoveredOffice.resolveReview(recovered.sessionId,item.id,'reject',pending.review.id)
  assert.equal((await recoveredOffice.execute(recovered.sessionId,item.id,"return univerAPI.getActiveWorkbook().getActiveSheet().getRange('A2').getValue()",recovered.unitId)).value,1)
  const write=value=>recoveredOffice.execute(recovered.sessionId,item.id,`univerAPI.getActiveWorkbook().getActiveSheet().getRange('A2').setValue(${value})`,recovered.unitId)
  const first=await recoveredOffice.reviewedEdit(recovered.sessionId,item.id,()=>write(10),recovered.unitId)
  const [next,staleDecision]=await Promise.allSettled([
    recoveredOffice.reviewedEdit(recovered.sessionId,item.id,()=>write(20),recovered.unitId),
    recoveredOffice.resolveReview(recovered.sessionId,item.id,'reject',first.review.id),
  ])
  assert.equal(next.status,'fulfilled');assert.equal(staleDecision.status,'rejected');assert.match(staleDecision.reason.message,/版本已变化/)
  const latest=recoveredOffice.reviewStatus(recovered.sessionId,item.id)
  assert.equal(latest.entries.length,2);assert.equal(latest.highlights.find(c=>c.range==='A2').before,'1');assert.equal(latest.highlights.find(c=>c.range==='A2').after,'20')
  const checkpoint=recoveredOffice.checkpoint.bind(recoveredOffice)
  recoveredOffice.checkpoint=async()=>{throw new Error('Simulated draft persistence failure')}
  for(const action of ['accept','reject']) {
    await assert.rejects(recoveredOffice.resolveReview(recovered.sessionId,item.id,action,next.value.review.id),/persistence failure/)
    assert.equal(recoveredOffice.reviewStatus(recovered.sessionId,item.id).entries.at(-1).id,next.value.review.id)
    assert.equal((await recoveredOffice.execute(recovered.sessionId,item.id,"return univerAPI.getActiveWorkbook().getActiveSheet().getRange('A2').getValue()",recovered.unitId)).value,20)
  }
  recoveredOffice.checkpoint=checkpoint
  await write(33) // An independent/manual edit must never be lost by cancelling.
  await assert.rejects(recoveredOffice.resolveReview(recovered.sessionId,item.id,'reject',next.value.review.id),/手动修改/)
  await recoveredOffice.resolveReview(recovered.sessionId,item.id,'accept',next.value.review.id)
  assert.equal((await recoveredOffice.execute(recovered.sessionId,item.id,"return univerAPI.getActiveWorkbook().getActiveSheet().getRange('A2').getValue()",recovered.unitId)).value,33)
})

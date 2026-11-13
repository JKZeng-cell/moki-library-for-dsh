import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import puppeteer from 'puppeteer-core'
import {createRuntime} from '../lib/host.mjs'
import {browserExecutables} from '../src/preview-browser.mjs'

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function eventually(check){
  const deadline=Date.now()+15000
  while(Date.now()<deadline){const value=await check();if(value)return value;await delay(80)}
  throw new Error('Office review did not reach the expected state')
}

test('AI progress and no-op Office operations preserve the loaded editor and selection',{timeout:90000},async t=>{
  const dir=await mkdtemp(join(tmpdir(),'moki-review-stability-')),runtime=await createRuntime({dataDir:dir,sourceDb:null})
  const browser=await puppeteer.launch({executablePath:(await browserExecutables())[0],headless:true,pipe:true})
  t.after(async()=>{await browser.close();await runtime.close();await rm(dir,{recursive:true,force:true})})
  const {item}=await runtime.api('files','POST','/api/library/files',{name:'Stable.xlsx',format:'xlsx',columns:['Name','Value'],rows:[['Example',2]]})
  const original=await readFile(item.target),owner='moki-document-'+item.id
  const connection=runtime.openFrame(owner,'dsh-app://app',item.id),page=await browser.newPage()
  const errors=[];page.on('pageerror',error=>errors.push(error.message))
  await page.setViewport({width:1080,height:800})
  await page.goto(connection.url+'?'+new URLSearchParams({document:item.id,parent:new URL(connection.url).origin,bridge:'stability'}))
  await page.evaluate(()=>window.postMessage({bridge:'stability',type:'surface',active:true,mode:'side',dark:true},location.origin))
  await page.waitForSelector('[aria-label="编辑 Office"]');await page.click('[aria-label="编辑 Office"]')
  const getFrame=async()=>await (await page.$('[data-office-editor]'))?.contentFrame()
  await eventually(async()=>{const frame=await getFrame();return frame?.evaluate(()=>Boolean(window.univerAPI?.getActiveWorkbook?.())).catch(()=>false)})
  const office=await runtime.office(owner),editor=await eventually(()=>runtime.session(owner).editors.list().find(entry=>entry.mode==='office'))
  const frame=await getFrame(),initialUrl=frame.url()
  await frame.evaluate(()=>{
    window.qaEditorIdentity=crypto.randomUUID()
    const book=univerAPI.getActiveWorkbook();book.setActiveRange(book.getActiveSheet().getRange('D4'))
  })
  const identity=await frame.evaluate(()=>window.qaEditorIdentity)
  let navigations=0
  page.on('framenavigated',current=>{if(current===frame)navigations++})

  for(let step=0;step<3;step++){
    const pending=runtime.reviewOffice(owner,editor,async()=>{
      // Cover several progress polls while the agent is thinking or reading.
      await delay(step===0?3200:1200)
      return office.execute(editor.sessionId,item.id,"return univerAPI.getActiveWorkbook().getActiveSheet().getRange('B2').getValue()")
    })
    await page.waitForSelector('.moki-review-shield')
    assert.equal(await page.$eval('[data-office-editor]',node=>node.inert),true,'progress blocks manual input without changing the editor URL')
    const result=await pending
    assert.equal(result.value,2)
    await page.waitForFunction(()=>!document.querySelector('.moki-edit-review'))
    assert.equal(await page.$eval('[data-office-editor]',node=>node.inert),false,'manual input resumes after a read-only operation')
    assert.equal(navigations,0,'AI progress must not navigate/reload the Office iframe')
    assert.equal((await getFrame()).url(),initialUrl)
    assert.equal(await frame.evaluate(()=>window.qaEditorIdentity),identity)
    assert.equal(await frame.evaluate(()=>univerAPI.getActiveWorkbook().getActiveSheet().getActiveRange().getA1Notation()),'D4')
    assert.equal(office.reviewStatus(editor.sessionId,item.id).entries.length,0,'read-only calls must not create review entries')
  }

  await writeFile(item.target,original)
  await runtime.taskFiles.changed([item.target])
  await page.waitForFunction(()=>document.body.textContent.includes('原文件已更新，点击刷新查看'))
  assert.equal(runtime.session(owner).editors.list().find(entry=>entry.editorId===editor.editorId).dirty,false,'a source-file notification must not dirty the Office draft')
  assert.equal(navigations,0,'external notifications never reload a live Office editor')

  // Real remote data still reaches the existing viewer while the task is busy.
  let finish
  const completing=new Promise(resolve=>{finish=resolve})
  const writing=runtime.reviewOffice(owner,editor,async()=>{
    const result=await office.execute(editor.sessionId,item.id,"univerAPI.getActiveWorkbook().getActiveSheet().getRange('B2').setValue(88)")
    await completing
    return result
  })
  try {
    await page.waitForSelector('.moki-review-shield')
    await eventually(()=>frame.evaluate(()=>univerAPI.getActiveWorkbook().getActiveSheet().getRange('B2').getValue()===88).catch(()=>false))
    assert.equal(navigations,0,'remote changes update the live viewer without reloading it during AI progress')
    assert.equal(await frame.evaluate(()=>window.qaEditorIdentity),identity)
  }finally{finish();await writing}
  await page.waitForSelector('.moki-review-buttons [data-primary]')
  await frame.waitForFunction(()=>document.documentElement.dataset.mokiReviewLocked==='true')
  await frame.waitForFunction(()=>Number(document.documentElement.dataset.mokiReviewHighlights)>0)
  assert.equal(navigations,0,'entering pending review must also keep the editor mounted')
  assert.equal(await frame.evaluate(()=>window.qaEditorIdentity),identity)
  await frame.evaluate(()=>univerAPI.getActiveWorkbook().getActiveSheet().getRange('B2').setValue(99))
  assert.equal(await frame.evaluate(()=>univerAPI.getActiveWorkbook().getActiveSheet().getRange('B2').getValue()),88,'pending review blocks manual mutations')
  assert.equal(office.reviewStatus(editor.sessionId,item.id).entries.length,1,'the real edit still requires user review')
  assert.deepEqual(await readFile(item.target),original)
  await frame.evaluate(()=>{
    const book=univerAPI.getActiveWorkbook(),sheet=book.getActiveSheet()
    book.setActiveRange(sheet.getRange('D40'));sheet.zoom(.8);sheet.scrollToCell(35,0)
  })
  await delay(300)
  const view=()=>frame.evaluate(()=>{const s=univerAPI.getActiveWorkbook().getActiveSheet();return {range:s.getActiveRange().getA1Notation(),zoom:s.getZoom(),scroll:s.getScrollState()}})
  const before=await view();assert.equal(before.range,'D40');assert.equal(before.zoom,.8)
  const exported=await office.exportDraft(editor.sessionId,item.id)
  await writeFile(item.target,await readFile(exported.path))
  await page.click('.moki-review-buttons [data-primary]')
  await page.waitForFunction(()=>!document.querySelector('.moki-edit-review'))
  await frame.waitForFunction(()=>document.documentElement.dataset.mokiReviewLocked==='false')
  assert.equal(navigations,0,'accept/save must not navigate the editor')
  assert.equal(await frame.evaluate(()=>window.qaEditorIdentity),identity)
  assert.deepEqual(await view(),before,'accept preserves selection, zoom and scroll')
  assert.notDeepEqual(await readFile(item.target),original,'accept writes the original immediately')
  await frame.evaluate(()=>univerAPI.getActiveWorkbook().getActiveSheet().getRange('B2').setValue(99))
  await eventually(async()=>(await office.execute(editor.sessionId,item.id,"return univerAPI.getActiveWorkbook().getActiveSheet().getRange('B2').getValue()")).value===99)
  assert.deepEqual(errors,[])
})

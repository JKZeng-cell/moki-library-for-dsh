import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,rm,mkdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import puppeteer from 'puppeteer-core'
import {createRuntime} from '../lib/host.mjs'
import {browserExecutables} from '../src/preview-browser.mjs'
const delay=ms=>new Promise(r=>setTimeout(r,ms))
async function eventually(fn,timeout=15000){const end=Date.now()+timeout;while(Date.now()<end){const v=await fn();if(v)return v;await delay(80)}throw Error('Timed out waiting for review state')}

test('native Office review surfaces highlight changes, lock manual editing, cancel and accept through the UI',{timeout:180000},async t=>{
  const dir=await mkdtemp(join(tmpdir(),'moki-review-ui-')),runtime=await createRuntime({dataDir:dir,sourceDb:null})
  const browser=await puppeteer.launch({executablePath:(await browserExecutables())[0],headless:true,pipe:true})
  t.after(async()=>{await browser.close();await runtime.close();await rm(dir,{recursive:true,force:true})})
  for(const spec of [
    {name:'Review.xlsx',format:'xlsx',columns:['Name','Value'],rows:[['Example',2]],kind:'sheet',read:"univerAPI.getActiveWorkbook().getActiveSheet().getRange('B2').getValue()",write:"univerAPI.getActiveWorkbook().getActiveSheet().getRange('B2').setValue(88)"},
    {name:'Review.docx',format:'docx',content:'Original sentence\nKeep this paragraph',kind:'document',read:'univerAPI.getActiveDocument().getBody().dataStream',write:"const activeDocument=univerAPI.getActiveDocument(),start=activeDocument.getBody().dataStream.indexOf('Original sentence');activeDocument.getTextRange(start,start+17).setText('AI revised this sentence')"},
    {name:'Review.pptx',format:'pptx',slides:[{title:'Original heading',paragraphs:['Keep this body']}],kind:'slide',read:"univerAPI.getActivePresentation().getSlideById('slide-1').getShape('shape-2').getText().getPlainText()",write:"const text=univerAPI.getActivePresentation().getSlideById('slide-1').getShape('shape-2').getText(),rich=text.getRichText().copy();rich.getTextRuns()[0].setText('Reviewed heading');text.setRichText(rich)"}
  ]){
    const {kind,read,write,...input}=spec,{item}=await runtime.api('files','POST','/api/library/files',input),original=await readFile(item.target)
    const owner='moki-document-'+item.id,connection=runtime.openFrame(owner,'dsh-app://app',item.id),page=await browser.newPage();await page.setViewport({width:1080,height:800})
    await page.goto(connection.url+'?'+new URLSearchParams({document:item.id,parent:new URL(connection.url).origin,bridge:'review-ui'}));await page.evaluate(()=>window.postMessage({bridge:'review-ui',type:'surface',active:true,mode:'sidebar',dark:true},location.origin))
    await page.waitForSelector('[aria-label="编辑 Office"]');await page.click('[aria-label="编辑 Office"]')
    const getFrame=async()=>{const e=await page.$('[data-office-editor]');return e?.contentFrame()}
    await eventually(async()=>{const f=await getFrame();return f?.evaluate(()=>Boolean(window.univerAPI)).catch(()=>false)})
    const office=await runtime.office(owner),editor=await eventually(()=>runtime.session(owner).editors.list().find(e=>e.mode==='office'))
    const exec=code=>office.execute(editor.sessionId,item.id,code)
    const baseline=(await exec('return '+read)).value
    const result=await runtime.reviewOffice(owner,editor,()=>exec(write))
    assert.equal(result.review.pending,1)
    await page.waitForSelector('.moki-review-buttons [data-primary]')
    await eventually(async()=>{const f=await getFrame();return f?.evaluate(()=>Number(document.documentElement.dataset.mokiReviewHighlights)>0).catch(()=>false)})
    const frame=await getFrame()
    assert.match(frame.url(),/editable=false/)
    assert.equal(await frame.evaluate(()=>window.__mokiReviewError),undefined)
    const stateBefore=(await exec('return '+read)).value
    if(process.env.MOKI_REVIEW_SCREENSHOTS){await mkdir(process.env.MOKI_REVIEW_SCREENSHOTS,{recursive:true});await page.screenshot({path:join(process.env.MOKI_REVIEW_SCREENSHOTS,spec.format+'-dark.png')})}
    await page.evaluate(()=>window.postMessage({bridge:'review-ui',type:'surface',active:true,mode:'sidebar',dark:false},location.origin));await delay(350)
    assert.equal((await exec('return '+read)).value,stateBefore,'highlight/theme must not alter content')
    assert.deepEqual(await readFile(item.target),original)
    await page.click('.moki-review-buttons button:not([data-primary])')
    await eventually(()=>office.reviewStatus(editor.sessionId,item.id).entries.length===0)
    await page.waitForFunction(()=>!document.querySelector('.moki-edit-review'))
    assert.equal((await exec('return '+read)).value,baseline)
    await eventually(async()=>{const f=await getFrame();return f?.evaluate(()=>Boolean(window.univerAPI)).catch(()=>false)})
    const latest=await eventually(()=>runtime.session(owner).editors.list().find(e=>e.mode==='office'))
    const applied=await runtime.reviewOffice(owner,latest,()=>exec(write));assert.equal(applied.review.pending,1)
    await page.waitForSelector('.moki-review-buttons [data-primary]');await page.click('.moki-review-buttons [data-primary]')
    await eventually(()=>office.reviewStatus(editor.sessionId,item.id).entries.length===0)
    await page.waitForFunction(()=>!document.querySelector('.moki-edit-review'))
    assert.notEqual((await exec('return '+read)).value,baseline)
    await page.close();t.diagnostic(spec.format+' native review UI passed')
  }
})

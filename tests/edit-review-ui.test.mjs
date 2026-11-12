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
    {name:'Review.docx',format:'docx',content:'Original sentence\n'+Array.from({length:60},(_,i)=>'Keep this paragraph '+i).join('\n'),kind:'document',read:'univerAPI.getActiveDocument().getBody().dataStream',write:"const activeDocument=univerAPI.getActiveDocument(),start=activeDocument.getBody().dataStream.indexOf('Original sentence');activeDocument.getTextRange(start,start+17).setText('AI revised this sentence')"},
    {name:'Review.pptx',format:'pptx',slides:[{title:'Original heading',paragraphs:['Keep this body']},{title:'Second slide',paragraphs:['Keep the current page']}],kind:'slide',read:"univerAPI.getActivePresentation().getSlideById('slide-1').getShape('shape-2').getText().getPlainText()",write:"const text=univerAPI.getActivePresentation().getSlideById('slide-1').getShape('shape-2').getText(),rich=text.getRichText().copy();rich.getTextRuns()[0].setText('Reviewed heading');text.setRichText(rich)"}
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
    assert.equal(await frame.evaluate(()=>document.documentElement.dataset.mokiReviewLocked),'true')
    assert.equal(await frame.evaluate(()=>window.__mokiReviewError),undefined)
    const stateBefore=(await exec('return '+read)).value
    if(process.env.MOKI_REVIEW_SCREENSHOTS){await mkdir(process.env.MOKI_REVIEW_SCREENSHOTS,{recursive:true});await page.screenshot({path:join(process.env.MOKI_REVIEW_SCREENSHOTS,spec.format+'-dark.png')})}
    await page.evaluate(()=>window.postMessage({bridge:'review-ui',type:'surface',active:true,mode:'sidebar',dark:false},location.origin));await delay(350)
    assert.equal((await exec('return '+read)).value,stateBefore,'highlight/theme must not alter content')
    assert.deepEqual(await readFile(item.target),original)
    if(kind==='slide'){
      await frame.evaluate(()=>{const p=univerAPI.getActivePresentation();p.setActiveSlide(p.getSlides()[1])})
      await frame.waitForFunction(()=>univerAPI.getActivePresentation().getActiveSlide().getId()==='slide-2')
    }
    await page.click('.moki-review-buttons button:not([data-primary])')
    await eventually(()=>office.reviewStatus(editor.sessionId,item.id).entries.length===0)
    await page.waitForFunction(()=>!document.querySelector('.moki-edit-review'))
    assert.equal((await exec('return '+read)).value,baseline)
    await eventually(async()=>{const f=await getFrame();return f?.evaluate(()=>Boolean(window.univerAPI)).catch(()=>false)})
    const latest=await eventually(()=>runtime.session(owner).editors.list().find(e=>e.mode==='office'))
    const applied=await runtime.reviewOffice(owner,latest,()=>exec(write));assert.equal(applied.review.pending,1)
    await page.waitForSelector('.moki-review-buttons [data-primary]')
    const acceptingFrame=await getFrame(),url=acceptingFrame.url()
    await acceptingFrame.waitForFunction(()=>document.documentElement.dataset.mokiReviewLocked==='true')
    await acceptingFrame.waitForFunction(()=>Number(document.documentElement.dataset.mokiReviewHighlights)>0)
    await acceptingFrame.evaluate(kind=>{
      window.qaEditorIdentity=crypto.randomUUID()
      if(kind==='slide'){const p=univerAPI.getActivePresentation();p.setActiveSlide(p.getSlides()[1])}
      if(kind==='document'){const d=univerAPI.getActiveDocument(),end=d.getBody().dataStream.length-4;d.setSelection(end-12,end)}
      if(kind==='sheet'){const b=univerAPI.getActiveWorkbook();b.setActiveRange(b.getActiveSheet().getRange('D40'))}
    },kind)
    if(kind==='document'){await page.mouse.move(800,500);await page.mouse.wheel({deltaY:1300})}
    await delay(300)
    const view=()=>acceptingFrame.evaluate(()=>{
      let textRanges,scroll;const api=window.univerAPI,queue=[api._injector],seen=new Set()
      while(queue.length){const injector=queue.shift();if(!injector||seen.has(injector))continue;seen.add(injector)
        for(const values of injector.resolvedDependencyCollection?.resolvedDependencies?.values?.()||[])for(const service of Array.isArray(values)?values:[values])if(typeof service?.addDocRanges==='function'&&typeof service?.getAllTextRanges==='function'){
          textRanges=service.getAllTextRanges().map(r=>[r.startOffset,r.endOffset]);const viewport=service.activeViewPort||service._context?.scene?.getMainViewport?.();if(viewport)scroll=[viewport.viewportScrollX,viewport.viewportScrollY]
        }
        queue.push(injector.parent,...injector.children||[])
      }
      return {identity:window.qaEditorIdentity,slide:api.getActivePresentation?.()?.getActiveSlide()?.getId(),range:api.getActiveWorkbook?.()?.getActiveSheet()?.getActiveRange()?.getA1Notation(),textRanges,scroll}
    })
    const before=await view();let navigations=0
    if(kind==='slide')assert.equal(before.slide,'slide-2','pending review permits navigating to another slide')
    if(kind==='sheet')assert.equal(before.range,'D40')
    if(kind==='document'){
      assert.ok(before.textRanges?.some(r=>r[0]>1000&&r[1]-r[0]===12),'pending review permits selecting Word text beyond the first page')
      assert.ok(before.scroll?.[1]>100,'the Word editor has a nonzero scroll position')
    }
    page.on('framenavigated',f=>{if(f===acceptingFrame)navigations++})
    await page.click('.moki-review-buttons [data-primary]')
    await eventually(()=>office.reviewStatus(editor.sessionId,item.id).entries.length===0)
    await page.waitForFunction(()=>!document.querySelector('.moki-edit-review'))
    await acceptingFrame.waitForFunction(()=>document.documentElement.dataset.mokiReviewLocked==='false')
    if(kind==='document')await eventually(async()=>JSON.stringify((await view()).textRanges)===JSON.stringify(before.textRanges)).catch(async()=>assert.deepEqual(await view(),before))
    assert.equal(navigations,0,'accept/save must not reload '+spec.format)
    assert.equal((await getFrame()).url(),url)
    assert.deepEqual(await view(),before,'the same editor and current page/selection remain visible')
    const accepted=(await exec('return '+read)).value
    assert.notEqual(accepted,baseline)
    assert.notDeepEqual(await readFile(item.target),original,'accept must save '+spec.format+' without another Save click')
    // A separate owner imports the saved original, not the live editor session.
    const reader=await runtime.office('saved-'+item.id),reopened=await reader.open(item.id,item.target,item.name)
    assert.equal((await reader.execute(reopened.sessionId,item.id,'return '+read,reopened.unitId)).value,accepted,'saved original reopens with accepted content')
    if(process.env.MOKI_REVIEW_SCREENSHOTS)await page.screenshot({path:join(process.env.MOKI_REVIEW_SCREENSHOTS,spec.format+'-accepted.png')})
    await page.close();t.diagnostic(spec.format+' native review UI passed')
  }
})

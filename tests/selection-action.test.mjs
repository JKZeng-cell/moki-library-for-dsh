import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import puppeteer from 'puppeteer-core'
import {createRuntime} from '../lib/host.mjs'
import {browserExecutables} from '../src/preview-browser.mjs'
import {insertSelectionQuote} from '../src/selection-quote.js'
import {selectionQuote} from '../src/selection-context.js'

test('quick quotes wait for native input, preserve drafts and insert each selection only once',()=>{
  const selection={label:'document.txt · Line 2',content:JSON.stringify({selectedText:'EXACT SECOND OCCURRENCE',selectionLocation:{kind:'text',start:9,end:32,line:2}})}
  const request={id:'quote-1',selection},input={phase:'plain',draft:'Please keep this question.\n'}
  let writes=0,persists=0
  const actions={insertQuote(text){writes++;input.draft+='> '+text;return true},persistDraft(){persists++}}
  assert.equal(insertSelectionQuote(request,{phase:'pending'},actions,selectionQuote),null)
  assert.deepEqual(insertSelectionQuote(request,input,actions,selectionQuote),{added:true})
  assert.match(input.draft,/^Please keep this question\./)
  assert.ok(input.draft.includes(selectionQuote(selection)))
  assert.deepEqual(insertSelectionQuote(request,input,actions,selectionQuote),{added:true})
  assert.equal(writes,1);assert.equal(persists,1)
  assert.deepEqual(insertSelectionQuote({id:'empty',selection:null},input,actions,selectionQuote),{added:false})
  assert.equal(writes,1)
})

test('Word canvas selections show an anchored quick action and quote exact UTF-16 positions without changing the document',{timeout:90000},async t=>{
  const dir=await mkdtemp(join(tmpdir(),'moki-word-quote-')),runtime=await createRuntime({dataDir:dir,sourceDb:null})
  const browser=await puppeteer.launch({executablePath:(await browserExecutables())[0],headless:true,pipe:true})
  t.after(async()=>{await browser.close();await runtime.close();await rm(dir,{recursive:true,force:true})})
  const {item}=await runtime.api('word','POST','/api/library/files',{name:'quote.docx',format:'docx',content:'REPEAT WORD\nKeep the middle\nREPEAT WORD'})
  const original=await readFile(item.target),{session}=await runtime.api('word','POST','/api/library/items/'+item.id+'/univer-session',{})
  const page=await browser.newPage();await page.setViewport({width:1000,height:760});await page.goto(session.viewerUrl+'&lang=en-US')
  await page.waitForFunction(()=>window.univerAPI?.getActiveDocument?.())
  await page.evaluate(()=>window.postMessage({type:'moki:univer-theme',dark:true,locale:'en-US'},location.origin))
  await page.waitForFunction(()=>univerAPI.isDarkMode())
  // The facade is exposed before the initial canvas focus/layout settles.
  await page.waitForSelector('[data-u-comp="editor"]')
  await page.evaluate(()=>document.fonts.ready)
  await new Promise(r=>setTimeout(r,1500))
  const selected=await page.evaluate(()=>{
    const doc=univerAPI.getActiveDocument(),body=doc.getBody().dataStream,start=body.lastIndexOf('REPEAT WORD')
    window.qaCompose=[];window.addEventListener('message',e=>{if(e.data?.type==='moki:univer-compose-shortcut')qaCompose.push(e.data)})
    return {start,body}
  })
  await page.mouse.click(120,320);await page.keyboard.press('Home');await page.keyboard.down('Shift');await page.keyboard.press('End');await page.keyboard.up('Shift')
  await page.waitForSelector('[data-selection-chat-action]',{visible:true})
  const action=await page.$eval('[data-selection-chat-action]',e=>({label:e.getAttribute('aria-label'),box:e.getBoundingClientRect().toJSON()}))
  assert.equal(action.label,'Quote selection in DSH');assert.ok(action.box.top>124&&action.box.bottom<760)
  await page.click('[data-selection-chat-action]');await page.waitForFunction(()=>qaCompose.length)
  const result=await page.evaluate(()=>qaCompose.at(-1));assert.equal(result.quoteSelection,true)
  assert.equal(result.editorSelection.selectedText,'REPEAT WORD');assert.equal(result.editorSelection.startOffset,selected.start);assert.equal(result.editorSelection.endOffset,selected.start+11)
  assert.equal(await page.evaluate(()=>univerAPI.getActiveDocument().getBody().dataStream),selected.body)
  assert.deepEqual(await readFile(item.target),original)
  await page.close()
})

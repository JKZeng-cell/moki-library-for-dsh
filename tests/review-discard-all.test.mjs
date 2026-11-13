import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import puppeteer from 'puppeteer-core'
import {createRuntime} from '../lib/host.mjs'
import {browserExecutables} from '../src/preview-browser.mjs'

async function fixture(t){
  const dir=await mkdtemp(join(tmpdir(),'moki-discard-all-')),runtime=await createRuntime({dataDir:dir,sourceDb:null})
  const browser=await puppeteer.launch({executablePath:(await browserExecutables())[0],headless:true,pipe:true})
  t.after(async()=>{await browser.close();await runtime.close();await rm(dir,{recursive:true,force:true})})
  const open=async item=>{
    const connection=runtime.openFrame('moki-document-'+item.id,'dsh-app://app',item.id),page=await browser.newPage()
    await page.setViewport({width:900,height:700})
    await page.goto(connection.url+'?'+new URLSearchParams({document:item.id,parent:new URL(connection.url).origin,bridge:'discard-all'}))
    await page.evaluate(()=>window.postMessage({bridge:'discard-all',type:'surface',active:true,mode:'sidebar',dark:true},location.origin))
    return page
  }
  return {runtime,open}
}

test('HTML discard-all button restores the manual baseline and persists it without saving the source',{timeout:30000},async t=>{
  const {runtime,open}=await fixture(t)
  const source='<h1>Original</h1><p>Keep</p>',manual=source.replace('Original','Manual edit'),first=manual.replace('Keep','AI one'),second=first.replace('AI one','AI two')
  const {item}=await runtime.api('files','POST','/api/library/files',{name:'Discard.html',format:'html',content:source})
  const owner='moki-document-'+item.id,route=`/api/library/items/${item.id}/draft`,version=(await runtime.api(owner,'GET',`/api/library/items/${item.id}/content`)).version
  await runtime.api(owner,'PUT',route,{content:second,version,review:[manual,first].map((before,i)=>({id:randomUUID(),sequence:i+1,createdAt:new Date().toISOString(),before}))})
  const page=await open(item)
  await page.waitForSelector('[data-review-action="reject-all"]')
  await page.setViewport({width:390,height:650})
  const button=await page.$('[data-review-action="reject-all"]'),box=await button.boundingBox()
  assert.ok(box.x>=0&&box.x+box.width<=390,'all review actions must fit a narrow side workspace')
  await button.click();await page.waitForFunction(()=>!document.querySelector('.moki-edit-review'))
  await page.waitForFunction(()=>document.querySelector('[data-moki-html-preview]')?.contentDocument?.querySelector('p')?.textContent==='Keep')
  assert.equal(await readFile(item.target,'utf8'),source)
  const retained=(await runtime.api(owner,'GET',route)).draft
  assert.equal(retained.content,manual);assert.deepEqual(retained.review,[])
  await page.close()
  const reopened=await open(item)
  await reopened.waitForFunction(()=>document.querySelector('[data-moki-html-preview]')?.contentDocument?.querySelector('h1')?.textContent==='Manual edit')
  assert.equal(await reopened.$('.moki-edit-review'),null)
})

test('Office discard-all uses one atomic action on current hosts and guarded steps on legacy hosts',{timeout:120000},async t=>{
  const {runtime,open}=await fixture(t)
  for(const legacy of [false,true]){
    const {item}=await runtime.api('files','POST','/api/library/files',{name:legacy?'Legacy.xlsx':'Current.xlsx',format:'xlsx',columns:['Value'],rows:[[1]]})
    const original=await readFile(item.target),owner='moki-document-'+item.id,page=await open(item),actions=[]
    await page.setRequestInterception(true)
    page.on('request',async request=>{
      const url=new URL(request.url())
      if(!/\/univer-session\/[^/]+\/review$/.test(url.pathname))return request.continue()
      if(request.method()==='POST')actions.push(JSON.parse(request.postData()))
      if(legacy&&request.method()==='GET'){
        const response=await fetch(request.url(),{headers:request.headers()}),body=await response.json();delete body.capabilities
        return request.respond({status:response.status,contentType:'application/json',body:JSON.stringify(body)})
      }
      return request.continue()
    })
    await page.waitForSelector('[aria-label="编辑 Office"]');await page.click('[aria-label="编辑 Office"]')
    const office=await runtime.office(owner)
    const editor=await new Promise((resolve,reject)=>{
      const until=Date.now()+20000
      const check=()=>{const editor=runtime.session(owner).editors.list().find(e=>e.mode==='office');if(editor)return resolve(editor);if(Date.now()>until)return reject(Error('Editor missing'));setTimeout(check,80)};check()
    })
    const officeFrame=await (await page.waitForSelector('[data-office-editor]')).contentFrame()
    await officeFrame.waitForFunction(()=>Boolean(window.univerAPI?.getActiveWorkbook?.()))
    const write=value=>office.execute(editor.sessionId,item.id,`univerAPI.getActiveWorkbook().getActiveSheet().getRange('A2').setValue(${value})`)
    await write(7)
    const first=await office.reviewedEdit(editor.sessionId,item.id,()=>write(8))
    const second=await office.reviewedEdit(editor.sessionId,item.id,()=>write(9))
    await page.waitForSelector('[data-review-action="reject-all"]:not(:disabled)')
    await page.click('[data-review-action="reject-all"]')
    try{await page.waitForFunction(()=>!document.querySelector('.moki-edit-review'))}
    catch(error){t.diagnostic(JSON.stringify({legacy,actions,review:office.reviewStatus(editor.sessionId,item.id),notice:await page.$eval('.dsh-preview',el=>el.textContent).catch(()=>null)}));throw error}
    assert.equal((await office.execute(editor.sessionId,item.id,"return univerAPI.getActiveWorkbook().getActiveSheet().getRange('A2').getValue()")).value,7)
    assert.deepEqual(actions.map(a=>[a.action,a.expectedId]),legacy?[['reject',second.review.id],['reject',first.review.id]]:[['reject_all',second.review.id]])
    assert.equal(office.reviewStatus(editor.sessionId,item.id).entries.length,0)
    assert.deepEqual(await readFile(item.target),original)
    await page.close()
  }
})

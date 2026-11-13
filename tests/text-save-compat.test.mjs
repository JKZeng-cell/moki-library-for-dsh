import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash,randomUUID} from 'node:crypto'
import {mkdtemp,readFile,writeFile,stat,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {build} from 'esbuild'
import puppeteer from 'puppeteer-core'
import {createRuntime} from '../lib/host.mjs'
import {browserExecutables} from '../src/preview-browser.mjs'

const bundle=await build({entryPoints:['vendor/moki/web/lib/text-content-save.ts'],bundle:true,write:false,platform:'node',format:'esm'})
const {saveTextContent}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'))
const hash=text=>createHash('sha256').update(text).digest('hex')
const json=(status,body)=>Response.json(body,{status})
const input={content:'Changed',baseContent:'Original',expectedVersion:hash('Original')}
const saved={saved:true,version:hash(input.content),size:7,updatedAt:new Date().toISOString()}
const invalid=()=>json(400,{error:'文本保存参数无效'})
const conflict=()=>json(409,{error:'文件已被其他操作修改'})

test('text save retains new-host reconciliation and supports old strict hosts without removing the version guard',async()=>{
  const calls=[]
  const modern=await saveTextContent(async(url,init)=>{calls.push(JSON.parse(init.body));return json(200,{...saved,content:'Merged',reconciled:true})},'/content',input,'Save failed')
  assert.equal(modern.content,'Merged');assert.equal(modern.reconciled,true);assert.deepEqual(calls,[input])
  calls.length=0
  const legacy=await saveTextContent(async(url,init)=>{
    const body=JSON.parse(init.body);calls.push(body)
    return Object.hasOwn(body,'baseContent')?invalid():json(200,saved)
  },'/content',input,'Save failed')
  assert.deepEqual(legacy,saved)
  assert.deepEqual(calls,[input,{content:input.content,expectedVersion:input.expectedVersion}])
})

test('already persisted drafts are accepted by verified readback without a second write or changed version guard',async()=>{
  const calls=[]
  const result=await saveTextContent(async(url,init)=>{
    calls.push(init)
    if(init.method==='PUT')return Object.hasOwn(JSON.parse(init.body),'baseContent')?invalid():conflict()
    return json(200,{...saved,content:input.content})
  },'/content',input,'Save failed')
  assert.equal(result.unchanged,true);assert.equal(result.version,saved.version)
  assert.equal(calls.length,3);assert.equal(calls[2].cache,'no-store')
  assert.ok(calls.filter(c=>c.method==='PUT').every(c=>JSON.parse(c.body).expectedVersion===input.expectedVersion))
})

test('different source contents and failed readback keep the conflict instead of force-saving',async()=>{
  for(const read of [()=>json(200,{...saved,content:'Other edit'}),()=>json(503,{}),()=>{throw Error('offline')},()=>json(200,{content:input.content})]){
    const calls=[]
    await assert.rejects(saveTextContent(async(url,init)=>{calls.push(init);return init.method==='PUT'?conflict():read()},'/content',input,'Save failed'),/文件已被其他操作修改/)
    assert.equal(calls.filter(c=>c.method==='PUT').length,1)
    assert.equal(JSON.parse(calls[0].body).expectedVersion,input.expectedVersion)
  }
})

test('unrelated validation, size and network failures are not replayed; the legacy retry is bounded',async()=>{
  for(const failure of [()=>json(400,{error:'映射目标不是文件'}),()=>json(413,{error:'Too large'}),()=>{throw Error('offline')}]){
    let calls=0
    await assert.rejects(saveTextContent(async()=>{calls++;return failure()},'/content',input,'Save failed'))
    assert.equal(calls,1)
  }
  let calls=0
  await assert.rejects(saveTextContent(async()=>{calls++;return invalid()},'/content',input,'Save failed'),/文本保存参数无效/)
  assert.equal(calls,2)
})

test('restored HTML reviews accept against a legacy host without refreshing, and preserve true conflicts',{timeout:60000},async t=>{
  const dir=await mkdtemp(join(tmpdir(),'moki-accept-compat-')),runtime=await createRuntime({dataDir:dir,sourceDb:null})
  const browser=await puppeteer.launch({executablePath:(await browserExecutables())[0],headless:true,pipe:true})
  t.after(async()=>{await browser.close();await runtime.close();await rm(dir,{recursive:true,force:true})})
  const base='<h1>Original</h1><p>Keep</p><div style="height:1800px"></div>'
  const draft=base.replace('Original','AI result')
  for(const alreadySaved of [true,false]){
    const {item}=await runtime.api('files','POST','/api/library/files',{name:alreadySaved?'Saved.html':'Conflict.html',format:'html',content:base})
    const owner='moki-document-'+item.id,route=`/api/library/items/${item.id}/content`
    const version=(await runtime.api(owner,'GET',route)).version
    const review=Array.from({length:3},(_,i)=>({id:randomUUID(),sequence:i+1,createdAt:new Date().toISOString(),before:base}))
    await runtime.api(owner,'PUT',`/api/library/items/${item.id}/draft`,{content:draft,version,review})
    const source=alreadySaved?draft:base.replace('Original','External result')
    await writeFile(item.target,source)
    const modified=(await stat(item.target)).mtimeMs
    const connection=runtime.openFrame(owner,'dsh-app://app',item.id),page=await browser.newPage(),puts=[]
    await page.setViewport({width:1050,height:800})
    await page.setRequestInterception(true)
    page.on('request',async request=>{
      if(request.method()!=='PUT'||!new URL(request.url()).pathname.endsWith(route))return request.continue()
      const body=JSON.parse(request.postData());puts.push(body)
      // Match the pre-0.1.72 contract: reject unknown keys, then check version
      // before writing, even when the desired bytes are already on disk.
      if(Object.keys(body).some(key=>!['content','expectedVersion'].includes(key)))return request.respond({status:400,contentType:'application/json',body:JSON.stringify({error:'文本保存参数无效'})})
      const current=await runtime.api(owner,'GET',route)
      if(body.expectedVersion!==current.version)return request.respond({status:409,contentType:'application/json',body:JSON.stringify({error:'文件已被其他操作修改'})})
      const result=await runtime.api(owner,'PUT',route,body)
      return request.respond({status:200,contentType:'application/json',body:JSON.stringify(result)})
    })
    await page.goto(connection.url+'?'+new URLSearchParams({document:item.id,parent:new URL(connection.url).origin,bridge:'accept-compat'}))
    await page.evaluate(()=>window.postMessage({bridge:'accept-compat',type:'surface',active:true,mode:'sidebar',dark:true},location.origin))
    await page.waitForSelector('.moki-review-buttons [data-primary]')
    await page.waitForFunction(()=>document.querySelector('[data-moki-html-preview]')?.contentDocument?.querySelector('h1')?.textContent==='AI result')
    await page.evaluate(()=>{const frame=document.querySelector('[data-moki-html-preview]');window.beforeAccept=frame.contentDocument;frame.contentWindow.scrollTo(0,180)})
    await page.click('.moki-review-buttons [data-primary]')
    if(alreadySaved){
      await page.waitForFunction(()=>!document.querySelector('.moki-edit-review'))
      assert.equal((await runtime.api(owner,'GET',`/api/library/items/${item.id}/draft`)).draft,null)
      assert.equal(await page.evaluate(()=>document.querySelector('[data-moki-html-preview]').contentWindow.CSS.highlights.get('moki-ai-edit')?.size??0),0)
    }else{
      await page.waitForFunction(()=>document.body.textContent.includes('文件已被其他操作修改'))
      assert.equal(await page.$eval('.moki-review-label',node=>node.textContent),'3 次修改待确认')
      const retained=(await runtime.api(owner,'GET',`/api/library/items/${item.id}/draft`)).draft
      assert.equal(retained.content,draft);assert.equal(retained.review.length,3)
    }
    assert.equal(await page.evaluate(()=>document.querySelector('[data-moki-html-preview]').contentDocument===window.beforeAccept),true)
    assert.equal(await page.evaluate(()=>document.querySelector('[data-moki-html-preview]').contentWindow.scrollY),180)
    assert.equal(await readFile(item.target,'utf8'),source)
    assert.equal((await stat(item.target)).mtimeMs,modified)
    assert.deepEqual(puts,[{content:draft,expectedVersion:version,baseContent:source},{content:draft,expectedVersion:version}])
    const reopened=runtime.openFrame(owner,'dsh-app://app',item.id)
    await page.goto(reopened.url+'?'+new URLSearchParams({document:item.id,parent:new URL(reopened.url).origin,bridge:'accept-compat'}))
    await page.evaluate(()=>window.postMessage({bridge:'accept-compat',type:'surface',active:true,mode:'sidebar',dark:true},location.origin))
    await page.waitForFunction(()=>document.querySelector('[data-moki-html-preview]')?.contentDocument?.querySelector('h1')?.textContent==='AI result')
    assert.equal(Boolean(await page.$('.moki-edit-review')),!alreadySaved)
    await page.close()
  }
})

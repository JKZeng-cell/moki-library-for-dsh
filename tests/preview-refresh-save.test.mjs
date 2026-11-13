import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,writeFile,stat,utimes,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import puppeteer from 'puppeteer-core'
import {createRuntime} from '../lib/host.mjs'
import {browserExecutables} from '../src/preview-browser.mjs'

async function fixture(t){
  const dir=await mkdtemp(join(tmpdir(),'moki-refresh-save-')),runtime=await createRuntime({dataDir:dir,sourceDb:null})
  t.after(async()=>{await runtime.close();await rm(dir,{recursive:true,force:true})})
  return {dir,runtime,api:(method,path,body)=>runtime.api('refresh-save',method,path,body)}
}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function eventually(check){const until=Date.now()+20000;while(Date.now()<until){const result=await check();if(result)return result;await pause(80)}throw Error('Expected editor state did not arrive')}

test('text saves reconcile already-saved and independent changes, but retain true conflicts',async t=>{
  const {api}=await fixture(t)
  const base='Heading\nFirst: original\nKeep this line\nLast: original\n'
  const {item}=await api('POST','/api/library/files',{name:'reconcile.html',format:'html',content:base})
  const route=`/api/library/items/${item.id}/content`,before=await api('GET',route)
  const remote=before.content.replace('First: original','First: remote')
  await writeFile(item.target,remote)
  const modified=(await stat(item.target)).mtimeMs
  const duplicate=await api('PUT',route,{content:remote,expectedVersion:before.version})
  assert.equal(duplicate.unchanged,true);assert.equal((await stat(item.target)).mtimeMs,modified)
  const untouched=await api('PUT',route,{content:before.content,baseContent:before.content,expectedVersion:before.version})
  assert.equal(untouched.content,remote);assert.equal(untouched.unchanged,true)
  const local=before.content.replace('Last: original','Last: local')
  const merged=await api('PUT',route,{content:local,baseContent:before.content,expectedVersion:before.version})
  assert.equal(merged.content,remote.replace('Last: original','Last: local'))
  assert.equal(await readFile(item.target,'utf8'),merged.content)
  const original=await readFile(item.target)
  await assert.rejects(api('PUT',route,{content:before.content.replace('First: original','First: other'),baseContent:before.content,expectedVersion:before.version}),/修改/)
  await assert.rejects(api('PUT',route,{content:'overwrite',baseContent:remote,expectedVersion:before.version}),/修改/)
  assert.deepEqual(await readFile(item.target),original)
})

test('Office duplicate saves, timestamp-only updates, and untouched stale editors preserve the latest source',{timeout:180000},async t=>{
  const {runtime,api}=await fixture(t),office=await runtime.office('refresh-save')
  for(const spec of [
    {name:'Repeat.xlsx',format:'xlsx',columns:['Value'],rows:[[1]],write:v=>`univerAPI.getActiveWorkbook().getActiveSheet().getRange('A2').setValue(${v})`},
    {name:'Repeat.docx',format:'docx',content:'Original\nKeep',write:v=>`const activeDocument=univerAPI.getActiveDocument();activeDocument.getTextRange(0,activeDocument.getBody().dataStream.indexOf('\\r')).setText('Value ${v}')`},
    {name:'Repeat.pptx',format:'pptx',slides:[{title:'Original',paragraphs:['Keep']}],write:v=>`const text=univerAPI.getActivePresentation().getSlideById('slide-1').getShape('shape-2').getText(),rich=text.getRichText().copy();rich.getTextRuns()[0].setText('Value ${v}');text.setRichText(rich)`},
  ]){
    const {write,...input}=spec,{item}=await api('POST','/api/library/files',input),original=await readFile(item.target)
    const session=await office.open(item.id,item.target,item.name)
    const edit=v=>office.reviewedEdit(session.sessionId,item.id,()=>office.execute(session.sessionId,item.id,write(v)))
    const first=await edit(2),exported=await office.exportDraft(session.sessionId,item.id)
    const externallySaved=await readFile(exported.path)
    await writeFile(item.target,externallySaved)
    const timestamp=(await stat(item.target)).mtimeMs
    const accepted=await office.resolveReview(session.sessionId,item.id,'accept',first.review.id,{save:true})
    assert.equal(accepted.saved,true);assert.equal(accepted.unchanged,true)
    assert.equal(accepted.session.viewerUrl,session.viewerUrl)
    assert.equal((await stat(item.target)).mtimeMs,timestamp,'duplicate acceptance must not rewrite the source')
    await utimes(item.target,new Date(),new Date(Date.now()+5000))
    const next=await edit(3)
    await office.resolveReview(session.sessionId,item.id,'accept',next.review.id,{save:true})
    await office.discard(session.sessionId,item.id)
    const untouched=await office.open(item.id,item.target,item.name)
    await writeFile(item.target,original)
    const result=await office.save(untouched.sessionId,item.id)
    assert.equal(result.sourceUpdated,true)
    assert.deepEqual(await readFile(item.target),original,'unchanged stale editor must not replace the external file')
    t.diagnostic(spec.format+' already-saved acceptance and source synchronization passed')
  }
})

test('Office detects an external save that arrives during export and retains the review',{timeout:90000},async t=>{
  const {runtime,api}=await fixture(t),office=await runtime.office('refresh-save')
  const {item}=await api('POST','/api/library/files',{name:'Race.xlsx',format:'xlsx',columns:['Value'],rows:[[1]]})
  const {item:remote}=await api('POST','/api/library/files',{name:'Remote.xlsx',format:'xlsx',columns:['Value'],rows:[[99]]})
  const replacement=await readFile(remote.target),session=await office.open(item.id,item.target,item.name)
  const pending=await office.reviewedEdit(session.sessionId,item.id,()=>office.execute(session.sessionId,item.id,"univerAPI.getActiveWorkbook().getActiveSheet().getRange('A2').setValue(2)"))
  const exportUnitContent=office.service.exportUnitContent.bind(office.service)
  office.service.exportUnitContent=async input=>{const result=await exportUnitContent(input);await writeFile(item.target,replacement);return result}
  await assert.rejects(office.resolveReview(session.sessionId,item.id,'accept',pending.review.id,{save:true}),/修改/)
  assert.deepEqual(await readFile(item.target),replacement)
  assert.equal(office.reviewStatus(session.sessionId,item.id).entries.at(-1).id,pending.review.id)
})

test('preview refresh reloads HTML and media, protects drafts, and saves an externally persisted draft',{timeout:90000},async t=>{
  const {dir,runtime,api}=await fixture(t),browser=await puppeteer.launch({executablePath:(await browserExecutables())[0],headless:true,pipe:true})
  t.after(()=>browser.close())
  const {item}=await api('POST','/api/library/files',{name:'Refresh.html',format:'html',content:'<h1>Original</h1><p>Keep</p>'})
  const owner='moki-document-'+item.id,connection=runtime.openFrame(owner,'dsh-app://app',item.id),page=await browser.newPage()
  await page.setViewport({width:1000,height:750})
  const errors=[];page.on('pageerror',e=>errors.push(e.message))
  await page.goto(connection.url+'?'+new URLSearchParams({document:item.id,parent:new URL(connection.url).origin,bridge:'refresh-ui'}))
  await page.evaluate(()=>window.postMessage({bridge:'refresh-ui',type:'surface',active:true,mode:'sidebar',dark:true},location.origin))
  const heading=()=>page.$eval('[data-moki-html-preview]',el=>el.contentDocument?.querySelector('h1')?.textContent).catch(()=>undefined)
  await eventually(async()=>await heading()==='Original')
  await writeFile(item.target,'<h1>External update</h1><p>Keep</p>')
  await page.click('[aria-label="刷新预览"]');await eventually(async()=>await heading()==='External update')
  await writeFile(item.target,'<h1>DSH file notification</h1><p>Keep</p>')
  assert.deepEqual(await runtime.taskFiles.changed([item.target]),[item.id])
  await eventually(async()=>await heading()==='DSH file notification')
  if(process.env.MOKI_REFRESH_SCREENSHOTS)await page.screenshot({path:join(process.env.MOKI_REFRESH_SCREENSHOTS,'refresh-html-dark.png')})
  await page.click('[aria-label="编辑"]');await page.waitForSelector('.moki-review-text-editor textarea,textarea')
  const change=async value=>{await page.focus('textarea');await page.keyboard.down('Control');await page.keyboard.press('KeyA');await page.keyboard.up('Control');await page.keyboard.type(value)}
  const draft='<h1>DSH saved</h1><p>Keep</p>'
  await change(draft);await writeFile(item.target,draft)
  await page.click('[aria-label="刷新预览"]');await page.waitForSelector('#library-save-title')
  if(process.env.MOKI_REFRESH_SCREENSHOTS){
    await page.screenshot({path:join(process.env.MOKI_REFRESH_SCREENSHOTS,'refresh-draft-dark.png')})
    await page.setViewport({width:440,height:650})
    await page.evaluate(()=>window.postMessage({bridge:'refresh-ui',type:'surface',active:true,mode:'sidebar',dark:false},location.origin))
    await page.screenshot({path:join(process.env.MOKI_REFRESH_SCREENSHOTS,'refresh-draft-light-narrow.png')})
    await page.setViewport({width:1000,height:750})
  }
  const click=label=>page.evaluate(label=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent===label);if(!button||button.disabled)throw Error('Missing action '+label);button.click()},label)
  await click('继续编辑');assert.equal(await page.$eval('textarea',el=>el.value),draft)
  await page.click('[aria-label="刷新预览"]');await click('保存并刷新')
  await eventually(async()=>await heading()==='DSH saved')
  assert.equal(await readFile(item.target,'utf8'),draft)
  await page.click('[aria-label="编辑"]');await change('<h1>Unsaved</h1>')
  await writeFile(item.target,'<h1>Latest on disk</h1>')
  await page.click('[aria-label="刷新预览"]');await click('放弃草稿并刷新')
  await eventually(async()=>await heading()==='Latest on disk')
  assert.equal((await runtime.api(owner,'GET',`/api/library/items/${item.id}/draft`)).draft,null)
  const svg=join(dir,'Refresh.svg');await writeFile(svg,'<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="red"/></svg>')
  const image=runtime.repository.create({kind:'local_file',name:'Refresh.svg',target:svg,tags:[]}),view=runtime.openFrame('moki-document-'+image.id,'dsh-app://app',image.id)
  await page.goto(view.url+'?'+new URLSearchParams({document:image.id,parent:new URL(view.url).origin,bridge:'refresh-image'}))
  await page.waitForSelector('.dsh-preview-content img')
  const previous=await page.$eval('.dsh-preview-content img',el=>el.src)
  await writeFile(svg,(await readFile(svg,'utf8')).replace('red','blue'))
  await page.click('[aria-label="刷新预览"]')
  await page.waitForFunction(previous=>document.querySelector('.dsh-preview-content img')?.src!==previous,{},previous)
  assert.match(await page.$eval('.dsh-preview-content img',el=>fetch(el.src).then(r=>r.text())),/blue/)
  assert.deepEqual(errors,[])
})

import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {build} from 'esbuild'
import puppeteer from 'puppeteer-core'
import {apply} from '../lib/host.mjs'
import {browserExecutables} from '../src/preview-browser.mjs'

async function fixture(t) {
  const dir=await mkdtemp(join(tmpdir(),'moki-html-')),tools=new Map(),cleanup=[];let endpoint
  const ctx={effect(fn){const close=fn();if(typeof close==='function')cleanup.push(close)},webServer:{register(route){if(route.path==='/moki-library/open')endpoint=route.resource}},tools:{register(tool){tools.set(tool.name,tool)}},approval:{async request(){return 'allowed-once'}},attachments:{},systemPrompt:{section(){},context(){}},on(){},inject(){}}
  await apply(ctx,{dataDir:dir,sourceDb:null})
  const [executablePath]=await browserExecutables(),browser=await puppeteer.launch({executablePath,headless:true,pipe:true})
  t.after(async()=>{await browser.close();for(const close of cleanup.reverse())await close();await rm(dir,{recursive:true,force:true})})
  const invoke=(name,args={})=>tools.get('moki_library_'+name).execute(args,{agent:{session:{id:'html-chat'}},callId:'html-test'})
  const open=async item=>{
    const frame=await (await endpoint(new Request('http://localhost/moki-library/open?'+new URLSearchParams({session:'moki-document-'+item.id,parent:'dsh-app://app',document:item.id}),{headers:{'x-moki-library':'1'}}))).json()
    const origin=new URL(frame.url).origin,page=await browser.newPage();await page.setViewport({width:1000,height:750})
    await page.goto(frame.url+'?'+new URLSearchParams({document:item.id,parent:origin,bridge:'html-qa',chatId:'html-chat'}))
    await page.evaluate(()=>window.postMessage({bridge:'html-qa',type:'surface',active:true,mode:'sidebar',dark:true},location.origin))
    await page.waitForSelector('[data-moki-html-preview]');return page
  }
  return {dir,invoke,open}
}
async function waitFor(fn){const end=Date.now()+8000;while(Date.now()<end){const result=await fn();if(result)return result;await new Promise(r=>setTimeout(r,50))}throw Error('HTML selection did not synchronize')}

test('HTML preview quotes precise nodes, reviews edits and saves without reloading on accept',{timeout:45000},async t=>{
  const {dir,invoke,open}=await fixture(t),target=join(dir,'selection.html')
  const source='<!doctype html><style>body{padding:20px}p{margin-top:50px}</style><h1>same</h1><p id="chosen">same <b>A &amp; B</b> tail</p><div style="height:1800px">KEEP</div><script>parent.htmlEscaped=true</script><img src="invalid" onerror="parent.htmlEscaped=true">'
  await writeFile(target,source)
  const item=await invoke('manage',{action:'create',kind:'local_file',name:'selection.html',target})
  let page=await open(item)
  await page.waitForFunction(()=>document.querySelector('[data-moki-html-preview]').contentDocument?.querySelector('#chosen'))
  const select=async()=>page.evaluate(()=>{
    const doc=document.querySelector('[data-moki-html-preview]').contentDocument,p=doc.querySelector('#chosen'),range=doc.createRange()
    range.setStart(p.firstChild,0);range.setEnd(p.querySelector('b').firstChild,5)
    const selection=doc.getSelection();selection.removeAllRanges();selection.addRange(range);doc.dispatchEvent(new Event('selectionchange'))
  })
  await select()
  await page.waitForSelector('.moki-selection-chat-action')
  let context=await waitFor(async()=>{const c=await invoke('context');return c.selectionRef?c:null})
  assert.equal(context.selection.text,'same A & B');assert.equal(context.selection.location.element,'#chosen')
  await page.click('.moki-selection-chat-action')
  await page.waitForSelector('.moki-selection-composer')
  assert.ok(await page.$('.moki-selection-composer input[type="file"]'))
  assert.equal(await page.evaluate(()=>window.htmlEscaped),undefined,'HTML scripts and inline handlers remain sandboxed')
  context=await invoke('context');assert.equal(context.selection.text,'same A & B')
  await page.click('[aria-label="关闭快捷输入"]')
  const result=await invoke('edit_selection',{selectionRef:context.selectionRef,text:'Changed <safe> & 🙂'})
  assert.equal(result.review.status,'pending')
  await page.waitForFunction(()=>document.querySelector('[data-moki-html-preview]').contentDocument?.querySelector('#chosen')?.textContent==='Changed <safe> & 🙂 tail')
  assert.equal(await readFile(target,'utf8'),source)
  assert.equal(await page.evaluate(()=>document.querySelector('[data-moki-html-preview]').contentDocument.querySelector('h1').textContent),'same')
  assert.ok(await page.evaluate(()=>document.querySelector('[data-moki-html-preview]').contentWindow.CSS.highlights.get('moki-ai-edit').size))
  await page.evaluate(()=>{const doc=document.querySelector('[data-moki-html-preview]').contentDocument,range=doc.createRange();range.setStart(doc.querySelector('#chosen').firstChild,0);range.setEnd(doc.querySelector('#chosen').firstChild,7);doc.getSelection().removeAllRanges();doc.getSelection().addRange(range);doc.dispatchEvent(new Event('selectionchange'))})
  const second=await waitFor(async()=>{const c=await invoke('context');return c.selection?.text==='Changed'&&c.selectionRef?c:null})
  const revised=await invoke('edit_selection',{selectionRef:second.selectionRef,text:'Revised'})
  assert.equal(revised.review.pending,2)
  await page.waitForFunction(()=>document.querySelector('[data-moki-html-preview]').contentDocument?.querySelector('#chosen')?.textContent.startsWith('Revised'))
  await page.click('.moki-review-buttons button:not([data-primary])')
  await page.waitForFunction(()=>document.querySelector('[data-moki-html-preview]').contentDocument?.querySelector('#chosen')?.textContent.startsWith('Changed'))
  assert.equal(await page.$eval('.moki-review-label',e=>e.textContent),'1 次修改待确认')
  await assert.rejects(invoke('edit_selection',{selectionRef:second.selectionRef,text:'STALE'}),/失效|变化/)
  await page.evaluate(()=>{const frame=document.querySelector('[data-moki-html-preview]');window.htmlBeforeAccept=frame.contentDocument;frame.contentWindow.scrollTo(0,160)})
  await page.click('.moki-review-buttons [data-primary]')
  await page.waitForFunction(()=>!document.querySelector('.moki-edit-review'))
  assert.equal(await page.evaluate(()=>document.querySelector('[data-moki-html-preview]').contentDocument===window.htmlBeforeAccept),true)
  assert.equal(await page.evaluate(()=>document.querySelector('[data-moki-html-preview]').contentWindow.scrollY),160)
  const saved=await readFile(target,'utf8');assert.ok(saved.includes('Changed &lt;safe&gt; &amp; 🙂<b></b> tail'));assert.ok(saved.includes('<h1>same</h1>'))
  await page.close();page=await open(item)
  await page.waitForFunction(()=>document.querySelector('[data-moki-html-preview]').contentDocument?.querySelector('#chosen')?.textContent==='Changed <safe> & 🙂 tail')
})

test('HTML mapping guards stale or excluded nodes and preserves entity text and markup',async()=>{
  const bundle=await build({entryPoints:['vendor/moki/web/lib/html-selection.ts'],bundle:true,write:false,platform:'node',format:'esm'})
  const {htmlTextNodes,replaceHtmlSelection}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'))
  const source='<script>same</script><p>same &amp; more</p><p>same</p>'
  const nodes=htmlTextNodes(source);assert.equal(nodes.length,2)
  const selection={segments:[{start:nodes[1].start,end:nodes[1].end,from:0,to:4}],expectedText:'same'}
  assert.equal(replaceHtmlSelection(source,selection,'x < y'),'<script>same</script><p>same &amp; more</p><p>x &lt; y</p>')
  assert.throws(()=>replaceHtmlSelection(source,{...selection,expectedText:'stale'},'bad'))
  assert.throws(()=>replaceHtmlSelection(source,{segments:[{start:8,end:12,from:0,to:4}],expectedText:'same'},'bad'))
  assert.throws(()=>replaceHtmlSelection(source,{...selection,segments:[...selection.segments,...selection.segments]},'bad'))
})

test('HTML module mode follows the pointer, retains clicked modules and quotes exact content and source',{timeout:45000},async t=>{
  const {dir,invoke,open}=await fixture(t),target=join(dir,'modules.html')
  const source='<!doctype html><style>body{margin:0;padding:30px}section{padding:30px;border:1px solid #ccc}p{padding:12px}img{display:block;width:100px;height:80px}a{display:block;padding:20px}#space{height:1200px}</style><section id="card"><p id="text">Hello <b>module</b></p><img alt="Chart" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E"><a href="https://example.test/leave">Link</a></section><div id="space"></div>'
  await writeFile(target,source)
  const item=await invoke('manage',{action:'create',kind:'local_file',name:'modules.html',target}),page=await open(item)
  const iframe=await page.$('[data-moki-html-preview]'),frame=await iframe.contentFrame()
  await frame.waitForSelector('#text b');await page.click('[aria-label="选区模式"]')
  await frame.hover('#text b');await page.waitForSelector('[data-module-outline="hover"]')
  assert.equal(await page.$eval('[data-module-outline="hover"]',el=>el.dataset.moduleElement),'#text')
  assert.equal(await page.$('[data-module-outline="chosen"]'),null)
  await frame.click('#text b');await page.waitForSelector('[data-module-outline="chosen"]')
  let context=await waitFor(async()=>{const c=await invoke('context');return c.selection?.location?.module&&c.selectionRef?c:null})
  assert.equal(context.selection.text,'Hello module');assert.equal(context.selection.location.element,'#text')
  assert.equal(context.selection.source,'<p id="text">Hello <b>module</b></p>')
  await frame.hover('img');assert.equal(await page.$eval('[data-module-outline="chosen"]',el=>el.dataset.moduleElement),'#text')
  await page.click('.moki-selection-chat-action');await page.waitForSelector('.moki-selection-composer')
  assert.ok(await page.$('.moki-selection-composer input[type=file]'))
  await page.click('[aria-label="关闭快捷输入"]')
  const result=await invoke('edit_selection',{selectionRef:context.selectionRef,text:'Selected edit'})
  assert.equal(result.review.status,'pending')
  await frame.waitForFunction(()=>document.querySelector('#text')?.textContent==='Selected edit')
  await page.click('.moki-review-buttons [data-primary]');await page.waitForFunction(()=>!document.querySelector('.moki-edit-review'))
  assert.ok((await readFile(target,'utf8')).includes('<p id="text">Selected edit<b></b></p>'))
  await frame.click('img');await page.waitForSelector('[data-module-outline="chosen"]')
  context=await waitFor(async()=>{const c=await invoke('context');return c.selection?.source?.startsWith('<img')?c:null})
  assert.equal(context.selection.text,'');assert.match(context.selection.source,/alt="Chart"/)
  assert.equal(context.selectionRef,undefined)
  const before=await page.$eval('[data-module-outline="chosen"]',e=>e.getBoundingClientRect().top)
  await frame.evaluate(()=>scrollTo(0,25));await page.waitForFunction(y=>Math.abs(document.querySelector('[data-module-outline="chosen"]').getBoundingClientRect().top-y+25)<1,{},before)
  await frame.click('a');assert.equal(frame.url(),'about:srcdoc','Selection mode prevents link navigation')
  await page.keyboard.down('Alt');await page.keyboard.press('ArrowUp');await page.keyboard.up('Alt')
  await page.waitForFunction(()=>document.querySelector('[data-module-outline="chosen"]')?.dataset.moduleElement==='#card')
  await page.keyboard.press('Escape');await page.waitForSelector('[data-module-outline="chosen"]',{hidden:true})
  await page.click('[aria-label="选区模式"]');await frame.hover('#text')
  assert.equal(await page.$('[data-module-outline]'),null)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,rm,realpath} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createServer} from 'node:http'
import {build} from 'esbuild'
import puppeteer from 'puppeteer-core'
import {createRuntime} from '../lib/host.mjs'
import {registerGeneratedFiles} from '../src/generated-files.mjs'
import {browserExecutables} from '../src/preview-browser.mjs'

test('file context action opens folder picker, creates a colored destination and reports duplicate mappings',{timeout:45000},async t=>{
  const dir=await mkdtemp(join(tmpdir(),'moki-filing-ui-')),path=join(dir,'generated 中文.html')
  await writeFile(path,'<p>Original</p>')
  const runtime=await createRuntime({dataDir:join(dir,'data'),sourceDb:null,composerPicker:false,autoMapTaskFiles:false})
  let route
  const ctx={inject(_deps,fn){fn(this)},effect(fn){fn()},webServer:{register(value){route=value.resource}},connection:{requestRejection:()=>undefined},
    sandboxPolicy:{workspaceRoot:dir},workspaceFiles:{stat:async()=>({absolutePath:path})},fs:{processPathFromHostPath:p=>p,resolve:async p=>p,processPath:p=>p}}
  registerGeneratedFiles(ctx,runtime)
  const bundled=await build({entryPoints:['tests/fixtures/generated-file-client.js'],bundle:true,write:false,format:'iife',loader:{'.css':'text'},define:{__MOKI_LIBRARY_VERSION__:'"test"'}})
  let origin
  const server=createServer(async(req,res)=>{
    if(req.url==='/app.js'){res.setHeader('content-type','text/javascript');res.end(bundled.outputFiles[0].text)}
    else if(req.url==='/moki-library/generated-file'){
      const result=await route(new Request(origin+req.url,{headers:req.headers}));res.writeHead(result.status,Object.fromEntries(result.headers));res.end(await result.text())
    }else{res.setHeader('content-type','text/html');res.end('<!doctype html><html lang="zh" style="color-scheme:dark;--dsw-alias-bg-base:#141414;--dsw-alias-bg-layer-2:#202020;--dsw-alias-border-l1:#303030;--dsw-alias-border-l2:#444;--dsw-alias-label-secondary:#aaa;--dsw-alias-label-primary:#eee;--dsw-alias-link:#7aaaff"><body style="color:#eee;background:#141414"><div id="root"></div><script src="/app.js"></script></body></html>')}
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port
  const browser=await puppeteer.launch({executablePath:(await browserExecutables())[0],headless:true,pipe:true})
  t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));await runtime.close();await rm(dir,{recursive:true,force:true})})
  const page=await browser.newPage();await page.setViewport({width:450,height:700});await page.evaluateOnNewDocument(file=>window.qaFile=file,path)
  const errors=[];page.on('pageerror',error=>errors.push(error.message))
  await page.goto(origin+'?locale=en')
  const clickText=(selector,text)=>page.$$eval(selector,(nodes,text)=>nodes.find(el=>el.textContent===text).click(),text)
  const open=async()=>{await page.click('#file-menu');await clickText('[role=menuitem]','Add to MOKI Library');await page.waitForSelector('dialog[open]');await page.waitForFunction(()=>document.querySelector('.ml-destination-file strong')?.textContent.includes('generated')&&document.querySelector('.ml-picker-list')?.getAttribute('aria-busy')==='false')}
  await open();assert.equal(runtime.repository.list().length,0)
  await clickText('dialog button','Cancel');await page.waitForSelector('dialog',{hidden:true});assert.equal(runtime.repository.list().length,0)
  await open();await clickText('dialog button','New folder');await page.waitForSelector('[aria-label="Folder name"]');await page.type('[aria-label="Folder name"]','Campaigns')
  await page.click('[aria-label="Green"]');await page.click('button[type=submit]')
  await page.waitForFunction(()=>document.querySelector('.ml-crumbs')?.textContent.includes('Campaigns')&&!document.querySelector('.ml-destination-create'))
  await page.waitForFunction(()=>[...document.querySelectorAll('dialog button')].some(e=>e.textContent==='Add to this folder'&&!e.disabled))
  await clickText('dialog button','Add to this folder');await page.waitForSelector('.ml-destination-success')
  const folder=runtime.repository.list().find(item=>item.name==='Campaigns'),file=runtime.repository.list().find(item=>item.kind==='local_file')
  assert.equal(folder.folderColor,'green');assert.equal(file.parentId,folder.id);assert.equal(file.target,await realpath(path))
  const bounds=await page.$eval('dialog',el=>({left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,height:el.scrollHeight,client:el.clientHeight}))
  assert.ok(bounds.left>=0&&bounds.right<=450);assert.ok(bounds.height<=bounds.client+1)
  await clickText('dialog button','Done');await open();await page.waitForSelector('.ml-picker-row');await clickText('.ml-picker-row strong','Campaigns')
  await page.waitForFunction(()=>[...document.querySelectorAll('dialog button')].some(e=>e.textContent==='Add to this folder'&&!e.disabled))
  await clickText('dialog button','Add to this folder');await page.waitForSelector('.ml-destination-success')
  assert.match(await page.$eval('.ml-destination-success',el=>el.textContent),/already/);assert.equal(runtime.repository.list().length,2)
  await clickText('dialog button','Open in Library');await page.waitForFunction(()=>window.qaOpened);assert.equal(await page.evaluate(()=>qaOpened.id),file.id)
  assert.deepEqual(errors,[])
})

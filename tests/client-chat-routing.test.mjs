import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createServer} from 'node:http'
import {fileURLToPath} from 'node:url'
import {build} from 'esbuild'
import puppeteer from 'puppeteer-core'
import {createRuntime} from '../lib/host.mjs'
import {browserExecutables} from '../src/preview-browser.mjs'

test('selection quick composer sends captured instructions and attachments to the correct chat without modifying drafts',{timeout:60000},async t=>{
  const dir=await mkdtemp(join(tmpdir(),'moki-chat-routing-')),runtime=await createRuntime({dataDir:dir,sourceDb:null})
  const path=join(dir,'routing.txt');await writeFile(path,'same\r\nsame\r\nfinal')
  const item=runtime.repository.create({name:'routing.txt',kind:'local_file',target:path,tags:[]})
  const bundled=await build({entryPoints:[fileURLToPath(new URL('./fixtures/chat-routing-client.js',import.meta.url))],bundle:true,write:false,format:'iife',platform:'browser'})
  let origin
  const server=createServer((req,res)=>{
    const url=new URL(req.url,origin)
    if(url.pathname==='/app.js'){res.setHeader('content-type','text/javascript');res.end(bundled.outputFiles[0].text)}
    else if(url.pathname==='/moki-library/open'){
      res.setHeader('content-type','application/json');res.end(JSON.stringify(runtime.openFrame(url.searchParams.get('session'),origin,url.searchParams.get('document'))))
    }else if(url.pathname==='/moki-library/windows'){
      res.setHeader('content-type','application/json');res.end(JSON.stringify({open:[],commands:[]}))
    }else if(url.pathname==='/'){
      res.setHeader('content-type','text/html');res.end('<!doctype html><html lang="zh"><head><style>body{margin:0}.qa-shell{display:grid;grid-template-columns:40% 60%;height:100vh}.qa-shell[data-main=true]{display:block}aside{min-width:0;height:100%}.ml-panel{height:100vh;display:flex;flex-direction:column}.ml-frame-holder{flex:1;min-height:0}.ml-frame{width:100%;height:100%;border:0}.ml-actions{display:flex;gap:5px}.ml-dialog{position:fixed;right:10px;bottom:10px;background:white;border:1px solid;padding:20px}textarea{width:90%;height:220px}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>')
    }else{res.statusCode=404;res.end()}
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port
  const browser=await puppeteer.launch({executablePath:(await browserExecutables())[0],headless:true,pipe:true})
  t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));await runtime.close();await rm(dir,{recursive:true,force:true})})
  const page=await browser.newPage();await page.setViewport({width:1280,height:800})
  const errors=[];page.on('pageerror',error=>errors.push(error.message))
  await page.evaluateOnNewDocument(id=>{window.qaItemId=id},item.id)
  await page.goto(origin)
  await page.waitForFunction(()=>qa.entry().state.documentReady)
  const frame=await (await page.$('iframe.ml-frame')).contentFrame()
  await frame.waitForSelector('pre[data-moki-text-source]')
  const select=async(start,end)=>{
    await frame.click('pre[data-moki-text-source]')
    await frame.$eval('pre[data-moki-text-source]',(node,{start,end})=>{
      const range=document.createRange();range.setStart(node.firstChild,start);range.setEnd(node.firstChild,end)
      getSelection().removeAllRanges();getSelection().addRange(range)
    },{start,end})
    await frame.waitForSelector('[data-selection-chat-action]',{visible:true})
    await frame.click('[data-selection-chat-action]')
  }
  const read=()=>page.evaluate(()=>({current:qa.binding('current').hooks.input.getSnapshot().draft,history:qa.binding('history').hooks.input.getSnapshot().draft,writes:qa.binding('current').stats.writes,historyWrites:qa.binding('history').stats.writes,focused:document.activeElement?.dataset.inputSession,chat:qa.entry().state.chat,target:qa.entry().state.chatTarget}))

  const submit=async(prompt)=>{
    await frame.waitForSelector('[data-selection-composer]')
    await frame.type('[aria-label="选区指令"]',prompt)
    await frame.click('.moki-quick-send')
  }
  await select(6,10)
  assert.equal(await page.$('[role=dialog]'),null,'the whale opens only the local quick composer')
  assert.equal(await page.evaluate(()=>qa.sent.length),0)
  const attachment=join(dir,'brief.txt');await writeFile(attachment,'ATTACHED CONTENT')
  await (await frame.$('[data-selection-composer] input[type=file]')).uploadFile(attachment)
  await submit('Edit this occurrence')
  await page.waitForFunction(()=>qa.sent.length===1&&document.activeElement?.dataset.inputSession==='current')
  await frame.waitForSelector('[data-selection-composer]',{hidden:true})
  let sent=await page.evaluate(()=>qa.sent)
  assert.match(sent[0].text,/"start":6/);assert.match(sent[0].text,/"end":10/);assert.match(sent[0].text,/Edit this occurrence/)
  assert.deepEqual(sent[0].files,[{name:'brief.txt',text:'ATTACHED CONTENT'}])
  assert.equal((await read()).current,'Keep my question.\n')
  assert.equal((await read()).writes,0)

  await page.click('[aria-label="在主窗口打开"]')
  await page.waitForFunction(()=>qa.entry().mode==='main'&&Boolean(qa.entry().host))
  await select(0,4)
  assert.equal(await page.$('[role=dialog]'),null)
  await submit('Main window edit')
  await page.waitForFunction(()=>qa.sent.length===2)
  await page.waitForSelector('[role=dialog]')
  assert.equal(await page.$eval('[role=dialog]',node=>node.dataset.chatTarget),'current')
  await frame.waitForSelector('[data-selection-composer]',{hidden:true})
  await page.click('[data-test-history]')
  await page.waitForFunction(()=>qa.entry().state.chatTarget==='history')
  await select(12,17);await submit('History instruction')
  await page.waitForFunction(()=>qa.sent.length===3)
  assert.equal(await page.evaluate(()=>qa.sent[2].sessionId),'history')
  assert.equal((await read()).history,'History draft.\n')
  await frame.waitForSelector('[data-selection-composer]',{hidden:true})

  await page.click('[aria-label="在侧边工作区打开"]')
  await page.waitForFunction(()=>qa.entry().mode==='side'&&Boolean(qa.entry().host))
  assert.equal(await page.$('[role=dialog]'),null)
  await select(6,10)
  await page.evaluate(()=>{qa.quickState.fail=true})
  await submit('Retry without losing this instruction')
  await frame.waitForSelector('.moki-quick-error')
  assert.equal(await frame.$eval('[aria-label="选区指令"]',node=>node.value),'Retry without losing this instruction')
  assert.equal(await page.evaluate(()=>qa.sent.length),3)
  await page.evaluate(()=>{qa.quickState.fail=false})
  await frame.click('.moki-quick-send');await page.waitForFunction(()=>qa.sent.length===4)
  assert.equal(await page.evaluate(()=>qa.sent[3].sessionId),'current')
  await frame.waitForSelector('[data-selection-composer]',{hidden:true})

  await select(0,4)
  await page.evaluate(()=>{qa.quickState.pauseUploads=true})
  await (await frame.$('[data-selection-composer] input[type=file]')).uploadFile(attachment)
  await submit('Must not cross sessions')
  await page.waitForFunction(()=>qa.quickState.created===2)
  await page.evaluate(()=>qa.current.set(qa.binding('another-session')))
  await page.waitForFunction(()=>!qa.entry().host)
  await page.waitForFunction(()=>qa.quickState.released>=1)
  assert.equal(await page.evaluate(()=>qa.sent.length),4)
  await page.evaluate(()=>{qa.quickState.pauseUploads=false;qa.current.set(qa.binding('current'))})
  await page.waitForFunction(()=>Boolean(qa.entry().host))
  await frame.click('[aria-label="关闭快捷输入"]')
  await frame.click('pre[data-moki-text-source]')
  await page.keyboard.down('Alt');await page.keyboard.press('d');await page.keyboard.up('Alt')
  await page.waitForFunction(()=>document.activeElement?.dataset.inputSession==='current')
  assert.equal(await page.$('[role=dialog]'),null)
  assert.equal((await read()).writes,0)
  assert.equal(await readFile(path,'utf8'),'same\r\nsame\r\nfinal')
  assert.deepEqual(errors,[])
})

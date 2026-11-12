import test from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {createServer} from 'node:http'
import {fileURLToPath} from 'node:url'
import puppeteer from 'puppeteer-core'
import {browserExecutables} from '../src/preview-browser.mjs'

test('standalone quick instructions transfer files, acknowledge admission and retry without touching the native draft',{timeout:30000},async t=>{
  const output=await build({entryPoints:[fileURLToPath(new URL('./fixtures/preview-quick-client.jsx',import.meta.url))],outdir:'virtual',bundle:true,write:false,format:'iife',platform:'browser'})
  let origin
  const server=createServer((request,response)=>{
    if(request.url.startsWith('/moki-library/preview-chat')){response.setHeader('content-type','application/json');response.end(JSON.stringify({parentOrigin:origin,sessionId:'current'}))}
    else if(request.url==='/app.js'){response.setHeader('content-type','text/javascript');response.end(output.outputFiles.find(file=>file.path.endsWith('.js')).text)}
    else{response.setHeader('content-type','text/html');response.end('<!doctype html><html lang="zh"><body><div id="root"></div><script src="/app.js"></script></body></html>')}
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port
  const browser=await puppeteer.launch({executablePath:(await browserExecutables())[0],headless:true,pipe:true})
  t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve))})
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(origin)
  await page.evaluate(()=>qaSend('one','Edit selected cell'))
  await page.waitForFunction(()=>qaResults.length===1)
  assert.equal(await page.evaluate(()=>qaResults[0].error),undefined)
  const frame=await (await page.$('[data-moki-preview-chat]')).contentFrame()
  const first=await frame.evaluate(()=>qa.sent[0]);assert.match(first.text,/B2/);assert.match(first.text,/Edit selected cell/)
  assert.deepEqual(first.files,[{name:'brief.txt',text:'ATTACHED'}]);assert.equal(await frame.evaluate(()=>qa.draft),'UNSENT MAIN DRAFT')
  await page.evaluate(()=>qaSend('one','Edit selected cell'))
  await page.waitForFunction(()=>qaResults.length===2);assert.equal(await frame.evaluate(()=>qa.sent.length),1)
  await frame.evaluate(()=>{qa.fail=true});await page.evaluate(()=>qaSend('two','Retry instruction'))
  await page.waitForFunction(()=>qaResults.length===3);assert.match(await page.evaluate(()=>qaResults[2].error),/Native send rejected/)
  await frame.evaluate(()=>{qa.fail=false});await page.evaluate(()=>qaSend('two','Retry instruction'))
  await page.waitForFunction(()=>qaResults.length===4);assert.equal(await frame.evaluate(()=>qa.sent.length),2)
  assert.deepEqual(errors,[])
})

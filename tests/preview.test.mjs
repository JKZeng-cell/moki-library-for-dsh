import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,readFile,rm,stat} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {Readable} from 'node:stream'
import {zipSync,strToU8} from 'fflate'
import sharp from 'sharp'
import {createRuntime} from '../lib/host.mjs'
import {textPage} from '../src/preview-files.mjs'
import {browserExecutables} from '../src/preview-browser.mjs'

async function setup(t){
  const dir=await mkdtemp(join(tmpdir(),'moki-preview-'))
  const runtime=await createRuntime({dataDir:dir,sourceDb:null})
  t.after(async()=>{await runtime.close();await rm(dir,{recursive:true,force:true})})
  const frame=runtime.openFrame('preview-qa','dsh-app://app').url
  const api=(path,opts)=>fetch(new URL('./api/library/'+path,frame),opts)
  const file=async(name,bytes)=>{const target=join(dir,name);await writeFile(target,bytes);return runtime.repository.create({kind:'local_file',name,target,tags:[]})}
  return {runtime,dir,frame,api,file}
}
test('preview detects extensionless PDFs, streams suffix ranges and rejects invalid ranges',async t=>{
  const {api,file}=await setup(t),bytes=Buffer.from('%PDF-1.7\npreview range bytes'),item=await file('download-without-extension',bytes)
  const info=await(await api('items/'+item.id+'/preview-info')).json()
  assert.equal(info.kind,'embedded');assert.equal(info.extension,'pdf');assert.equal(info.detected,true)
  for(const [range,expected] of [['bytes=-5',bytes.subarray(-5)],['bytes=5-12',bytes.subarray(5,13)],['bytes=10-',bytes.subarray(10)]]){
    const r=await api('items/'+item.id+'/preview',{headers:{range}});assert.equal(r.status,206);assert.equal(r.headers.get('content-type'),'application/pdf');assert.deepEqual(Buffer.from(await r.arrayBuffer()),expected)
  }
  for(const range of ['bytes=999-','bytes=4-2','bytes=-0']){const r=await api('items/'+item.id+'/preview',{headers:{range}});assert.equal(r.status,416);assert.equal(r.headers.get('content-range'),'bytes */'+bytes.length)}
})
test('text paging preserves every UTF-8 and UTF-16 character across byte boundaries',async t=>{
  const {file}=await setup(t)
  for(const encoding of ['utf8','utf16le']){
    const text='中🙂é'.repeat(90000),bytes=Buffer.concat([encoding==='utf16le'?Buffer.from([255,254]):Buffer.alloc(0),Buffer.from(text,encoding)]),item=await file('large-'+encoding+'.log',bytes)
    let offset=0,result='';do{const page=await textPage(item.target,offset);result+=page.text;offset=page.next}while(offset!==null)
    assert.equal(result,text)
  }
})
test('archive directory pagination and PSD-style image conversion remain read only',async t=>{
  const {api,file}=await setup(t),entries=Object.fromEntries(Array.from({length:250},(_,i)=>['folder/'+i+'.txt',strToU8('data')]))
  const item=await file('files.zip',zipSync(entries)),before=await readFile(item.target)
  const first=await(await api('items/'+item.id+'/preview-archive')).json(),second=await(await api('items/'+item.id+'/preview-archive?offset='+first.next)).json()
  assert.equal(first.entries.length,200);assert.equal(second.entries.length,50);assert.equal(second.next,null);assert.equal(first.total,250)
  assert.deepEqual(await readFile(item.target),before)
  const tga=Buffer.alloc(18+2*2*3);tga[2]=2;tga.writeUInt16LE(2,12);tga.writeUInt16LE(2,14);tga[16]=24;tga[17]=32;tga.fill(128,18)
  const image=await file('sample.tga',tga),response=await api('items/'+image.id+'/preview-image?size=hover')
  assert.equal(response.status,200,response.ok?'':await response.text());const converted=await sharp(Buffer.from(await response.arrayBuffer())).metadata();assert.equal(converted.width,2);assert.equal(converted.height,2)
  assert.deepEqual(await readFile(image.target),tga)
  const corrupt=await file('broken.psd',Buffer.from('8BPS'))
  const error=await api('items/'+corrupt.id+'/preview-image?size=hover');assert.equal(error.status,422);assert.ok((await error.json()).error)
})
test('streaming import accepts more than 32 MB, never overwrites and removes incomplete uploads',async t=>{
  const {api,runtime,dir}=await setup(t),size=40*1024*1024
  const upload=(name,length,actual=length)=>api('workspace-files/stream?'+new URLSearchParams({name,size:String(length)}),{
    method:'POST',headers:{'content-type':'application/octet-stream','x-moki-library-upload':'1'},duplex:'half',
    body:Readable.from((function*(){for(let remaining=actual;remaining>0;remaining-=65536)yield Buffer.alloc(Math.min(65536,remaining),90)})())})
  const r=await upload('large.bin',size);assert.equal(r.status,201);const item=await r.json();assert.equal((await stat(item.target)).size,size)
  const fail=await upload('incomplete.bin',20,10);assert.equal(fail.status,400);assert.ok(!runtime.repository.list().some(i=>i.name==='incomplete.bin'))
  const source=await readFile(item.target);assert.equal(source[0],90);assert.equal(source.at(-1),90)
  const parent=runtime.repository.create({kind:'local_folder',name:'target',target:dir,tags:[]});await writeFile(join(dir,'keep.txt'),'original')
  const conflict=await api('workspace-files/stream?'+new URLSearchParams({name:'keep.txt',size:'3',parentId:parent.id}),{method:'POST',headers:{'content-type':'application/octet-stream','x-moki-library-upload':'1'},body:Buffer.from('new')})
  assert.equal(conflict.status,400);assert.equal(await readFile(join(dir,'keep.txt'),'utf8'),'original')
})
test('thumbnail bubbles are delayed, contained in narrow views, and dismissed before pointer actions',{timeout:30000},async t=>{
  const [executablePath]=await browserExecutables();if(!executablePath)return t.skip('Chromium unavailable')
  const {file,frame}=await setup(t),bytes=await sharp({create:{width:400,height:250,channels:3,background:'#78a3cb'}}).png().toBuffer();await file('hover.png',bytes)
  const {default:puppeteer}=await import('puppeteer-core'),browser=await puppeteer.launch({executablePath,headless:true,pipe:true})
  t.after(()=>browser.close());const page=await browser.newPage()
  for(const mode of ['grid','list'])for(const theme of ['dark','light']){
    // Each library frame owns its URL capability, so keep the same document loaded.
    if(page.url()==='about:blank')await page.goto(frame+'?theme='+theme)
    await page.setViewport({width:mode==='list'?296:1000,height:650})
    await page.evaluate((theme)=>{document.documentElement.dataset.colorScheme=theme},theme)
    const toggle=mode==='list'?'button[aria-label="列表模式"]':'button[aria-label="卡片模式"]';await page.waitForSelector(toggle);await page.click(toggle)
    const icon=await page.waitForSelector('article .resource-file-icon');await icon.hover()
    await page.waitForSelector('.library-hover-preview img',{timeout:5000});await page.waitForFunction(()=>document.querySelector('.library-hover-preview img')?.naturalWidth>0)
    const r=await page.$eval('.library-hover-preview',e=>{const r=e.getBoundingClientRect();return{left:r.left,right:r.right,bottom:r.bottom,top:r.top,pointer:getComputedStyle(e).pointerEvents}})
    const viewport=page.viewport();assert.ok(r.left>=0&&r.right<=viewport.width&&r.top>=0&&r.bottom<=viewport.height);assert.equal(r.pointer,'none')
    await page.keyboard.press('Escape');assert.equal(await page.$('.library-hover-preview'),null);await page.mouse.move(2,2)
  }
})

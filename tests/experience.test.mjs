import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {createRuntime} from '../lib/host.mjs'
import {browserExecutables} from '../src/preview-browser.mjs'
import {l,setLocale,subscribeLocale} from '../src/i18n.js'

async function setup(t) {
  const [executablePath]=await browserExecutables()
  if(!executablePath){t.skip('A local browser is required');return}
  const {default:puppeteer}=await import('puppeteer-core')
  const dir=await mkdtemp(join(tmpdir(),'library-experience-'))
  const runtime=await createRuntime({dataDir:dir,sourceDb:null})
  const browser=await puppeteer.launch({executablePath,headless:true,pipe:true})
  t.after(async()=>{await browser.close();await runtime.close();await rm(dir,{recursive:true,force:true})})
  const page=await browser.newPage()
  return {dir,runtime,page}
}

test('English catalog preserves placeholders and user-supplied contents',async()=>{
  const messages=JSON.parse(await readFile(new URL('../src/locales/en.json',import.meta.url),'utf8'))
  for(const [source,translation] of Object.entries(messages)) {
    const slots=text=>[...new Set(text.match(/\{\d+\}/g)||[])].sort()
    assert.deepEqual(slots(translation),slots(source),source)
  }
  let changes=0;const off=subscribeLocale(()=>changes++)
  try {
    setLocale('en-US')
    const name='资料库\\保存 $& {0}.txt'
    assert.equal(l`已复制“${name}”的路径`,`Path copied for “${name}”`)
    assert.equal(l('名称'),'Name')
    setLocale('en');assert.equal(changes,1)
    setLocale('zh-CN');assert.equal(l('名称'),'名称')
  } finally {off();setLocale('zh')}
})

test('new folders persist the selected color and use readable dark and light palettes',{timeout:30000},async t=>{
  const env=await setup(t);if(!env)return
  const {runtime,page}=env
  page.setDefaultTimeout(5000)
  for(const theme of ['dark','light']){
    await page.goto(runtime.openFrame('folder-color-'+theme,'dsh-app://app').url+'?locale=en&theme='+theme)
    await page.click('[aria-label="New"]')
    await page.$$eval('[role="menuitem"]',items=>items.find(e=>e.textContent.trim()==='New folder').click())
    await page.waitForSelector('.library-edit-dialog')
    assert.equal(await page.$$eval('.library-folder-color-option',items=>items.length),6)
    await page.type('.library-edit-dialog input',theme+' folder')
    await page.click('.library-folder-color-option[aria-label="Blue"]')
    assert.equal(await page.$eval('.library-folder-color-option[aria-label="Blue"]',el=>el.getAttribute('aria-pressed')),'true')
    const color=await page.$eval('.library-folder-color-option[aria-label="Blue"]',el=>{const s=getComputedStyle(el);return {foreground:s.color,background:s.backgroundColor}})
    assert.notEqual(color.foreground,color.background)
    await page.$$eval('.library-edit-dialog footer button',items=>items.find(e=>e.textContent.trim()==='Save').click())
    await page.waitForFunction(()=>!document.querySelector('.library-edit-dialog'))
    const item=runtime.repository.list().find(i=>i.name===theme+' folder')
    assert.equal(item.folderColor,'blue')
    await page.goto(runtime.openFrame('folder-reopen-'+theme,'dsh-app://app').url+'?locale=en&theme='+theme)
    await page.waitForSelector(`[data-resource-id="${item.id}"] .library-folder-icon-colored`)
    assert.equal(await page.$eval(`[data-resource-id="${item.id}"] .library-folder-icon-colored`,el=>getComputedStyle(el).color),color.foreground)
  }
})

test('both outer gutters initiate grid and list marquee at nonzero scroll without moving rows',{timeout:45000},async t=>{
  const env=await setup(t);if(!env)return
  const {runtime,page}=env
  for(let i=0;i<100;i++)runtime.repository.create({kind:'folder',name:`Folder ${i}`,tags:[]})
  await page.setViewport({width:1800,height:780})
  for(const mode of ['grid','list']) for(const side of ['left','right']) {
    await page.goto(runtime.openFrame(mode+side,'dsh-app://app').url+'?locale=en&theme=dark')
    await page.click(`[aria-label="${mode==='grid'?'Grid view':'List view'}"]`)
    await page.waitForSelector('.library-window article')
    await page.$eval('.library-resource-scroll',el=>{el.scrollTop=330})
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))
    const drag=await page.evaluate(({side})=>{
      const scroll=document.querySelector('.library-resource-scroll'),box=scroll.getBoundingClientRect()
      const top=scroll.querySelector('.library-list-header')?.getBoundingClientRect().bottom??box.top
      const rows=[...scroll.querySelectorAll('article')].map(el=>({id:el.dataset.resourceId,r:el.getBoundingClientRect()}))
      const shown=rows.filter(({r})=>r.top>=top&&r.bottom<box.bottom)
      const a=shown[0].r,b=shown.find(({r})=>r.top>a.top+1).r
      const start={x:side==='left'?20:innerWidth-20,y:a.top+a.height/2}
      const end={x:side==='left'?box.right-12:box.left+12,y:b.top+b.height/2}
      const ids=rows.filter(({r})=>r.left<=Math.max(start.x,end.x)&&r.right>=Math.min(start.x,end.x)&&r.top<=end.y&&r.bottom>=start.y).map(x=>x.id).sort()
      return {start,end,ids,scrollTop:scroll.scrollTop,first:shown[0].id,firstTop:a.top}
    },{side})
    assert.ok(drag.ids.length>=2)
    await page.mouse.move(drag.start.x,drag.start.y);await page.mouse.down()
    await page.mouse.move(drag.end.x,drag.end.y,{steps:10})
    const rect=await page.waitForSelector('.library-selection-rect',{visible:true,timeout:2500})
    assert.equal(await rect.evaluate(el=>getComputedStyle(el).position),'fixed')
    assert.equal(await page.$eval(`[data-resource-id="${drag.first}"]`,el=>el.getBoundingClientRect().top),drag.firstTop)
    await page.mouse.up()
    assert.deepEqual(await page.$$eval('[data-resource-selected="true"]',els=>els.map(e=>e.dataset.resourceId).sort()),drag.ids)
    assert.equal(await page.$eval('.library-resource-scroll',el=>el.scrollTop),drag.scrollTop)
    // Clearing from the toolbar must not begin another rectangle.
    await page.click('[aria-label="Clear selection"]')
    assert.equal(await page.$('.library-selection-rect'),null)
  }
})

test('name and time sort mix folders and file formats; English switches live without changing user data',{timeout:45000},async t=>{
  const env=await setup(t);if(!env)return
  const {runtime,page}=env
  const fixtures=[
    ['Z folder','folder',6,2],['A image.png','local_file',5,4],['N sheet.xlsx','local_file',1,3],
    ['B folder','local_folder',2,6],['M slides.pptx','local_file',4,1],['C document.pdf','local_file',3,5],
    ['资料库','folder',null,7],
  ].map(([name,kind,modified,added])=>({id:randomUUID(),name,kind,parentId:null,target:kind==='folder'?null:'C:/qa/'+name,
    tags:['保存','名称'],createdAt:`2026-10-${String(added).padStart(2,'0')}T12:00:00Z`,updatedAt:'2026-11-01T12:00:00Z',
    fileModifiedAt:modified?`2026-10-${String(modified).padStart(2,'0')}T12:00:00Z`:null,fileCreatedAt:null}))
  await page.setViewport({width:1400,height:900})
  await page.setRequestInterception(true)
  page.on('request',request=>new URL(request.url()).pathname.endsWith('/api/library/items')
    ? request.respond({status:200,contentType:'application/json',body:JSON.stringify(fixtures)}) : request.continue())
  const frame=runtime.openFrame('sort-language','dsh-app://app'),url=new URL(frame.url)
  url.search=new URLSearchParams({locale:'en',theme:'dark',bridge:'qa-locale',parent:url.origin})
  await page.goto(url.href);await page.click('[aria-label="List view"]')
  await page.waitForSelector('article')
  const names=()=>page.$$eval('article [data-resource-name]',els=>els.map(e=>e.textContent.trim()))
  for(const [mode,expected] of [
    ['name-asc',['A image.png','B folder','C document.pdf','M slides.pptx','N sheet.xlsx','Z folder','资料库']],
    ['name-desc',['资料库','Z folder','N sheet.xlsx','M slides.pptx','C document.pdf','B folder','A image.png']],
    ['modified-asc',['N sheet.xlsx','B folder','C document.pdf','M slides.pptx','A image.png','Z folder','资料库']],
    ['modified-desc',['Z folder','A image.png','M slides.pptx','C document.pdf','B folder','N sheet.xlsx','资料库']],
    ['added-asc',['M slides.pptx','Z folder','N sheet.xlsx','A image.png','C document.pdf','B folder','资料库']],
    ['added-desc',['资料库','B folder','C document.pdf','A image.png','N sheet.xlsx','Z folder','M slides.pptx']],
  ]){await page.select('[aria-label="Sort items"]',mode);assert.deepEqual(await names(),expected,mode)}
  await page.click(`[data-resource-id="${fixtures[1].id}"] [data-resource-select]`)
  const switchLanguage=locale=>page.evaluate(locale=>window.postMessage({bridge:'qa-locale',type:'surface',active:true,mode:'side',dark:true,locale},location.origin),locale)
  await switchLanguage('zh');await page.waitForSelector('[aria-label="资料排序"]')
  await switchLanguage('en');await page.waitForSelector('[aria-label="Sort items"]')
  assert.equal(await page.$eval(`[data-resource-id="${fixtures[1].id}"]`,el=>el.dataset.resourceSelected),'true')
  assert.ok((await names()).includes('资料库'),'A user folder named 资料库 must not be translated')
  assert.ok(await page.$eval('.dsh-library-tags',el=>el.textContent.includes('保存')&&el.textContent.includes('名称')))
  await page.click('[aria-label="Clear selection"]')
  await page.type('[aria-label="Search library"]','image')
  await page.waitForFunction(()=>document.querySelectorAll('article').length===1)
  await page.click('[aria-label="Clear search"]')
  await page.waitForFunction(()=>document.querySelectorAll('article').length===7)
  await page.click('[aria-label="New"]')
  assert.ok((await page.$eval('.dsh-library-create',el=>el.textContent)).includes('Word document'))
  await page.keyboard.press('Escape')
  await page.setViewport({width:360,height:780})
  const layout=await page.evaluate(()=>{
    const path=document.querySelector('.library-path-container').getBoundingClientRect()
    const search=document.querySelector('.dsh-library-search').getBoundingClientRect()
    return {overflow:document.documentElement.scrollWidth>innerWidth,path:path.width,search:search.width,
      controls:[...document.querySelectorAll('.dsh-library-commandbar button')].filter(el=>getComputedStyle(el).display!=='none').every(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth})}
  })
  assert.equal(layout.overflow,false);assert.equal(layout.controls,true)
  assert.ok(Math.abs(layout.path-layout.search)<1,'English path and search fields stay aligned in a narrow pane')
})

test('English preview chrome and language changes preserve an active text draft',{timeout:30000},async t=>{
  const env=await setup(t);if(!env)return
  const {dir,runtime,page}=env,target=join(dir,'资料库_名称.txt'),content='用户的名称、保存和资料库内容不能翻译。'
  await writeFile(target,content)
  const file=runtime.repository.create({kind:'local_file',name:'资料库_名称.txt',target,tags:[]})
  const frame=runtime.openFrame('english-draft','dsh-app://app'),url=new URL(frame.url)
  url.search=new URLSearchParams({locale:'en',bridge:'qa-locale',parent:url.origin})
  await page.goto(url.href);await page.waitForSelector('article')
  await page.click('article [data-resource-name]');await page.waitForSelector('[aria-label="Close preview"]')
  await page.waitForSelector('[aria-label="Edit"]');await page.click('[aria-label="Edit"]');await page.waitForSelector('textarea[aria-label="Library text editor"]')
  await page.type('textarea[aria-label="Library text editor"]',' EDIT')
  const draft=await page.$eval('textarea',el=>el.value)
  await page.evaluate(()=>window.postMessage({bridge:'qa-locale',type:'surface',active:true,mode:'side',dark:true,locale:'zh'},location.origin))
  await page.waitForSelector('textarea[aria-label="资料文本编辑器"]')
  assert.equal(await page.$eval('textarea',el=>el.value),draft)
  assert.ok(draft.includes(content));assert.equal(await readFile(target,'utf8'),content)
})

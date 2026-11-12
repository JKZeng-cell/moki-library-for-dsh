import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { runInNewContext } from 'node:vm'
import { EventEmitter } from 'node:events'
import {randomUUID} from 'node:crypto'
import sharp from 'sharp'
import {unzipSync,strFromU8} from 'fflate'
import { apply, createRuntime } from '../lib/host.mjs'
import { browserExecutables } from '../src/preview-browser.mjs'

async function directory(t) {
  const dir=await mkdtemp(join(tmpdir(),'dsh-library-test-'))
  t.after(()=>rm(dir,{recursive:true,force:true}))
  return dir
}

test('system previews keep distinct documents, deliver sidebar handoffs and bind an exact agent session',async t=>{
  const pages=[]
  const previewBrowser={async open(url){
    const page=Object.assign(new EventEmitter(),{url,focus:0,waitForSelector:async()=>true,async bringToFront(){this.focus++},async close(){this.emit('close')}})
    pages.push(page);return page
  },async close(){for(const page of pages)await page.close()}}
  const runtime=await createRuntime({dataDir:await directory(t),sourceDb:null,previewBrowser})
  try {
    const documents=['a.txt','b.txt'].map(name=>runtime.repository.create({kind:'local_file',name,target:join(runtime.dataDir,name),tags:[]}))
    const client=randomUUID(), other=randomUUID(), appearance={dark:true,theme:{},font:'Arial',rootSize:'16px'}
    const options=id=>({id,client,appearance,session:'original'})
    await Promise.all([runtime.previews.open(options(documents[0].id)),runtime.previews.open(options(documents[0].id)),runtime.previews.open(options(documents[1].id))])
    assert.equal(pages.length,2)
    assert.equal(pages[0].focus,2)
    const popup=pages[0].url,html=await (await fetch(popup)).text()
    const iconHref=html.match(/<link rel="icon"[^>]+href="([^"]+\.ico)"/u)?.[1]
    assert.ok(iconHref,'The system window must declare its taskbar icon before the preview loads')
    const iconUrl=new URL(iconHref,popup)
    assert.ok(iconUrl.href.startsWith(new URL('.',popup).href),'The icon must load through the same private preview route')
    const response=await fetch(iconUrl)
    assert.equal(response.status,200)
    const ico=Buffer.from(await response.arrayBuffer())
    assert.deepEqual(ico, await readFile(new URL('../web/preview-icon.ico',import.meta.url)))
    assert.equal(ico.readUInt16LE(2),1)
    const sizes=[]
    for(let i=0;i<ico.readUInt16LE(4);i++){
      const entry=6+16*i,size=ico[entry] || 256,offset=ico.readUInt32LE(entry+12)
      assert.equal(ico[entry+1] || 256,size)
      assert.equal(ico.toString('ascii',offset+12,offset+16),'IHDR')
      assert.deepEqual([ico.readUInt32BE(offset+16),ico.readUInt32BE(offset+20)],[size,size],'Each window icon must contain its declared native-size image')
      sizes.push(size)
    }
    assert.deepEqual(sizes,[16,20,24,28,30,32,36,40,42,48,56,60,64,72,80,96,128,256])
    assert.deepEqual(html.match(/type="image\/x-icon" sizes="([^"]+)"/u)[1].split(' '),sizes.map(n=>n+'x'+n))
    for(const size of [16,24,32,48,256]){
      const entry=6+16*sizes.indexOf(size),offset=ico.readUInt32LE(entry+12)
      const {data,info}=await sharp(ico.subarray(offset,offset+ico.readUInt32LE(entry+8))).ensureAlpha().raw().toBuffer({resolveWithObject:true})
      // Across the two upright book spines, edges should land exactly between pixels.
      const middle=Math.floor(size*0.57),ink=48,paper=248
      const scan=Array.from({length:Math.floor(size*0.55)-Math.ceil(size*0.12)},(_,i)=>data[(middle*size+Math.ceil(size*0.12)+i)*info.channels])
      assert.ok(scan.includes(ink) && scan.includes(paper) && scan.every(n=>n===ink || n===paper),'Crisp native-size book spines at '+size+'px')
    }
    const read=(p,path,body)=>fetch(new URL('./api/dsh/'+path,p.url),body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})
    for(const [i,page] of pages.entries())assert.equal((await (await read(page,'document')).json()).item.id,documents[i].id)
    const moving=read(pages[0],'document-action',{action:'dock',office:true})
    let command
    for(let i=0;i<60 && !command;i++){command=runtime.previews.poll(client).commands[0];if(!command)await new Promise(r=>setTimeout(r,10))}
    assert.equal(command.id,documents[0].id);assert.equal(command.office,true)
    assert.deepEqual(runtime.previews.poll(other),{open:[],commands:[]})
    runtime.previews.ack(other,command.key)
    assert.equal(runtime.previews.poll(client).commands.length,1)
    runtime.previews.ack(client,command.key)
    assert.equal((await moving).status,200)
    runtime.previews.bind(client,documents[0].id,'chat-one')
    runtime.previews.bind(client,documents[1].id,'chat-two')
    assert.equal(runtime.active('chat-one').documentId,documents[0].id)
    assert.equal(runtime.active('chat-two').documentId,documents[1].id)
    const owner='moki-document-'+documents[0].id
    assert.throws(()=>runtime.openFrame('unrelated','dsh-app://app',documents[0].id))
    const side=runtime.openFrame(owner,'dsh-app://app',documents[0].id)
    assert.equal((await (await read(side,'document')).json()).item.id,documents[0].id)
    const selectTab=(seq,focused=false)=>read(side,'state',{seq,active:true,focused,chatId:'chat-two',previewId:documents[0].id,
      selection:{label:'侧边文件选区',content:'{}',itemCount:1}})
    await selectTab(1)
    assert.equal(runtime.active('chat-two').documentId,documents[0].id,'opening the sidebar tab selects its document for the conversation')
    runtime.previews.bind(client,documents[1].id,'chat-two')
    await selectTab(2)
    assert.equal(runtime.active('chat-two').documentId,documents[1].id,'an idle sidebar heartbeat preserves the foreground popup')
    await selectTab(3,true)
    assert.equal(runtime.active('chat-two').documentId,documents[0].id,'returning to the sidebar editor selects its file again')
    await pages[0].close()
    assert.equal(runtime.active('chat-one'),undefined)
    assert.deepEqual(runtime.previews.poll(client).open,[documents[1].id])
  } finally {await runtime.close()}
})

test('popup conversations load once inside the owned window and bind the foreground file selection',async t=>{
  const origin='http://127.0.0.1:65531',pages=[]
  const browser={async open(initialUrl){
    const page=new EventEmitter()
    page.address=initialUrl
    page.url=()=>page.address
    page.bringToFront=async()=>{}
    page.close=async()=>page.emit('close')
    let address='about:blank'
    page.navigations=0
    const child={url:()=>address,async goto(value){
      page.navigations++
      if(page.fail)throw Error('transport error '+value)
      const requested=new URL(value)
      assert.equal(requested.origin,origin)
      address=origin+'/'+requested.hash
      return {ok:()=>true}
    }}
    page.waitForSelector=async selector=>selector.includes('preview-chat')?{contentFrame:async()=>child,dispose:async()=>{}}:true
    page.chatKey=()=>new URL(address).hash.split('=')[1]
    pages.push(page)
    return page
  },async close(){for(const page of pages)await page.close()}}
  let runtime
  t.after(()=>runtime?.close())
  runtime=await createRuntime({previewBrowser:browser,dataDir:await directory(t),sourceDb:null,chatHost:{origin,launch:()=>origin+'/?token=test-only'}})
  const client=randomUUID(),appearance={dark:true,theme:{},font:'Arial',rootSize:'16px'}
  const action=async(page,action)=>fetch(new URL('./api/dsh/document-action',page.url()),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action})})
  for(const label of ['A','B']){
    const item=runtime.repository.create({kind:'local_file',name:label,target:join(runtime.dataDir,label+'.txt'),tags:[]})
    await runtime.previews.open({id:item.id,client,session:'browse-'+client,appearance})
    const page=pages.at(-1)
    const state={seq:1,active:true,previewId:item.id,selection:{label,content:label,itemCount:1}}
    await fetch(new URL('./api/dsh/state',page.url()),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(state)})
    const results=await Promise.all([action(page,'compose'),action(page,'compose')])
    for(const result of results){assert.equal(result.status,200);assert.deepEqual(await result.json(),{ok:true})}
    assert.equal(page.navigations,1)
    const context=runtime.previews.chatInfo(page.chatKey())
    assert.equal(context.sessionId,null);assert.equal(context.selection.label,label)
    runtime.previews.chatInfo(page.chatKey(),'same-session')
    assert.equal(runtime.active('same-session').selection.label,label)
  }
  assert.notEqual(pages[0].chatKey(),pages[1].chatKey())
  assert.deepEqual(runtime.previews.poll(client).commands,[])
  await action(pages[0],'activate-chat')
  assert.equal(runtime.active('same-session').selection.label,'A')
  await action(pages[1],'hide-chat')
  runtime.previews.chatInfo(pages[1].chatKey(),'same-session')
  assert.equal(runtime.active('same-session').selection.label,'A')
  await action(pages[0],'hide-chat')
  assert.equal(runtime.active('same-session'),undefined)
  await action(pages[1],'compose')
  assert.equal(pages[1].navigations,1)
  assert.equal(runtime.active('same-session').selection.label,'B')
  const retired=pages[1].chatKey()
  await pages[1].close()
  assert.throws(()=>runtime.previews.chatInfo(retired))
  assert.equal(runtime.active('same-session'),undefined)
  const third=runtime.repository.create({kind:'local_file',name:'C',target:join(runtime.dataDir,'C.txt'),tags:[]})
  await runtime.previews.open({id:third.id,client,session:'same-session',appearance})
  pages[2].fail=true
  const refused=await action(pages[2],'compose')
  assert.equal(refused.status,500)
  assert.doesNotMatch(await refused.text(),/token|test-only/)
  pages[2].fail=false
  assert.equal((await action(pages[2],'compose')).status,200)
})

test('imports a legacy catalog once and persists independent edits',async t=>{
  const dir=await directory(t),source=join(dir,'legacy.sqlite'),target=join(dir,'library')
  const db=new DatabaseSync(source)
  db.exec("CREATE TABLE resource_library_items(id TEXT PRIMARY KEY,parent_id TEXT,kind TEXT,name TEXT,target TEXT,tags_json TEXT,sort_order INTEGER,created_at TEXT,updated_at TEXT); INSERT INTO resource_library_items VALUES('original',NULL,'folder','资料',NULL,'[]',0,'2026-01-01','2026-01-01')")
  db.close()
  let runtime=await createRuntime({dataDir:target,sourceDb:source})
  try {
    assert.equal(runtime.repository.find('original').name,'资料')
    runtime.repository.create({name:'DSH',kind:'folder',tags:[]})
  } finally {await runtime.close()}
  runtime=await createRuntime({dataDir:target,sourceDb:source})
  try {assert.equal(runtime.repository.list().length,2)} finally {await runtime.close()}
  const original=new DatabaseSync(source,{readOnly:true})
  try {assert.equal(original.prepare('SELECT count(*) AS n FROM resource_library_items').get().n,1)} finally {original.close()}
})

test('catalog reads can defer raster thumbnails while retaining legacy formats and parent scope', async t => {
  const dir = await directory(t)
  const runtime = await createRuntime({ dataDir: dir, sourceDb: null })
  try {
    const repo = runtime.repository
    const folder = repo.create({ kind: 'folder', name: '图片', tags: [] })
    const image = repo.create({ kind: 'local_file', parentId: folder.id, name: '图.png', target: join(dir, '图.png'), tags: [] })
    const legacy = repo.create({ kind: 'local_file', name: '图.gif', target: join(dir, '图.gif'), tags: [] })
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a58cAAAAASUVORK5CYII='
    const gif = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='
    repo.update(image.id, { thumbnailDataUrl: png })
    repo.update(legacy.id, { thumbnailDataUrl: gif })
    assert.deepEqual(repo.list({ parentId: folder.id }).map(item => item.id), [image.id])
    assert.deepEqual(repo.list({ parentId: null }).map(item => item.id), [folder.id, legacy.id])
    const base = runtime.openFrame('catalog-qa', 'dsh-app://app').url
    const get = (suffix, init) => fetch(new URL('./api/library/items' + suffix, base), init)
    const full = await (await get('')).json()
    const deferred = await (await get('?thumbnails=deferred')).json()
    assert.equal(full.find(item => item.id === image.id).thumbnailDataUrl, png)
    assert.equal(deferred.find(item => item.id === image.id).hasThumbnail, true)
    assert.equal(deferred.find(item => item.id === image.id).thumbnailDataUrl, null)
    assert.equal(deferred.find(item => item.id === legacy.id).thumbnailDataUrl, gif)
    const endpoint = '/' + image.id + '/thumbnail'
    const response = await get(endpoint)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'image/png')
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from(png.split(',')[1], 'base64'))
    const etag = response.headers.get('etag')
    assert.ok(etag)
    assert.equal((await get(endpoint, { headers: { 'if-none-match': etag } })).status, 304)
    assert.equal((await get('/' + folder.id + '/thumbnail')).status, 404)
  } finally { await runtime.close() }
})

test('folder indexing skips unchanged entries and only removes missing subtrees in that folder', async t => {
  const dir = await directory(t)
  const runtime = await createRuntime({ dataDir: dir, sourceDb: null })
  try {
    const repo = runtime.repository
    const folder = repo.create({ kind: 'local_folder', name: '项目', target: dir, tags: ['项目'] })
    const other = repo.create({ kind: 'folder', name: '其他目录', tags: [] })
    const entry = { kind: 'local_folder', name: '图纸', target: join(dir, '图纸'), fileCreatedAt: '2025-11-09', fileModifiedAt: '2026-11-08' }
    assert.deepEqual(repo.synchronizeLocalFolderLevel(folder, [entry]), { added: 1, updated: 0, removed: 0 })
    const [child] = repo.list({ parentId: folder.id })
    const edited = repo.update(child.id, { tags: ['项目', '设计'], folderColor: 'blue' })
    const leaf = repo.create({ parentId: child.id, kind: 'folder', name: '方案', tags: [] })
    assert.deepEqual(repo.synchronizeLocalFolderLevel(folder, [entry]), { added: 0, updated: 0, removed: 0 })
    assert.deepEqual(repo.find(child.id), edited)
    assert.deepEqual(repo.synchronizeLocalFolderLevel(folder, [{ ...entry, fileModifiedAt: '2026-11-09' }]), { added: 0, updated: 1, removed: 0 })
    assert.deepEqual(repo.find(child.id).tags, edited.tags)
    assert.deepEqual(repo.synchronizeLocalFolderLevel(folder, []), { added: 0, updated: 0, removed: 2 })
    assert.equal(repo.find(leaf.id), undefined)
    assert.deepEqual(repo.find(other.id), other)
  } finally { await runtime.close() }
})

test('a completed index notifies other DSH views only when the folder contents changed', async t => {
  const dir = await directory(t)
  const mapped = join(dir, '映射')
  await mkdir(mapped)
  const runtime = await createRuntime({ dataDir: join(dir, 'library'), sourceDb: null })
  try {
    const folder = runtime.repository.create({ name: '映射', kind: 'local_folder', target: mapped, tags: [] })
    const main = runtime.openFrame('main-frame', 'dsh-app://app').url
    const side = runtime.openFrame('side-frame', 'dsh-app://app').url
    const changes = async (frame, after) => (await fetch(new URL('./api/dsh/changes?after=' + after, frame))).json()
    const reindex = async () => {
      const base = './api/library/items/' + folder.id
      let status = await (await fetch(new URL(base + '/index', main), { method: 'POST' })).json()
      for (let i = 0; i < 100 && ['indexing', 'queued'].includes(status.status); i++) {
        await new Promise(resolve => setTimeout(resolve, 10))
        status = await (await fetch(new URL(base + '/index-status', main))).json()
      }
      assert.equal(status.status, 'completed')
      return status
    }
    const { version: before } = await changes(side, -1)
    await writeFile(join(mapped, '新增.txt'), '新增')
    assert.equal((await reindex()).added, 1)
    const event = await changes(side, before)
    assert.deepEqual(event.changes.map(({ itemId, operation }) => [itemId, operation]), [[folder.id, 'catalog']])
    assert.deepEqual(await changes(main, before), event)
    assert.equal((await reindex()).updated, 0)
    assert.equal((await changes(side, event.version)).version, event.version)
  } finally { await runtime.close() }
})

test('a file drop without a host path is copied into the mapped folder and cannot overwrite an existing file',async t=>{
  const dir=await directory(t), folder=join(dir,'映射目录')
  await mkdir(folder)
  const runtime=await createRuntime({dataDir:join(dir,'library'),sourceDb:null})
  try {
    const mapped=runtime.repository.create({kind:'local_folder',name:'映射目录',target:folder,tags:[]})
    const frame=runtime.openFrame('drop','dsh-app://app')
    const upload=content=>fetch(new URL('./api/library/workspace-files',frame.url),{method:'POST',
      headers:{'content-type':'application/json','x-moki-library-upload':'1'},
      body:JSON.stringify({parentId:mapped.id,name:'拖入.txt',size:Buffer.byteLength(content),dataUrl:'data:text/plain;base64,'+Buffer.from(content).toString('base64')})})
    const first=await upload('original')
    assert.equal(first.status,201)
    assert.equal((await first.json()).target,join(folder,'拖入.txt'))
    assert.equal((await upload('replacement')).status,400)
    assert.equal(await readFile(join(folder,'拖入.txt'),'utf8'),'original')
    assert.equal(runtime.repository.list().filter(item=>item.parentId===mapped.id).length,1)
  } finally {await runtime.close()}
})

test('DSH tool registration, permissions, live selections and versioned file edits',async t=>{
  const dir=await directory(t),tools=new Map(),cleanup=[]
  let endpoint,allowed=true,confirmations=0
  const ctx={effect(setup){const release=setup();if(typeof release==='function')cleanup.push(release)},webServer:{register(route){if(route.path==='/moki-library/open')endpoint=route.resource}},tools:{register(tool){tools.set(tool.name,tool)}},approval:{async request(){confirmations++;return allowed?'allowed-once':'denied'}},attachments:{saveImages:async()=>[]},systemPrompt:{section(){},context(){}}}
  ctx.on=()=>{}
  ctx.inject=()=>{}
  await apply(ctx,{dataDir:dir,sourceDb:null})
  try {
    assert.equal(tools.size,11)
    const invoke=(name,args,session='alpha')=>tools.get('moki_library_'+name).execute(args,{agent:{session:{id:session}},callId:'test-call'})
    const create={name:'fixture',format:'markdown',content:'第一版'}
    allowed=false
    await assert.rejects(invoke('create',create))
    assert.equal((await invoke('list',{})).total,0)
    allowed=true
    const {item}=await invoke('create',create)
    const read=await invoke('read',{id:item.id})
    const frame=await (await endpoint(new Request('http://localhost/moki-library/open?session=alpha&parent=dsh-app%3A%2F%2Fapp',{headers:{'x-moki-library':'1'}}))).json()
    const framePath=new URL('./api/dsh/state',frame.url)
    const update=(seq,active)=>fetch(framePath,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({seq,active,selection:{label:'测试选区',itemCount:1,content:JSON.stringify({selectedIds:[item.id]})}})})
    assert.equal((await update(2,true)).status,200)
    await update(1,false)
    assert.equal((await invoke('context',{})).selection.selectedItems[0].id,item.id)
    assert.equal((await invoke('context',{},'beta')).selection,null)
    await writeFile(item.target,'手工修改')
    await assert.rejects(invoke('write',{id:item.id,expectedVersion:read.version,content:'过期版本'}))
    assert.equal(await readFile(item.target,'utf8'),'手工修改')
    const latest=await invoke('read',{id:item.id})
    await invoke('write',{id:item.id,expectedVersion:latest.version,content:'已确认'})
    assert.equal(await readFile(item.target,'utf8'),'已确认')
    assert.ok(confirmations>=3)
    const events=await (await fetch(new URL('./api/dsh/changes?after=0',frame.url))).json()
    assert.ok(events.changes.some(e=>e.operation==='file'&&e.itemId===item.id))
    await update(3,false)
    assert.equal((await invoke('context',{})).selection,null)
  } finally {for(const release of cleanup.reverse())await release()}
})

test('switching the floating chat grants only the visible draft and rejects stale selections',async t=>{
  const runtime=await createRuntime({dataDir:await directory(t),sourceDb:null})
  const id='7b1999e2-8792-40c6-bbd0-dac38bedff0a'
  const frame=runtime.openFrame('original','dsh-app://app')
  const post=(seq,chatId,active=true)=>fetch(new URL('./api/dsh/state',frame.url),{method:'POST',
    headers:{'content-type':'application/json'},body:JSON.stringify({seq,chatId,active,previewId:id,selection:{label:'B3',itemCount:1,content:'{}'}})})
  try {
    const bridge=runtime.session('original').editors
    bridge.register({id,editorId:'visible',active:true,revision:1})
    bridge.register({id:'another-file',editorId:'parked',active:false,revision:1})
    assert.equal((await post(1,'new')).status,200)
    assert.deepEqual(runtime.collaboration('new').editors.map(e=>e.editorId),['visible'])
    await post(3,'history')
    await post(2,'new')
    assert.equal(runtime.active('new'),undefined)
    assert.equal(runtime.active('history')?.selection.label,'B3')
    assert.equal(runtime.collaboration('history').owner,'original')
    await post(4,'history',false)
    assert.equal(runtime.active('history'),undefined)
    assert.deepEqual(runtime.collaboration('history').editors,[])
  } finally {await runtime.close()}
})

function checkSheetShortcut(html) {
  const source=html.split('<!-- moki-univer-bridge:start -->')[1].match(/<script>([\s\S]*?)<\/script>/)[1]
  const range={getRange:()=>({startRow:2,endRow:2,startColumn:1,endColumn:2}),getA1Notation:()=>'B3:C3'}
  const sheet={getSheetId:()=>'s1',getSheetName:()=>'预算',getActiveRange:()=>range,getSelection:()=>({getActiveRangeList:()=>[range]})}
  const workbook={getId:()=>'book',getActiveSheet:()=>sheet}
  const caret={getActiveTextRange:()=>({startOffset:0,endOffset:0}),getDocRanges:()=>[]}
  const formulaInput={getId:()=>'__INTERNAL_EDITOR__DOCS_NORMAL',_injector:{resolvedDependencyCollection:{resolvedDependencies:new Map([['text',[caret]]])}}}
  let message
  const listeners={}
  const parent={postMessage:value=>{message=value}}
  const window={univerAPI:{getActiveWorkbook:()=>workbook,getActiveDocument:()=>formulaInput},parent,
    getSelection:()=>null,location:{search:'?unit=book'},setInterval:()=>0,addEventListener:(type,fn)=>{listeners[type]=fn}}
  const document={getSelection:()=>null,addEventListener:(type,fn)=>{listeners[type]=fn}}
  runInNewContext(source,{window,document,URLSearchParams,Map,HTMLElement:class{},MutationObserver:class{observe(){}},requestAnimationFrame:()=>0})
  listeners.keydown({code:'KeyD',altKey:true,preventDefault(){},stopImmediatePropagation(){}})
  assert.equal(message.type,'moki:univer-compose-shortcut')
  const selected=message.editorSelection
  assert.deepEqual([selected.kind,selected.unitId,selected.sheetName,selected.range,selected.endColumn],['sheet','book','预算','B3:C3',2])
  listeners.message({source:parent,data:{type:'moki:univer-selection-request',requestId:'current'}})
  assert.equal(message.selection.ranges.join(','),'B3:C3')
}

test('Office works on the retained session draft and saves back on request',{timeout:100000},async t=>{
  const dir=await directory(t),runtime=await createRuntime({dataDir:dir,sourceDb:null}),owner='sheet-test'
  try {
    const {item}=await runtime.api(owner,'POST','/api/library/files',{name:'草稿.xlsx',format:'xlsx',columns:['阶段'],rows:[['原始值']]})
    const original=await readFile(item.target)
    const {session}=await runtime.api(owner,'POST','/api/library/items/'+item.id+'/univer-session',{})
    const viewer=await fetch(session.viewerUrl)
    const html=await viewer.text()
    assert.ok(html.includes('moki:univer-save-ready'), 'Office viewer must acknowledge a synchronized draft before Save')
    assert.ok(html.includes('event.code !== "KeyD"'), 'The Office frame must handle Alt+D before the editor consumes the key')
    checkSheetShortcut(html)
    const office=await runtime.office(owner),args=[session.sessionId,item.id]
    const change=await office.execute(...args,"univerAPI.getActiveWorkbook().getActiveSheet().getRange('A2').setValue('草稿值')",session.unitId)
    assert.equal(change.committed,true)
    assert.match(JSON.stringify(await office.inspect(...args,'A2',session.unitId)),/草稿值/)
    assert.deepEqual(await readFile(item.target),original)
    await runtime.api(owner,'POST','/api/library/items/'+item.id+'/univer-session/'+session.sessionId+'/save',{})
    const saved=await runtime.api(owner,'GET','/api/library/items/'+item.id+'/structured-preview')
    assert.match(JSON.stringify(saved),/草稿值/)
  } finally {await runtime.close()}
})

test('marquee stays translucent and selects the intersected cards or rows without shifting them', {timeout:60000}, async t=>{
  const [executablePath]=await browserExecutables().catch(()=>[])
  if(!executablePath) return t.skip('A local Chrome or Edge is required to render the library')
  const {default:puppeteer}=await import('puppeteer-core')
  const runtime=await createRuntime({dataDir:await directory(t),sourceDb:null})
  let browser
  try {
    for(let i=0;i<90;i++) runtime.repository.create({kind:'folder',name:'Folder '+i,tags:[]})
    browser=await puppeteer.launch({executablePath,headless:true,pipe:true})
    const page=await browser.newPage()
    const selected=()=>page.$$eval('article[data-resource-selected="true"]',rows=>rows.map(r=>r.dataset.resourceId).sort())
    for(const mode of ['grid','list']) for(const theme of ['light','dark']){
      await page.setViewport({width:mode==='list' && theme==='dark'?380:960,height:660})
      const frame=runtime.openFrame(mode+'-'+theme,'dsh-app://app')
      await page.goto(frame.url+'?theme='+theme,{waitUntil:'domcontentloaded'})
      await page.click(mode==='grid'?'[aria-label="卡片模式"]':'[aria-label="列表模式"]')
      await page.waitForSelector('[data-library-view="'+mode+'"] .library-window article')
      await page.evaluate(theme=>{
        const root=document.documentElement
        root.style.setProperty('--dsw-alias-bg-multi-select',theme==='dark'?'#202124':'#f5f6f7')
        root.style.setProperty('--dsw-alias-link',theme==='dark'?'#93b4ff':'#4176e6')
        document.querySelector('.library-resource-scroll').scrollTop=320
      },theme)
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
      const drag=await page.evaluate(({mode,reverse})=>{
        const surface=document.querySelector('.library-resource-scroll'),box=surface.getBoundingClientRect()
        const rows=[...surface.querySelectorAll('article')].map(el=>({el,id:el.dataset.resourceId,rect:el.getBoundingClientRect()}))
        const top=surface.querySelector('.library-list-header')?.getBoundingClientRect().bottom ?? box.top
        const visible=rows.filter(({rect})=>rect.top>=top && rect.bottom<box.bottom)
        const first=visible[0],second=visible.find(({rect})=>rect.top>first.rect.top+1)
        const neighbor=visible[1].rect
        const a=reverse?second:first,b=reverse?first:second
        const startX=mode==='grid'?(first.rect.right+neighbor.left)/2
          :a.el.querySelector(reverse?'.library-list-name-column':'[data-resource-modified]').getBoundingClientRect().right-4
        const endX=mode==='grid' && !reverse?neighbor.left+neighbor.width/2:first.rect.left+first.rect.width/2
        const startY=a.rect.top+a.rect.height/2,endY=b.rect.top+b.rect.height/2
        const ids=rows.filter(({rect:r})=>r.left<=Math.max(startX,endX) && r.right>=Math.min(startX,endX)
          && r.top<=Math.max(startY,endY) && r.bottom>=Math.min(startY,endY)).map(r=>r.id).sort()
        return {startX,startY,endX,endY,ids,top:box.top,insideRow:!!document.elementFromPoint(startX,startY).closest('article')}
      },{mode,reverse:theme==='dark'})
      assert.equal(drag.insideRow,mode==='list')
      assert.ok(drag.ids.length>=2)
      await page.mouse.move(drag.startX,drag.startY)
      await page.mouse.down()
      await page.mouse.move(drag.endX,drag.endY,{steps:5})
      await page.waitForSelector('.library-selection-rect',{visible:true,timeout:2500})
      const appearance=await page.$eval('.library-selection-rect',el=>{
        const style=getComputedStyle(el),ctx=document.createElement('canvas').getContext('2d')
        ctx.fillStyle=style.backgroundColor;ctx.fillRect(0,0,1,1)
        return {alpha:ctx.getImageData(0,0,1,1).data[3],border:style.borderTopWidth,pointer:style.pointerEvents,
          top:el.getBoundingClientRect().top,position:style.position}
      })
      assert.ok(appearance.alpha>0 && appearance.alpha<64,mode+' '+theme+' must leave the files visible')
      assert.deepEqual([appearance.position,appearance.top,appearance.border,appearance.pointer],['fixed',Math.min(drag.startY,drag.endY),'1px','none'])
      assert.deepEqual(await selected(),drag.ids)
      await page.mouse.up()
      await page.waitForSelector('.dsh-selection-toolbar')
      assert.equal(await page.$('.library-selection-rect'),null)
      assert.deepEqual(await selected(),drag.ids)
      assert.equal(await page.$$eval('[data-resource-select] input:checked',els=>els.length),drag.ids.length)
    }
  } finally {await browser?.close();await runtime.close()}
})

test('list row whitespace keeps ordinary clicks and supports additive marquee, while file handles still drag',{timeout:45000},async t=>{
  const [executablePath]=await browserExecutables().catch(()=>[])
  if(!executablePath)return t.skip('A local Chrome or Edge is required to exercise pointer gestures')
  const {default:puppeteer}=await import('puppeteer-core')
  const runtime=await createRuntime({dataDir:await directory(t),sourceDb:null})
  let browser
  try {
    for(const name of ['Alpha','Beta','Gamma'])runtime.repository.create({kind:'folder',name,tags:[]})
    const name='sample.txt',target=join(runtime.dataDir,name)
    await writeFile(target,'List pointer test')
    const file=runtime.repository.create({kind:'local_file',name,target,tags:[]})
    browser=await puppeteer.launch({executablePath,headless:true,pipe:true})
    const page=await browser.newPage()
    await page.setViewport({width:1000,height:660})
    await page.goto(runtime.openFrame('list-pointer','dsh-app://app').url)
    await page.click('[aria-label="列表模式"]')
    const row=id=>'article[data-resource-id="'+id+'"]'
    const point=(selector,edge='middle')=>page.$eval(selector,(el,edge)=>{
      const box=el.getBoundingClientRect()
      return {x:edge==='right'?box.right-2:box.left+box.width/2,y:box.top+box.height/2}
    },edge)
    await page.waitForSelector(row(file.id))
    await page.evaluate(()=>{
      window.draggedItems=[]
      document.addEventListener('dragstart',event=>window.draggedItems.push(event.dataTransfer.getData('application/x-moki-resource-library-item')))
    })

    const blank=await point(row(file.id)+' .library-list-name-column','right')
    await page.mouse.move(blank.x,blank.y)
    await page.mouse.down()
    await page.mouse.move(blank.x+1,blank.y+1)
    await page.mouse.up()
    await page.waitForSelector('[aria-label="关闭预览"]',{visible:true})
    await page.click('[aria-label="关闭预览"]')

    const ids=await page.$$eval('article[data-resource-id]',els=>els.map(el=>el.dataset.resourceId))
    await page.click(row(ids[0])+' [data-resource-select]')
    const start=await point(row(ids[2])+' .library-list-actions','right')
    const end=await point(row(ids[3])+' .library-list-name-column','right')
    await page.keyboard.down('Control')
    await page.mouse.move(start.x,start.y)
    await page.mouse.down()
    await page.mouse.move(end.x,end.y,{steps:6})
    await page.mouse.up()
    await page.keyboard.up('Control')
    assert.deepEqual(await page.$$eval('[data-resource-selected="true"]',els=>els.map(el=>el.dataset.resourceId)),[ids[0],ids[2],ids[3]])
    assert.deepEqual(await page.evaluate(()=>window.draggedItems),[])
    await page.click('[aria-label="清除选择"]')

    for(const handle of ['.library-list-icon','[data-resource-name]']){
      const origin=await point(row(file.id)+' '+handle)
      await page.mouse.move(origin.x,origin.y)
      await page.mouse.down()
      await page.mouse.move(origin.x+16,origin.y,{steps:4})
      await page.keyboard.press('Escape')
      await page.mouse.up()
    }
    assert.deepEqual(await page.evaluate(()=>window.draggedItems),[file.id,file.id])
    assert.equal(await page.$('.library-selection-rect'),null)

    // Release a cancelled Windows drag over its source, as happens when the OS returns no drop effect.
    await page.setRequestInterception(true)
    page.on('request',request=>{
      const path=new URL(request.url()).pathname
      if(path.endsWith('/api/dsh/drag-files') || path.endsWith('/api/dsh/prepare-file-drag')){
        return request.respond({status:200,contentType:'application/json',body:'{"effect":0}'})
      }
      return request.continue()
    })
    await page.goto(runtime.openFrame('list-native-drag','dsh-app://app').url+'?nativeFileDrag=1')
    await page.click('[aria-label="列表模式"]')
    await page.waitForSelector(row(file.id))
    const origin=await point(row(file.id)+' [data-resource-name]')
    const sent=page.waitForRequest(r=>r.url().endsWith('/api/dsh/drag-files'))
    await page.mouse.move(origin.x,origin.y)
    await page.mouse.down()
    await page.mouse.move(origin.x+16,origin.y,{steps:4})
    assert.deepEqual(JSON.parse((await sent).postData()).ids,[file.id])
    await page.mouse.up()
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
    assert.equal(await page.$('[aria-label="关闭预览"]'),null,'Finishing the drag must not also open a preview')
    await page.click(row(file.id)+' [data-resource-name]')
    await page.waitForSelector('[aria-label="关闭预览"]',{visible:true,timeout:2500})
  } finally {await browser?.close();await runtime.close()}
})

test('Office selection values refresh after a remote draft edit and formula recalculation', {timeout:100000}, async t => {
  const [executablePath] = await browserExecutables()
  assert.ok(executablePath, 'A local Chrome or Edge is required for the Office collaboration regression')
  const {default:puppeteer} = await import('puppeteer-core')
  const runtime = await createRuntime({dataDir:await directory(t), sourceDb:null})
  let browser
  try {
    const owner = 'selection-refresh'
    const {item} = await runtime.api(owner, 'POST', '/api/library/files', {
      name:'selection-refresh.xlsx', format:'xlsx', columns:['Label','Value','Computed'], rows:[['TARGET',20,40]],
    })
    const original = await readFile(item.target)
    const {session} = await runtime.api(owner, 'POST', '/api/library/items/'+item.id+'/univer-session', {})
    const office = await runtime.office(owner)
    await office.execute(session.sessionId, item.id, "univerAPI.getActiveWorkbook().getActiveSheet().getRange('C2').setFormula('=B2*2')", session.unitId)
    browser = await puppeteer.launch({executablePath, headless:true, pipe:true})
    const page = await browser.newPage()
    await page.goto(session.viewerUrl, {waitUntil:'domcontentloaded'})
    await page.waitForFunction(() => window.univerAPI?.getActiveWorkbook?.()?.getActiveSheet())
    await page.evaluate(() => {
      window.qaSelections = []
      window.addEventListener('message', event => {
        if (event.data?.type === 'moki:univer-selection-changed') window.qaSelections.push(event.data.selection)
      })
    })
    const points = await (await page.waitForFunction(() => {
      const canvas = [...document.querySelectorAll('canvas')].find(element => element.clientHeight > 180)
      if (!canvas) return false
      const grid = canvas.getBoundingClientRect(), sheet = window.univerAPI.getActiveWorkbook().getActiveSheet()
      const points = ['B2','C2'].map(address => {
        const rect = sheet.getRange(address).getCellRect()
        return {x:grid.x+rect.x+rect.width/2, y:grid.y+rect.y+rect.height/2}
      })
      return points.every(point => document.elementFromPoint(point.x, point.y) === canvas) && points
    })).jsonValue()
    await page.mouse.move(points[0].x, points[0].y)
    await page.mouse.down()
    await page.mouse.move(points[1].x, points[1].y, {steps:5})
    await page.mouse.up()
    await page.waitForFunction(() => window.qaSelections.at(-1)?.range === 'B2:C2')
    const before = await page.evaluate(() => window.qaSelections.at(-1))
    assert.deepEqual(before.values, [['20','40']])
    assert.deepEqual(before.formulas, [['','=B2*2']])
    await office.execute(session.sessionId, item.id, "univerAPI.getActiveWorkbook().getActiveSheet().getRange('B2').setValue(153)", session.unitId)
    await page.waitForFunction(() => {
      const selection = window.qaSelections.at(-1)
      return selection?.range === 'B2:C2' && selection.values[0][0] === '153' && selection.values[0][1] === '306'
    }, {timeout:12000})
    const after = await page.evaluate(() => window.qaSelections.at(-1))
    assert.deepEqual(after.formulas, [['','=B2*2']])
    assert.equal(after.selectedText, '153\t306')
    assert.deepEqual(await readFile(item.target), original, 'remote draft updates must not save the source')
  } finally {await browser?.close(); await runtime.close()}
})

test('PPT text selection hands off its exact shape range without overwriting remote edits, then saves and reopens', {timeout:100000}, async t => {
  const [executablePath] = await browserExecutables()
  assert.ok(executablePath)
  const {default:puppeteer} = await import('puppeteer-core')
  const runtime = await createRuntime({dataDir:await directory(t),sourceDb:null})
  let browser
  try {
    const owner='ppt-selection'
    const {item}=await runtime.api(owner,'POST','/api/library/files',{name:'selection.pptx',format:'pptx',slides:[
      {title:'SLIDE ONE CONTROL',paragraphs:['KEEP PAGE ONE']},
      {title:'SLIDE TWO TARGET',paragraphs:['REPEAT PPT','KEEP MIDDLE','REPEAT PPT','KEEP END']},
    ]})
    const original=await readFile(item.target)
    const {session}=await runtime.api(owner,'POST','/api/library/items/'+item.id+'/univer-session',{})
    const office=await runtime.office(owner)
    browser=await puppeteer.launch({executablePath,headless:true,pipe:true})
    const page=await browser.newPage();await page.setViewport({width:1600,height:1000});await page.goto(session.viewerUrl)
    await page.waitForFunction(()=>window.univerAPI?.getActivePresentation?.())
    await page.evaluate(()=>window.postMessage({type:'moki:univer-theme',dark:true},location.origin))
    await page.waitForFunction(()=>univerAPI.isDarkMode())
    const before=await page.evaluate(()=>{
      const p=univerAPI.getActivePresentation(),s=p.getSlides()[1];p.setActiveSlide(s)
      window.qaSelections=[];window.qaCompose=[]
      window.addEventListener('message',e=>{if(e.data?.type==='moki:univer-selection-changed')qaSelections.push(e.data.selection);if(e.data?.type==='moki:univer-compose-shortcut')qaCompose.push(e.data)})
      return s.getShape('shape-3').getTransform()
    })
    await page.waitForSelector('canvas')
    await new Promise(r=>setTimeout(r,500))
    await page.mouse.click(580,490);await page.mouse.click(580,490,{clickCount:2})
    await page.waitForSelector('[data-u-comp="shape-text-editor-content"] canvas')
    const canvas=await page.$('[data-u-comp="shape-text-editor-content"] canvas'),rect=await canvas.boundingBox()
    await page.mouse.move(rect.x+2,rect.y+72);await page.mouse.down();await page.mouse.move(rect.x+127,rect.y+72,{steps:10});await page.mouse.up()
    await page.waitForFunction(()=>qaSelections.at(-1)?.textSelection?.startOffset===23&&qaSelections.at(-1)?.textSelection?.endOffset===33)
    const selected=await page.evaluate(()=>qaSelections.at(-1))
    assert.equal(selected.page,2);assert.equal(selected.slideId,'slide-2');assert.deepEqual(selected.selectedElementIds,['shape-3']);assert.equal(selected.selectedText,'REPEAT PPT')
    await page.keyboard.down('Alt');await page.keyboard.press('KeyD');await page.keyboard.up('Alt')
    await page.waitForFunction(()=>qaCompose.length>0)
    assert.deepEqual(await page.evaluate(()=>qaCompose.at(-1).editorSelection.textSelection),selected.textSelection)
    assert.equal(await page.$('[data-u-comp="shape-text-editor-content"]'),null,'Handing off must close the stale text overlay')
    assert.deepEqual(await page.evaluate(()=>univerAPI.getActivePresentation().getSlideById('slide-2').getShape('shape-3').getTransform()),before,'Selecting and handing off must not resize a text box')
    assert.deepEqual((await page.evaluate(()=>qaSelections.at(-1))).textSelection,selected.textSelection,'The exact text range survives moving focus to the conversation')
    await office.execute(session.sessionId,item.id,`const text=univerAPI.getActivePresentation().getSlideById('slide-2').getShape('shape-3').getText();const rich=text.getRichText();const b=rich.getData().body;if(b.dataStream.slice(23,33)!=='REPEAT PPT')throw Error('range mismatch');const replacement='PPT-DSH-0155',delta=replacement.length-10;b.dataStream=b.dataStream.slice(0,23)+replacement+b.dataStream.slice(33);for(const p of b.paragraphs||[])if(p.startIndex>=33)p.startIndex+=delta;for(const r of b.textRuns||[]){if(r.st>=33)r.st+=delta;if(r.ed>=33)r.ed+=delta;}text.setRichText(rich);return text.getPlainText();`,session.unitId)
    const expected='REPEAT PPT\nKEEP MIDDLE\nPPT-DSH-0155\nKEEP END'
    await page.waitForFunction(expected=>univerAPI.getActivePresentation()?.getSlideById('slide-2').getShape('shape-3').getText().getPlainText()===expected,{timeout:12000},expected)
    await new Promise(r=>setTimeout(r,1400))
    assert.equal(await page.evaluate(()=>univerAPI.getActivePresentation().getSlideById('slide-2').getShape('shape-3').getText().getPlainText()),expected,'An old editor must not write back over the remote result')
    assert.deepEqual(await readFile(item.target),original)
    await runtime.api(owner,'POST','/api/library/items/'+item.id+'/univer-session/'+session.sessionId+'/save',{})
    const saved=unzipSync(await readFile(item.target))
    assert.match(strFromU8(saved['ppt/slides/slide2.xml']),/PPT-DSH-0155/)
    assert.match(strFromU8(saved['ppt/slides/slide2.xml']),/REPEAT PPT/)
    assert.match(strFromU8(saved['ppt/slides/slide1.xml']),/KEEP PAGE ONE/)
    await page.close()
    const fresh=await createRuntime({dataDir:await directory(t),sourceDb:null})
    try {
      const reopenedItem=fresh.repository.create({kind:'local_file',name:item.name,target:item.target,tags:[]})
      const {session:reopened}=await fresh.api(owner,'POST','/api/library/items/'+reopenedItem.id+'/univer-session',{})
      const reopenedPage=await browser.newPage();await reopenedPage.setViewport({width:1600,height:1000});await reopenedPage.goto(reopened.viewerUrl)
      await reopenedPage.waitForFunction(()=>window.univerAPI?.getActivePresentation?.()).catch(async error=>{throw new Error('Reopened PPT: '+await reopenedPage.evaluate(()=>document.body.innerText)+' '+reopened.viewerUrl,{cause:error})})
      const texts=await reopenedPage.evaluate(()=>univerAPI.getActivePresentation().getSlides().map(s=>s.getShapes().map(shape=>shape.getText().getPlainText())))
      assert.deepEqual(texts,[['SLIDE ONE CONTROL','KEEP PAGE ONE'],['SLIDE TWO TARGET',expected]])
      await reopenedPage.evaluate(()=>{const p=univerAPI.getActivePresentation();p.setActiveSlide(p.getSlides()[1]);window.qaCompose=[];window.addEventListener('message',e=>{if(e.data?.type==='moki:univer-compose-shortcut')qaCompose.push(e.data)})})
      await new Promise(r=>setTimeout(r,400))
      await reopenedPage.mouse.click(580,490);await reopenedPage.mouse.click(580,490,{clickCount:2})
      await reopenedPage.waitForSelector('[data-u-comp="shape-text-editor-content"] canvas')
      const textCanvas=await reopenedPage.$('[data-u-comp="shape-text-editor-content"] canvas'),textRect=await textCanvas.boundingBox()
      await reopenedPage.mouse.move(textRect.x+2,textRect.y+72);await reopenedPage.mouse.down();await reopenedPage.mouse.move(textRect.x+170,textRect.y+72,{steps:8});await reopenedPage.mouse.up()
      await reopenedPage.keyboard.type('LOCAL HAND EDIT')
      await reopenedPage.keyboard.down('Alt');await reopenedPage.keyboard.press('KeyD');await reopenedPage.keyboard.up('Alt')
      await reopenedPage.waitForFunction(()=>qaCompose.length>0)
      const freshOffice=await fresh.office(owner)
      const manual=await freshOffice.execute(reopened.sessionId,reopenedItem.id,"return univerAPI.getActivePresentation().getSlideById('slide-2').getShape('shape-3').getText().getPlainText()",reopened.unitId)
      assert.match(manual.value,/LOCAL HAND EDIT/,'Handing off must commit pending manual typing, not discard it')
      assert.doesNotMatch(strFromU8(unzipSync(await readFile(item.target))['ppt/slides/slide2.xml']),/LOCAL HAND EDIT/,'Manual draft typing must not silently save the source')
      await reopenedPage.close()
    } finally {await fresh.close()}
  } finally {await browser?.close();await runtime.close()}
})

test('sheet formula reference colors remain distinct and readable while switching themes mid-edit',{timeout:100000},async t=>{
  const [executablePath]=await browserExecutables().catch(()=>[])
  if(!executablePath) return t.skip('A local Chrome or Edge is required to render the sheet')
  const {default:puppeteer}=await import('puppeteer-core')
  const runtime=await createRuntime({dataDir:await directory(t),sourceDb:null})
  let browser
  try {
    const owner='formula-colors'
    const {item}=await runtime.api(owner,'POST','/api/library/files',{name:'公式.xlsx',format:'xlsx',columns:['数值'],rows:[[1]]})
    const {session}=await runtime.api(owner,'POST','/api/library/items/'+item.id+'/univer-session',{})
    browser=await puppeteer.launch({executablePath,headless:true,pipe:true})
    const page=await browser.newPage()
    await page.goto(session.viewerUrl,{waitUntil:'domcontentloaded'})
    await page.waitForFunction(()=>window.univerAPI?.getActiveWorkbook?.()?.getActiveSheet())
    const refs='ABCDEFGHIJKL'.split('').map(column=>column+'2')
    const formula='=SUM('+[...refs,refs[0]].join(',')+')'
    await page.evaluate(formula=>{window.univerAPI.getActiveWorkbook().getActiveSheet().getRange('A3').setFormula(formula)},formula)
    const point=await (await page.waitForFunction(()=>{
      const cell=window.univerAPI.getActiveWorkbook().getActiveSheet().getRange('A3')
      const canvas=[...document.querySelectorAll('canvas')].find(canvas=>canvas.clientHeight>180)
      if(!canvas) return false
      const grid=canvas.getBoundingClientRect(),rect=cell.getCellRect()
      const x=grid.x+rect.x+rect.width/2,y=grid.y+rect.y+rect.height/2
      return document.elementFromPoint(x,y)===canvas && {x,y}
    })).jsonValue()
    await page.mouse.click(point.x,point.y,{count:2})
    await page.waitForFunction(()=>window.univerAPI.getActiveWorkbook().isCellEditing())
    const luminance=rgb=>rgb.map(channel=>channel/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4)
      .reduce((sum,v,i)=>sum+v*[0.2126,0.7152,0.0722][i],0)
    for(const dark of [true,false,true]) {
      await page.evaluate(dark=>window.postMessage({type:'moki:univer-theme',dark},location.origin),dark)
      await page.waitForFunction((dark,formula)=>{
        const api=window.univerAPI,body=api._univerInstanceService.getUnit('__INTERNAL_EDITOR__DOCS_NORMAL')?.getBody()
        return api.isDarkMode()===dark && api.getActiveWorkbook().isCellEditing() && body?.dataStream.trimEnd()===formula && body.textRuns?.length>12
      },{},dark,formula)
      const colors=await page.evaluate(()=>{
        const body=window.univerAPI._univerInstanceService.getUnit('__INTERNAL_EDITOR__DOCS_NORMAL').getBody()
        return body.textRuns.filter(run=>/^[A-L]2$/.test(body.dataStream.slice(run.st,run.ed))).map(run=>run.ts.cl.rgb)
      })
      assert.equal(colors.length,13)
      assert.equal(new Set(colors).size,12)
      assert.equal(colors[0],colors.at(-1))
      for(const hex of new Set(colors)) {
        const source=hex.slice(1).match(/../g).map(channel=>parseInt(channel,16))
        // Univer's dark canvas filter preserves hue and reverses average brightness.
        const offset=255-0.667*source.reduce((a,b)=>a+b)
        const ink=dark?source.map(channel=>Math.round(Math.min(255,Math.max(0,channel+offset)))):source
        const contrast=dark?(luminance(ink)+0.05)/(luminance([31,33,36])+0.05):1.05/(luminance(ink)+0.05)
        assert.ok(contrast>=4.5,`Reference ${hex} has contrast ${contrast} in ${dark?'dark':'light'} mode`)
      }
    }
  } finally {await browser?.close();await runtime.close()}
})

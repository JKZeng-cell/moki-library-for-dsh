import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createRuntime} from '../lib/host.mjs'
import {previewDestination} from '../src/preferences.mjs'
import {listenForTaskFiles} from '../src/task-files.mjs'

test('automatic and explicit file destinations in both library surfaces',()=>{
  for (const surface of ['main','side']) {
    for (const mode of ['main','window','system']) {
      assert.equal(previewDestination(mode,surface),mode)
      assert.equal(previewDestination(mode,surface,'sidebar'),'sidebar')
    }
    assert.equal(previewDestination(undefined,surface),surface==='side'?'sidebar':'window')
  }
})

test('task files use original paths, survive restarts and respect disabled and removed mappings',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'moki-task-')), source=join(dir,'artifact.txt'), other=join(dir,'manual.txt')
  t.after(()=>rm(dir,{recursive:true,force:true}))
  await writeFile(source,'delivered');await writeFile(other,'previous')
  let enabled=false
  const config={dataDir:dir,sourceDb:null,autoMapTaskFiles:{get:()=>enabled}}
  let runtime=await createRuntime(config)
  try{
    await runtime.taskFiles.map([source])
    assert.equal(runtime.repository.list().length,0)
    enabled=true
    runtime.repository.create({name:'手动映射',kind:'local_file',target:other,tags:[]})
    await Promise.all([runtime.taskFiles.map([other,dir,source,source]),runtime.taskFiles.map([source])])
    const items=runtime.repository.list(),folder=items.find(i=>i.kind==='folder'),mapped=items.find(i=>i.target===source)
    assert.equal(items.length,3);assert.equal(mapped.parentId,folder.id);assert.equal(folder.name,'DSH 任务文件')
    await runtime.close(); runtime=await createRuntime(config)
    assert.deepEqual(await runtime.taskFiles.map([source]),[])
    await runtime.api('test','DELETE','/api/library/items/'+mapped.id)
    assert.deepEqual(await runtime.taskFiles.map([source]),[])
    enabled=false
    assert.equal(runtime.repository.find(folder.id).name,folder.name)
  }finally{await runtime.close()}
})

test('successful file creation, deliveries and new workspace files trigger mapping',async()=>{
  const listeners=new Map(),calls=[],session={id:'s'},actor={agent:{session}}
  let enabled=true
  const on=(name,fn)=>listeners.set(name,[...(listeners.get(name) ?? []),fn])
  const files=[{path:'kept.txt',deleted:0},{path:'existing.txt',deleted:0}]
  const child={on,effect(){},fs:{processPath:p=>p},workspaceChanges:{summary:()=>({cwd:tmpdir(),files}),diff:async(_s,_seq,index)=>({kind:'text',before:index!==0,after:true})}}
  listenForTaskFiles({on,inject:(_deps,init)=>init(child)},{enabled:()=>enabled,map:async paths=>{if(enabled)calls.push(...paths)}})
  const emit=async(name,...args)=>{for(const listener of listeners.get(name))await listener(...args)}
  const source=join(tmpdir(),'kept.txt')
  const policy={kind:'createIfAbsent'}
  assert.equal(await listeners.get('fs/write-intent')[0](source,actor,async()=>policy),policy)
  await emit('fs/observed',source,{kind:'present'},actor)
  await emit('session/event',session,{type:'deliverables/presented',data:{files:[{path:source}]}})
  await emit('session/event',session,{type:'turn/start',data:{turn:1}})
  await emit('session/event',session,{type:'workspace/changes',seq:12,data:{turn:1}})
  await new Promise(resolve=>setImmediate(resolve))
  assert.deepEqual(calls,[source,source,source])
  enabled=false
  await emit('session/event',session,{type:'deliverables/presented',data:{files:[{path:source}]}})
  assert.equal(calls.length,3)
})

test('composer picker gates search and original bytes and indexes a mapped folder on demand',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'moki-picker-')),folder=join(dir,'attached')
  t.after(()=>rm(dir,{recursive:true,force:true}))
  let enabled=false
  const runtime=await createRuntime({dataDir:dir,sourceDb:null,composerPicker:{get:()=>enabled}})
  const get=query=>runtime.picker(new Request('http://localhost/?'+new URLSearchParams(query)))
  try{
    await mkdir(folder);await writeFile(join(folder,'备忘.txt'),'附件正文')
    const item=runtime.repository.create({name:'资料',kind:'local_folder',target:folder,tags:[]})
    assert.equal((await get({})).status,403)
    enabled=true
    const rows=await (await get({parent:item.id,refresh:'1'})).json()
    assert.equal(rows.items[0].name,'备忘.txt')
    const id=rows.items[0].id
    assert.equal((await (await get({q:'备忘'})).json()).items[0].id,id)
    const file=await get({file:id})
    assert.equal(await file.text(),'附件正文');assert.match(file.headers.get('content-disposition'),/filename\*=/)
    assert.equal((await get({file:item.id})).status,404)
    enabled=false
    assert.equal((await get({file:id})).status,403)
  }finally{await runtime.close()}
})

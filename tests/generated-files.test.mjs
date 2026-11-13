import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,readFile,rm,realpath,mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createRuntime} from '../lib/host.mjs'
import {resolveGeneratedFile,registerGeneratedFiles,generatedFileAction} from '../src/generated-files.mjs'

test('explicit file opening deduplicates mappings, works with auto mapping off and survives restart',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'moki-generated-')),target=join(dir,'a file 中文.html'),dataDir=join(dir,'data')
  t.after(()=>rm(dir,{recursive:true,force:true}));await writeFile(target,'<h1>Keep original</h1>')
  let runtime=await createRuntime({dataDir,sourceDb:null,autoMapTaskFiles:false})
  try {
    const [a,b]=await Promise.all([runtime.taskFiles.open(target),runtime.taskFiles.open(target)])
    assert.equal(a.id,b.id);assert.equal(runtime.repository.list().length,2);assert.equal(runtime.taskFiles.enabled(),false)
    assert.equal(runtime.repository.find(a.parentId).name,'DSH 任务文件')
    await assert.rejects(runtime.taskFiles.open(dir));await assert.rejects(runtime.taskFiles.open(join(dir,'missing')))
    assert.equal(await readFile(target,'utf8'),'<h1>Keep original</h1>')
    await runtime.close();runtime=await createRuntime({dataDir,sourceDb:null})
    assert.equal((await runtime.taskFiles.open(target)).id,a.id)
  }finally{await runtime.close()}
})

test('generated file coordinates resolve through the owning DSH session and reject invalid events',async()=>{
  const calls=[],path=join(tmpdir(),'generated.html'),signal=new AbortController().signal
  const ctx={sandboxPolicy:{workspaceRoot:tmpdir()},sessionQuery:{async readEvent(input){calls.push(input);return {target:{type:'deliverables/presented',data:{files:[{path:'generated.html'}]}},session:{cwd:tmpdir()}}}},
    workspaceChanges:{summary:()=>({cwd:tmpdir(),files:[{path:'generated.html'}]})},workspaceFiles:{async stat(scope,target){calls.push({scope,target});return {absolutePath:path}}},
    fs:{processPathFromHostPath:p=>p,resolve:async p=>p,processPath:p=>p}}
  assert.equal(await resolveGeneratedFile(ctx,{kind:'present',sessionId:'one',seq:2,index:0},signal),path)
  assert.equal(calls[0].sessionId,'one');assert.equal(calls[1].scope.sessionId,'one')
  assert.equal(await resolveGeneratedFile(ctx,{kind:'change',sessionId:'two',seq:4,index:0},signal),path)
  await assert.rejects(resolveGeneratedFile(ctx,{kind:'present',sessionId:'one',seq:2,index:4},signal))
  await assert.rejects(resolveGeneratedFile(ctx,{kind:'present',sessionId:'one',seq:-1,index:0},signal))
  ctx.fs.processPathFromHostPath=()=>undefined
  await assert.rejects(resolveGeneratedFile(ctx,{kind:'change',sessionId:'two',seq:4,index:0},signal),/本机/)
})

test('generated-file endpoint refuses cross-origin or unauthenticated calls before resolving a file',async()=>{
  let route,called=false
  const ctx={inject(_deps,fn){fn(this)},effect(fn){fn()},webServer:{register(value){route=value.resource}},connection:{requestRejection:()=>403},sessionQuery:{readEvent(){called=true}}}
  registerGeneratedFiles(ctx,{taskFiles:{}})
  for(const headers of [{},{'x-moki-library':'1'},{'x-moki-library':'1','sec-fetch-site':'cross-site'}])assert.equal((await route(new Request('http://localhost/moki-library/generated-file',{headers}))).status,403)
  assert.equal(called,false)
})

test('explicit filing chooses a destination, creates colored folders, deduplicates there and persists without copying',{timeout:20000},async t=>{
  const dir=await mkdtemp(join(tmpdir(),'moki-destination-')),target=join(dir,'generated.html'),dataDir=join(dir,'data')
  t.after(()=>rm(dir,{recursive:true,force:true}));await writeFile(target,'<h1>Keep original</h1>')
  let runtime=await createRuntime({dataDir,sourceDb:null,autoMapTaskFiles:false})
  const signal=new AbortController().signal
  const ctx={sandboxPolicy:{workspaceRoot:dir},workspaceFiles:{async stat(){return {absolutePath:target}}},fs:{processPathFromHostPath:p=>p,resolve:async p=>p,processPath:p=>p}}
  const file={kind:'path',sessionId:'chat',path:target},act=data=>generatedFileAction(ctx,runtime,data,signal)
  try {
    assert.equal((await act({action:'prepare',file})).name,'generated.html')
    assert.equal(runtime.repository.list().length,0,'Opening the picker must not create a mapping')
    const first=(await act({action:'create-folder',parentId:null,name:'Campaigns',folderColor:'blue'})).item
    const second=(await act({action:'create-folder',parentId:first.id,name:'Deliverables',folderColor:'rose'})).item
    assert.equal(second.folderColor,'rose')
    assert.equal((await act({action:'folders',parentId:first.id})).items[0].id,second.id)
    assert.deepEqual((await act({action:'folders',parentId:second.id})).ancestors.map(x=>x.name),['Campaigns','Deliverables'])
    await assert.rejects(act({action:'create-folder',parentId:first.id,name:'Deliverables'}),/同名/)
    const [a,b]=await Promise.all([act({action:'add',file,parentId:second.id}),act({action:'add',file,parentId:second.id})])
    assert.equal(a.item.id,b.item.id);assert.deepEqual([a.existing,b.existing].sort(),[false,true]);assert.equal(a.item.target,await realpath(target))
    const other=await act({action:'add',file,parentId:null});assert.notEqual(other.item.id,a.item.id)
    assert.equal(runtime.repository.find(a.item.id).parentId,second.id,'Adding to another folder must not move the earlier reference')
    const localPath=join(dir,'local-folder');await mkdir(join(localPath,'Nested'),{recursive:true})
    const local=runtime.repository.create({kind:'local_folder',name:'Local',target:localPath,tags:[]})
    assert.equal((await act({action:'folders',parentId:local.id})).items[0].name,'Nested','Mapped destinations index their actual subfolders on demand')
    const localAdded=await act({action:'add',file,parentId:local.id})
    await act({action:'folders',parentId:local.id})
    assert.equal(runtime.repository.find(localAdded.item.id).parentId,local.id,'Folder refresh keeps the original external reference')
    assert.equal((await act({action:'folders',parentId:null,query:'Deliverables'})).items[0].id,second.id)
    await assert.rejects(act({action:'add',file,parentId:a.item.id}),/文件夹/)
    runtime.repository.delete(second.id)
    await assert.rejects(act({action:'add',file,parentId:second.id}),/文件夹/)
    assert.equal(await readFile(target,'utf8'),'<h1>Keep original</h1>')
    assert.equal(runtime.taskFiles.enabled(),false)
    await runtime.close();runtime=await createRuntime({dataDir,sourceDb:null,autoMapTaskFiles:false})
    assert.equal((await act({action:'add',file,parentId:null})).item.id,other.item.id)
    assert.equal(runtime.repository.find(first.id).folderColor,'blue')
  }finally{await runtime.close()}
})

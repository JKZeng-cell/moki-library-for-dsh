import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createRuntime} from '../lib/host.mjs'
import {resolveGeneratedFile,registerGeneratedFiles} from '../src/generated-files.mjs'

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

import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {ToolRuntime} from '@deepseek-ai/dsh-tools'
import {snapshotJsonValue} from '@deepseek-ai/dsh-session'
import {apply} from '../lib/host.mjs'

test('every registered library tool survives DSH native and Code Mode lossless schema projection',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'moki-tool-schema-')),definitions=new Map(),cleanup=[]
  t.after(async()=>{for(const close of cleanup.reverse())await close();await rm(dir,{recursive:true,force:true})})
  const ctx={effect(fn){const close=fn();if(typeof close==='function')cleanup.push(close)},webServer:{register(){}},tools:{register(tool){definitions.set(tool.name,tool)}},approval:{},attachments:{},systemPrompt:{section(){},context(){}},on(){},inject(){}}
  await apply(ctx,{dataDir:dir,sourceDb:null})
  assert.ok(definitions.has('moki_library_context'))
  assert.ok(definitions.size>10,'cover the complete registered tool set')
  // Use DSH's actual projection paths, not JSON.stringify (which silently
  // discards Zod's hidden ~standard metadata and misses this incompatibility).
  const registry={view:()=>({visible:definitions}),schemaOf:ToolRuntime.prototype.schemaOf}
  const native=ToolRuntime.prototype.schemas.call(registry)
  const sdk=ToolRuntime.prototype.sdkSchemas.call(registry)
  assert.equal(native.length,definitions.size);assert.equal(sdk.length,definitions.size)
  for(const tool of native){
    assert.deepEqual(snapshotJsonValue(tool.parameters),tool.parameters,tool.name)
    assert.deepEqual(tool.parameters,JSON.parse(JSON.stringify(definitions.get(tool.name).parameters)))
    assert.notEqual(tool.parameters,definitions.get(tool.name).parameters,'host projections remain detached')
  }
  const context=definitions.get('moki_library_context'),properties=context.parameters.properties
  assert.equal(properties.includeImage.default,true)
  assert.equal(properties.maxChars.default,4000)
  assert.deepEqual(properties.detail.enum,['compact','full'])
  const exec={agent:{session:{id:'schema-test'}},callId:'schema-test'}
  assert.deepEqual(await context.execute({},exec),{selection:null,editors:[]})
  await assert.rejects(context.execute({includeImage:'yes'},exec))
  await assert.rejects(context.execute({maxChars:0},exec))
  t.diagnostic(`${definitions.size} tools passed native and Code Mode projection; context defaults and input validation preserved`)
})

import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { patchViewer,officeReviewSource } from './office-viewer-patch.mjs'

const digest=createHash('sha256').update(patchViewer.toString()).update(officeReviewSource).update(import.meta.resolve('dsh-univer-office')).digest('hex').slice(0,16)
const cache=join(process.env.DSH_HOME||join(homedir(),'.dsh'),'moki-library','runtime')
export const officeAssets=join(cache,'univer-0.2.10-'+digest)
let preparing
export function prepareOffice() {
  if(!preparing)preparing=prepare().catch(error=>{preparing=undefined;throw error})
  return preparing
}

async function prepare() {
  if(await stat(join(officeAssets,'ready')).catch(()=>null))return
  await mkdir(cache,{recursive:true})
  const temp=await mkdtemp(join(cache,'prepare-'))
  try {
    const assets=fileURLToPath(new URL('../artifacts/',import.meta.resolve('dsh-univer-office')))
    await cp(join(assets,'viewer'),join(temp,'viewer'),{recursive:true})
    const worker=join(temp,'unit-content-worker.mjs')
    const code=await readFile(join(assets,'unit-content-worker.mjs'),'utf8')
    await writeFile(worker,code.replace(/createRequire(2?)\(import\.meta\.url\)/g,"createRequire$1(import.meta.resolve('dsh-univer-office'))").replaceAll("import.meta.resolve('dsh-univer-office')",JSON.stringify(import.meta.resolve('dsh-univer-office'))))
    await patchViewer(temp)
    await writeFile(join(temp,'ready'),'0.2.10')
    for (let attempt=0;;attempt++) {
      try { await rename(temp,officeAssets); break }
      catch(error) {
        if (await stat(join(officeAssets,'ready')).catch(()=>null)) break
        if (!['EPERM','EBUSY','EACCES'].includes(error.code) || attempt===7) throw error
        // Windows can briefly retain a scan handle on a newly written viewer.
        await delay(100*(attempt+1))
      }
    }
  } finally {await rm(temp,{recursive:true,force:true,maxRetries:5,retryDelay:120})}
}

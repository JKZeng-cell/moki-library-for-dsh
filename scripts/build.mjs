import { isBuiltin } from 'node:module'
import { build as bundle } from 'esbuild'
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { copyFile, readFile, mkdir, writeFile } from 'node:fs/promises'
import { buildPreviewIcons } from './preview-icons.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
// Keep the pinned gateway's native modules in its own installation, with MOKI's
// writable viewer and export-worker assets privately cached by the library.
const officeAdapter = {name:'moki-office-adapter',setup(build) {
  build.onResolve({filter:/^dsh-univer-office$/},()=>({path:'dsh-univer-office',namespace:'office-adapter'}))
  build.onLoad({filter:/.*/,namespace:'office-adapter'},async()=>{
    const upstream=await readFile(fileURLToPath(import.meta.resolve('dsh-univer-office')),'utf8')
    const source=upstream.replaceAll('import.meta.url',"import.meta.resolve('dsh-univer-office')")
      .replace(/var VIEWER_ROOT = [^;]+;/,'var VIEWER_ROOT = join(officeAssets,"viewer");')
      .replace(/var UNIT_CONTENT_WORKER_ENTRY = [^;]+;/,'var UNIT_CONTENT_WORKER_ENTRY = join(officeAssets,"unit-content-worker.mjs");')
    if(!source.includes('join(officeAssets,"viewer")') || !source.includes('join(officeAssets,"unit-content-worker.mjs")'))throw Error('Office artifact paths have changed')
    return {contents:"import { officeAssets } from './src/office-assets.mjs';\n"+source,resolveDir:root,loader:'js'}
  })
}}
const manifest=JSON.parse(await readFile(resolve(root,'package.json'),'utf8'))
await buildPreviewIcons(root)
// OFD's Node-only fallbacks must not pull native canvas/DOM packages into a browser.
const ofdBrowser={name:'ofd-browser',transform(code,id){if(id.replaceAll('\\','/').includes('/@sharp9/ofdjs/'))return code.replace(/import\(['"](?:canvas|linkedom|@xmldom\/xmldom)['"]\)/g,"Promise.reject(new Error('Use native browser Canvas and DOMParser'))").replace(/require\(['"](?:canvas|linkedom|@xmldom\/xmldom)['"]\)/g,"undefined").replace('  renderPage(page, ctx, ofd, document);','  await renderPage(page, ctx, ofd, document);')}}
const frontend=await build({ root, base:"./", configFile:false, publicDir:false, plugins:[ofdBrowser,react(),tailwind()], build:{outDir:'app',emptyOutDir:true,chunkSizeWarningLimit:1800} })
const windowIcon=frontend.output.find(asset=>asset.type==='asset' && asset.fileName.endsWith('.ico'))
if(!windowIcon)throw new Error('The preview must ship a multi-resolution taskbar icon')
// Profiles use a hoisted layout. Older DSH libraries used inside the Univer
// gateway must stay inside this bundle or they shadow the desktop's own services.
const runtimePackages=Object.keys(manifest.dependencies).filter(name=>name!=='dsh-univer-office')
const host=await bundle({metafile:true,entryPoints:[resolve(root,'src/host.mjs')],outfile:resolve(root,'lib/host.mjs'),
  bundle:true,external:runtimePackages,plugins:[officeAdapter],platform:'node',target:'node22',format:'esm',
  define:{__MOKI_WINDOW_ICON__:JSON.stringify('../app/'+windowIcon.fileName)},
  banner:{js:"import {createRequire as createHostRequire} from 'node:module'; const require=createHostRequire(import.meta.url);"}})
await mkdir(resolve(root,'.dev'),{recursive:true})
await writeFile(resolve(root,'.dev/host-metafile.json'),JSON.stringify(host.metafile))
await writeFile(resolve(root,'.dev/frontend-modules.json'),JSON.stringify(frontend.output.flatMap(asset=>Object.keys(asset.modules??{}))))
for(const output of Object.values(host.metafile.outputs)) {
  for(const dependency of output.imports) {
    if(dependency.external && !isBuiltin(dependency.path) && !Object.hasOwn(manifest.dependencies,dependency.path)) {
      throw new Error('Declare the runtime dependency '+dependency.path+' for DSH profiles with automatic peer installation disabled')
    }
  }
}
await bundle({entryPoints:[resolve(root,'src/client.js')],outfile:resolve(root,'client.js'),bundle:true,format:'iife',platform:'browser',target:'chrome132',loader:{'.css':'text'},define:{__MOKI_LIBRARY_VERSION__:JSON.stringify(manifest.version)}})
await bundle({entryPoints:[resolve(root,'src/preview-image-worker.mjs')],outfile:resolve(root,'lib/preview-image-worker.mjs'),bundle:true,packages:'external',platform:'node',target:'node22',format:'esm'})
await copyFile(resolve(root,'web/drag-target.html'),resolve(root,'app/drag-target.html'))
await copyFile(resolve(root,'src/windows-file-transfer.ps1'),resolve(root,'lib/windows-file-transfer.ps1'))
await copyFile(resolve(root,'src/windows-preview-taskbar.cs'),resolve(root,'lib/windows-preview-taskbar.cs'))

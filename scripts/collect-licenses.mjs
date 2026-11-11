import {existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync,statSync} from 'node:fs'
import {dirname,join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),packages=new Map()
const add=dir=>{const pkg=JSON.parse(readFileSync(join(dir,'package.json'),'utf8'));if(pkg.name)packages.set(pkg.name+'@'+pkg.version,{dir,pkg})}
const meta=JSON.parse(readFileSync(join(root,'.dev/host-metafile.json'),'utf8'))
const frontend=JSON.parse(readFileSync(join(root,'.dev/frontend-modules.json'),'utf8'))
for(const file of [...Object.keys(meta.inputs),...frontend].filter(file=>file.replaceAll('\\','/').includes('node_modules/'))){
 let dir=dirname(resolve(root,file.split('?')[0]))
 while(dir!==dirname(dir)&&!existsSync(join(dir,'package.json')))dir=dirname(dir)
 if(existsSync(join(dir,'package.json')))add(dir)
}
const manifest=JSON.parse(readFileSync(join(root,'package.json'),'utf8'))
for(const name of Object.keys(manifest.dependencies))add(join(root,'node_modules',name))
mkdirSync(join(root,'licenses'),{recursive:true})
const rows=[],missing=[]
for(const {dir,pkg}of [...packages.values()].sort((a,b)=>a.pkg.name.localeCompare(b.pkg.name))){
 const files=readdirSync(dir).filter(name=>/^(LICENSE|LICENCE|COPYING|NOTICE)(\.|$)/i.test(name)&&statSync(join(dir,name)).isFile())
 const label=pkg.name+' '+pkg.version,license=typeof pkg.license==='string'?pkg.license:JSON.stringify(pkg.license??'See package')
 if(files.length){
  const output=pkg.name.replaceAll('/','__').replaceAll('@','')+'-'+pkg.version+'.txt'
  writeFileSync(join(root,'licenses',output),label+'\n\n'+files.map(file=>`--- ${file} ---\n`+readFileSync(join(dir,file),'utf8')).join('\n\n'))
  rows.push(`| ${label} | ${license} | [License](licenses/${output}) |`)
 }else if(['puppeteer-core','@puppeteer/browsers'].includes(pkg.name)&&existsSync(join(root,'licenses/puppeteer-APACHE-2.0.txt'))){
  rows.push(`| ${label} | ${license} | [License](licenses/puppeteer-APACHE-2.0.txt) |`)
 }else{
  missing.push({name:pkg.name,version:pkg.version,license})
  rows.push(`| ${label} | ${license} | [Package](https://www.npmjs.com/package/${pkg.name}/v/${pkg.version}) |`)
 }
}
writeFileSync(join(root,'THIRD_PARTY_NOTICES.md'),`# Third-party notices

MOKI Library and the included MOKI source use the [MIT license](LICENSE). This inventory covers host/frontend bundled packages and directly declared runtime dependencies. Other dependencies retain notices in their installed packages. Build tools are not part of the runtime bundle.

The bundled dsh-univer-office adapter changes asset locations and applies MOKI theme, selection and preview integration patches. Its upstream code retains its Apache-2.0 license. The separately installed Univer runtime/native components have their own terms and notices; this project does not relicense them.

| Package | License | Notice |
| --- | --- | --- |
${rows.join('\n')}

## Brand and demonstration media

The DeepSeek Harness logo is the original renderer/assets/welcome-brand.svg from the official desktop application, included only to identify the host. DeepSeek marks belong to their respective owner; this independent plugin is not endorsed by DeepSeek. Brand rights are not granted by the MOKI source-code license.

Interface captures use newly created demonstration data. Cover illustration elements were generated for this project. Documentation uses system fonts; no proprietary font binaries are redistributed.

7-Zip is installed through 7zip-bin, not copied into this repository. Consult its installed copyright/license notices, including the unRAR restriction where applicable. Optional FFmpeg is supplied by the user and is not distributed by this plugin.
`)
console.log(JSON.stringify({packages:packages.size,missingLicenseFiles:missing},null,2))

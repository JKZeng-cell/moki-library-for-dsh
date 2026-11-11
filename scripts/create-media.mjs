// Capture the real plugin with isolated, synthetic demonstration content.
// Runtime files stay in .dev; only screenshots are written to docs/media/raw.
import {mkdir,writeFile,readFile} from 'node:fs/promises'
import {resolve,join,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
import sharp from 'sharp'
import {createRuntime} from '../lib/host.mjs'
import {browserExecutables} from '../src/preview-browser.mjs'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),dir=join(root,'.dev','media-'+Date.now()),out=join(root,'docs/media/raw')
await mkdir(dir,{recursive:true});await mkdir(out,{recursive:true})
const runtime=await createRuntime({dataDir:dir,sourceDb:null}),[executablePath]=await browserExecutables()
const browser=await puppeteer.launch({executablePath,headless:true,pipe:true})
const theme={'--dsw-alias-bg-base':'#141414','--dsw-alias-bg-layer-1':'#202020','--dsw-alias-bg-layer-2':'#282828','--dsw-alias-border-l1':'#292929','--dsw-alias-border-l2':'#383838','--dsw-alias-label-primary':'#f2f2f2','--dsw-alias-label-secondary':'#a3a3a3','--dsw-alias-brand-primary':'#f7f7f7','--dsw-alias-label-primary-foreground':'#141414','--dsw-alias-link':'#93b4ff','--dsw-alias-interactive-bg-active':'#292f3d','--dsw-alias-interactive-bg-hover':'#2b2b2b'}
let serial=0
async function view(item,width=980,height=720){
 const owner=item?'moki-document-'+item.id:'media-library-'+(++serial),frame=runtime.openFrame(owner,'dsh-app://app',item?.id),page=await browser.newPage()
 await page.setViewport({width,height,deviceScaleFactor:1.5})
 const query=new URLSearchParams({theme:'dark',parent:new URL(frame.url).origin,bridge:'media',chatId:owner,...(item?{document:item.id}:{})})
 await page.goto(frame.url+'?'+query)
 await page.evaluate(theme=>window.postMessage({bridge:'media',type:'surface',active:true,mode:'sidebar',dark:true,theme,font:'Arial, "Microsoft YaHei", sans-serif'},location.origin),theme)
 await page.waitForSelector(item?'.dsh-preview-content':'[data-resource-name]')
 return page
}
async function shot(page,name){await new Promise(r=>setTimeout(r,450));await page.screenshot({path:join(out,name+'.png')})}
try{
 runtime.repository.create({name:'项目资料',kind:'folder',tags:['项目'],folderColor:'blue'})
 runtime.repository.create({name:'设计素材',kind:'folder',tags:['设计'],folderColor:'orange'})
 const items={}
 for(const input of [
  {name:'项目排期.xlsx',format:'xlsx',columns:['任务','负责人','计划天数','状态'],rows:[['需求整理','设计组',2,'已完成'],['界面设计','设计组',4,'进行中'],['交互开发','开发组',6,'待开始'],['联调测试','测试组',3,'待开始'],['发布准备','项目组',2,'待开始']]},
  {name:'产品介绍.docx',format:'docx',content:'MOKI 资料库\n让文件与对话一起工作\n把项目文件、参考链接和编辑草稿放在一个工作区。\n选中文字或单元格，把当前位置交给 DSH 协作。\n所有内容均为公开演示数据。'},
  {name:'项目提案.pptx',format:'pptx',slides:[{title:'让文件与对话一起工作',paragraphs:['管理本地文件与链接','预览内容，选中位置','和 DSH 协作编辑']},{title:'先检查，再保存',paragraphs:['在草稿中查看修改','确认后写回源文件']}]}
 ]){const {item}=await runtime.api('media-maker','POST','/api/library/files',input);items[input.format]=item;runtime.repository.update(item.id,{tags:['协作']})}
 const add=async(name,bytes,tags=[])=>{const target=join(dir,name);await writeFile(target,bytes);return runtime.repository.create({name,kind:'local_file',target,tags})}
 items.text=await add('协作说明.txt','项目目标\n把分散的文件整理到同一个工作区。\n\n待优化的表达\n通过对本地文件进行查找、浏览、读取与编辑等操作，让不同文件中的内容与当前对话进行协同工作。\n\n说明\n这是专门制作的公开演示文件。',['文档'])
 const svg='<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800"><rect width="1200" height="800" fill="#eef2ff"/><circle cx="800" cy="370" r="290" fill="#2358f5"/><circle cx="800" cy="370" r="180" fill="none" stroke="#a5ffdb" stroke-width="44"/><path d="M80 620L460 150L720 620Z" fill="#161923"/><rect x="110" y="110" width="210" height="12" fill="#2358f5"/><text x="85" y="710" font-family="Arial" font-size="60" font-weight="700" fill="#161923">MOKI / SAMPLE MATERIAL</text></svg>'
 items.image=await add('视觉参考.png',await sharp(Buffer.from(svg)).png().toBuffer(),['设计'])
 const pdfPage=await browser.newPage();await pdfPage.setContent('<html><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;padding:48px;color:#17223b}h1{font-size:42px}p{font-size:20px;line-height:1.8}small{color:#64748b}</style><small>PUBLIC DEMONSTRATION</small><h1>Project brief</h1><p>One workspace for your files and ideas.</p><p>01 · Organize local files<br>02 · Preview and select content<br>03 · Collaborate, review and save</p><hr><p>All names and values in this document are examples.</p></html>');items.pdf=await add('项目简报.pdf',Buffer.from(await pdfPage.pdf({format:'A4',printBackground:true})),['参考']);await pdfPage.close()
 runtime.repository.create({name:'DeepSeek Harness 官方文档',kind:'url',target:'https://deepseek-harness.github.io/deepseek-harness/',tags:['参考']})
 const library=await view();await library.click('[aria-label="列表模式"]');await shot(library,'library-list');await library.click('[aria-label="卡片模式"]');await shot(library,'library-grid');await library.close()
 const textPage=await view(items.text,1100,640);await textPage.click('[aria-label="编辑"]');await textPage.waitForSelector('textarea[aria-label="资料文本编辑器"]')
 await textPage.$eval('textarea',el=>{const start=el.value.indexOf('通过'),end=el.value.indexOf('\n',start);el.focus();el.setSelectionRange(start,end);document.dispatchEvent(new Event('selectionchange'))})
 await shot(textPage,'text-selection');await textPage.close()
 const imagePage=await view(items.image,1000,680);await imagePage.waitForFunction(()=>document.querySelector('.dsh-preview-content img')?.naturalWidth>0);await imagePage.click('[aria-label="框选区域与 DSH 协作"]');await imagePage.waitForSelector('.library-region-selector');const rect=await imagePage.$eval('.dsh-preview-content img',el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}});await imagePage.mouse.move(rect.x+rect.w*.55,rect.y+rect.h*.18);await imagePage.mouse.down();await imagePage.mouse.move(rect.x+rect.w*.86,rect.y+rect.h*.7,{steps:8});await imagePage.waitForSelector('.library-region-box');await shot(imagePage,'image-region');await imagePage.mouse.up();await imagePage.close()
 const pdfView=await view(items.pdf,920,680);await pdfView.waitForSelector('.library-pdf-text-layer span');await shot(pdfView,'pdf-preview');await pdfView.close()
 const sheet=await view(items.xlsx,1180,700);await sheet.waitForSelector('[aria-label="编辑 Office"]');await sheet.click('[aria-label="编辑 Office"]');await sheet.waitForSelector('iframe[title*="Univer"]',{timeout:60000})
 // Screenshot only after the embedded sheet has painted; its real toolbar and
 // grid remain unmodified. All content was created above through the plugin.
 const inner=await (await sheet.$('iframe[title*="Univer"]')).contentFrame()
 await inner.waitForSelector('canvas',{timeout:60000})
 await new Promise(r=>setTimeout(r,4500))
 await sheet.mouse.move(223,250);await sheet.mouse.down();await sheet.mouse.move(223,350,{steps:12});await sheet.mouse.up()
 await shot(sheet,'excel-editor');await sheet.close()
 console.log(JSON.stringify({output:'docs/media/raw',screenshots:6,syntheticDataOnly:true}))
}finally{await browser.close();await runtime.close()}

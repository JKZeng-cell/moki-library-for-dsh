import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {zipSync,strToU8} from 'fflate'
import sharp from 'sharp'
import puppeteer from 'puppeteer-core'
import {build} from 'esbuild'
import {fileURLToPath} from 'node:url'
import {apply} from '../lib/host.mjs'
import {browserExecutables} from '../src/preview-browser.mjs'

async function setup(t){
  const dir=await mkdtemp(join(tmpdir(),'moki-selection-')),tools=new Map(),cleanup=[],images=[];let endpoint
  const ctx={effect(fn){const close=fn();if(typeof close==='function')cleanup.push(close)},webServer:{register(route){if(route.path==='/moki-library/open')endpoint=route.resource}},tools:{register(tool){tools.set(tool.name,tool)}},approval:{async request(){return 'allowed-once'}},attachments:{async saveImages(items){images.push(...items);return items.map((_,i)=>({id:'image-'+i}))}},systemPrompt:{section(){},context(){}},on(){},inject(){}}
  await apply(ctx,{dataDir:dir,sourceDb:null});t.after(async()=>{for(const close of cleanup.reverse())await close();await rm(dir,{recursive:true,force:true})})
  const invoke=(name,args={},session='selection-chat')=>tools.get('moki_library_'+name).execute(args,{agent:{session:{id:session}},callId:'selection-test'})
  const file=async(name,bytes)=>{const target=join(dir,name);await writeFile(target,bytes);return invoke('manage',{action:'create',kind:'local_file',name,target})}
  const open=async item=>(await endpoint(new Request('http://localhost/moki-library/open?'+new URLSearchParams({session:'moki-document-'+item.id,parent:'dsh-app://app',document:item.id}),{headers:{'x-moki-library':'1'}}))).json()
  return {dir,file,invoke,open,images}
}
async function waitFor(fn){const deadline=Date.now()+8000;while(Date.now()<deadline){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,40))}throw Error('selection did not reach the agent')}
async function browserFor(t){const [executablePath]=await browserExecutables(),browser=await puppeteer.launch({executablePath,headless:true,pipe:true});t.after(()=>browser.close());return browser}
async function documentPage(browser,open,item){
  const frame=await open(item),origin=new URL(frame.url).origin,page=await browser.newPage();await page.setViewport({width:940,height:700});
  await page.goto(frame.url+'?'+new URLSearchParams({document:item.id,parent:origin,bridge:'selection-qa',chatId:'selection-chat'}));
  await page.evaluate(()=>window.postMessage({bridge:'selection-qa',type:'surface',active:true,mode:'sidebar',dark:true},location.origin));
  await page.waitForSelector('.dsh-preview-content');return page
}
function pdf(){
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 500] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>','BT /F1 20 Tf 40 450 Td (PAGE_ONE_VALUE) Tj ET','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 500] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>','BT /F1 20 Tf 40 450 Td (PAGE_TWO_VALUE) Tj ET','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
  let output='%PDF-1.4\n',offsets=[0]
  for(let i=0;i<objects.length;i++){offsets.push(output.length);const body=i===3||i===5?'<< /Length '+objects[i].length+' >>\nstream\n'+objects[i]+'\nendstream':objects[i];output+=(i+1)+' 0 obj\n'+body+'\nendobj\n'}
  const xref=output.length;output+='xref\n0 8\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF';return output
}
test('large spreadsheet selections keep the full address while bounding sampled cells',async t=>{
  const browser=await browserFor(t),page=await browser.newPage()
  const result=await build({entryPoints:[fileURLToPath(new URL('../vendor/moki/web/components/resource-preview-selection.ts',import.meta.url))],bundle:true,write:false,platform:'browser',format:'iife',globalName:'SelectionCapture'})
  const code=result.outputFiles[0].text
  await page.setContent('<main id="preview" data-moki-location=\'{"kind":"sheet","sheetName":"Sheet1"}\'><table><tbody>'+Array.from({length:20},(_,r)=>'<tr>'+Array.from({length:20},(_,c)=>'<td data-cell="'+String.fromCharCode(65+c)+(r+1)+'">sample</td>').join('')+'</tr>').join('')+'</tbody></table></main>')
  await page.addScriptTag({content:code})
  const selected=await page.evaluate(()=>{const cells=document.querySelectorAll('td'),range=document.createRange();range.setStart(cells[0].firstChild,0);range.setEnd(cells[cells.length-1].firstChild,6);getSelection().addRange(range);return SelectionCapture.readPreviewSelection(document.querySelector('main'))})
  assert.equal(selected.location.range,'A1:T20');assert.equal(selected.location.cells.length,200);assert.equal(selected.location.cellsTruncated,true);await page.close()
})
test('text selection survives toolbar focus and edits only the exact occurrence, then persists', {timeout:30000},async t=>{
  const {file,invoke,open}=await setup(t),browser=await browserFor(t),item=await file('repeat.txt','same\r\nsame\r\nend');let page=await documentPage(browser,open,item)
  await page.waitForSelector('[aria-label="编辑"]');await page.click('[aria-label="编辑"]');await page.waitForSelector('textarea[aria-label="资料文本编辑器"]')
  await page.$eval('textarea',e=>{e.focus();e.setSelectionRange(5,9);document.dispatchEvent(new Event('selectionchange'))})
  let context=await waitFor(async()=>{const c=await invoke('context');return c.selection?.location?.start===6&&c.selectionRef?c:null})
  assert.equal(context.selection.location.line,2)
  await page.click('[aria-label="DSH 对话"]')
  context=await invoke('context');assert.equal(context.selection.text,'same');assert.equal(context.selection.location.start,6)
  let editor=context.editors.find(e=>e.id===item.id)
  await assert.rejects(invoke('edit_selection',{selectionRef:context.selectionRef,text:'WRONG'},'different-chat'),/失效/)
  const changed=await invoke('edit_selection',{selectionRef:context.selectionRef,text:'CHANGED'})
  assert.equal(changed.status,'completed');await page.waitForFunction(()=>document.querySelector('textarea').value==='same\nCHANGED\nend')
  assert.equal(changed.review.status,'pending');assert.equal(changed.review.pending,1)
  await page.waitForSelector('[data-moki-review-highlight]')
  const geometry=await page.$$eval('.moki-review-text-editor>pre,.moki-review-text-editor>textarea',elements=>elements.map(e=>{const s=getComputedStyle(e);return [s.font,s.padding,s.whiteSpace,s.overflowWrap,s.letterSpacing]}))
  assert.deepEqual(geometry[0],geometry[1],'review highlights must follow the same text geometry as the native-styled editor')
  assert.equal(await page.$eval('textarea',e=>e.readOnly),true)
  await assert.rejects(invoke('edit_selection',{selectionRef:context.selectionRef,text:'WRONG'}),/失效/)
  assert.equal(await readFile(item.target,'utf8'),'same\r\nsame\r\nend')
  await assert.rejects(invoke('editor',{editorId:editor.editorId,id:item.id,revision:editor.revision,operation:'replace_range',range:{start:5,end:9,expectedText:'same'},content:'wrong'}))
  editor=(await invoke('context')).editors.find(e=>e.id===item.id)
  const wrong=await invoke('editor',{editorId:editor.editorId,id:item.id,revision:editor.revision,operation:'replace_range',range:{start:0,end:4,expectedText:'mismatch'},content:'wrong'})
  assert.equal(wrong.status,'failed')
  const blocked=await invoke('editor',{editorId:editor.editorId,id:item.id,revision:editor.revision,operation:'save'});assert.equal(blocked.status,'failed')
  const next=await invoke('editor',{editorId:editor.editorId,id:item.id,revision:editor.revision,operation:'patch_text',patches:[{before:'CHANGED',after:'SECOND'}]})
  assert.equal(next.review.pending,2);await page.waitForFunction(()=>document.querySelector('textarea').value.includes('SECOND'))
  await page.click('.moki-review-buttons button:not([data-primary])')
  await page.waitForFunction(()=>document.querySelector('textarea').value.includes('CHANGED'))
  assert.equal(await page.$eval('.moki-review-label',e=>e.textContent),'1 次修改待确认')
  await page.close();page=await documentPage(browser,open,item)
  await page.waitForSelector('[data-moki-review-highlight]');assert.equal(await page.$eval('textarea',e=>e.value),'same\nCHANGED\nend')
  await page.click('.moki-review-buttons [data-primary]');await page.waitForFunction(()=>!document.querySelector('.moki-edit-review'))
  assert.equal(await page.$eval('textarea',e=>e.readOnly),false)
  editor=await waitFor(async()=>{const e=(await invoke('context')).editors.find(e=>e.id===item.id);return e&&!e.pendingReviews?e:null})
  const saved=await invoke('editor',{editorId:editor.editorId,id:item.id,revision:editor.revision,operation:'save'});assert.equal(saved.status,'completed')
  assert.equal(await readFile(item.target,'utf8'),'same\r\nCHANGED\r\nend');await page.close()
  const reopened=await documentPage(browser,open,item);await reopened.waitForFunction(()=>document.querySelector('.dsh-preview-content').textContent.includes('CHANGED'));await reopened.close()
})
test('dark text preview paints a visible selection with readable text', {timeout:30000}, async t => {
  const { file, open } = await setup(t)
  const browser = await browserFor(t)
  const selectedText = 'DSH-SELECTED-DARK'
  const item = await file('dark-selection.txt', `KEEP-TOP\n${selectedText}\nKEEP-END`)
  const page = await documentPage(browser, open, item)
  await page.evaluate(() => window.postMessage({
    bridge: 'selection-qa', type: 'surface', active: true, mode: 'sidebar', dark: true,
    theme: {
      '--dsw-alias-bg-base': '#161618',
      '--dsw-alias-bg-multi-select': '#202124',
      '--dsw-alias-label-primary': '#eeeef0',
    },
  }, location.origin))
  const selector = '.dsh-preview-content[data-preview-kind="text"] pre[data-moki-text-source]'
  await page.waitForSelector(selector)
  await page.waitForFunction(() => document.documentElement.dataset.colorScheme === 'dark')
  const result = await page.$eval(selector, (preview, text) => {
    const start = preview.textContent.indexOf(text)
    const range = document.createRange()
    range.setStart(preview.firstChild, start)
    range.setEnd(preview.firstChild, start + text.length)
    getSelection().removeAllRanges()
    getSelection().addRange(range)
    const { x, y, width, height } = range.getBoundingClientRect()
    const selection = getComputedStyle(preview, '::selection')
    return {
      text: getSelection().toString(),
      clip: { x: Math.floor(x), y: Math.floor(y), width: Math.ceil(width), height: Math.ceil(height) },
      background: getComputedStyle(preview).backgroundColor,
      highlight: selection.backgroundColor,
      foreground: selection.color,
    }
  }, selectedText)
  assert.equal(result.text, selectedText)
  const channels = color => color.match(/[\d.]+/g).slice(0, 3).map(Number)
  const luminance = color => channels(color).reduce((total, channel, index) => {
    const value = channel / 255
    const linear = value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4
    return total + linear * [.2126, .7152, .0722][index]
  }, 0)
  const highlight = luminance(result.highlight) + .05
  assert.ok(highlight / (luminance(result.background) + .05) >= 3, 'selection blends into the preview background')
  assert.ok((luminance(result.foreground) + .05) / highlight >= 4.5, 'selected text has insufficient contrast')
  const screenshot = await page.screenshot({ clip: result.clip })
  const { data, info } = await sharp(screenshot).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const [red, green, blue] = channels(result.highlight)
  let painted = 0
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i] === red && data[i + 1] === green && data[i + 2] === blue) painted++
  }
  assert.ok(painted > info.width * info.height / 4, 'selection highlight did not paint over the selected range')
  await page.close()
})

test('selection chat action quotes preview and keyboard-selected editor text without losing the exact occurrence',{timeout:30000},async t=>{
  const {file,invoke,open}=await setup(t),browser=await browserFor(t),item=await file('quick-quote.txt','same\r\nsame\r\nend'),page=await documentPage(browser,open,item)
  await page.evaluate(()=>{window.qaCompose=[];window.addEventListener('moki:assistant-compose-request',e=>qaCompose.push(e.detail))})
  await page.waitForSelector('pre[data-moki-text-source]')
  const range=await page.$eval('pre[data-moki-text-source]',e=>{const start=e.textContent.lastIndexOf('same'),r=document.createRange();r.setStart(e.firstChild,start);r.setEnd(e.firstChild,start+4);getSelection().removeAllRanges();getSelection().addRange(r);return r.getBoundingClientRect().toJSON()})
  await page.waitForSelector('[data-selection-chat-action]',{visible:true})
  const rect=await page.$eval('[data-selection-chat-action]',e=>e.getBoundingClientRect().toJSON())
  assert.ok(rect.top>=range.bottom&&rect.top-range.bottom<12,'action should sit next to the selected text')
  await page.click('[data-selection-chat-action]')
  let context=await waitFor(async()=>{const c=await invoke('context');return c.selection?.location?.start===6?c:null})
  assert.equal(context.selection.text,'same');assert.equal(context.selection.location.end,10)
  assert.equal(await page.evaluate(()=>qaCompose.at(-1).quoteSelection),true)
  await page.waitForSelector('[data-selection-chat-action]',{hidden:true})
  await page.evaluate(()=>window.dispatchEvent(new Event('resize')))
  await new Promise(r=>setTimeout(r,130));assert.equal(await page.$('[data-selection-chat-action]'),null,'dismissed selection must not reopen the action')
  await page.click('[aria-label="编辑"]');await page.waitForSelector('textarea[aria-label="资料文本编辑器"]')
  await page.click('textarea');await page.$eval('textarea',e=>e.setSelectionRange(5,5))
  await page.keyboard.down('Shift');for(let i=0;i<4;i++)await page.keyboard.press('ArrowRight');await page.keyboard.up('Shift')
  await page.waitForSelector('[data-selection-chat-action]',{visible:true})
  await page.setViewport({width:360,height:500})
  await page.waitForFunction(()=>{const r=document.querySelector('[data-selection-chat-action]')?.getBoundingClientRect();return r&&r.right<=innerWidth&&r.bottom<=innerHeight})
  await page.click('[data-selection-chat-action]')
  context=await waitFor(async()=>{const c=await invoke('context');return c.selection?.location?.start===6?c:null})
  assert.equal(context.selection.text,'same');assert.equal(context.selection.location.line,2)
  assert.equal(await page.$eval('textarea',e=>e.value),'same\nsame\nend')
  assert.equal(await readFile(item.target,'utf8'),'same\r\nsame\r\nend','quoting cannot edit or save the file')
  await page.click('textarea');await page.keyboard.press('Home');await page.keyboard.down('Shift');await page.keyboard.press('End');await page.keyboard.up('Shift')
  await page.waitForSelector('[data-selection-chat-action]',{visible:true});await page.keyboard.press('Escape')
  await page.waitForSelector('[data-selection-chat-action]',{hidden:true})
  await page.close()
})
test('PDF page text and image regions reach only the bound conversation with precise locations',{timeout:30000},async t=>{
  const {file,invoke,open,images}=await setup(t),browser=await browserFor(t),document=await file('two.pdf',pdf()),page=await documentPage(browser,open,document)
  await page.waitForSelector('.library-pdf-text-layer span')
  await page.click('.library-pdf-viewer button:nth-of-type(2)')
  await page.waitForFunction(()=>document.querySelector('.library-pdf-text-layer').textContent.includes('PAGE_TWO'))
  await page.$eval('.library-pdf-text-layer span',e=>{const range=document.createRange();range.selectNodeContents(e);const s=getSelection();s.removeAllRanges();s.addRange(range)})
  const selected=await waitFor(async()=>{const c=await invoke('context');return c.selection?.text?.includes('PAGE_TWO')?c:null})
  assert.equal(selected.selection.location.page,2)
  await page.waitForSelector('[data-selection-chat-action]',{visible:true});await page.click('[data-selection-chat-action]')
  assert.equal((await invoke('context')).selection.location.page,2)
  const read=await invoke('read',{id:document.id,page:2});assert.equal(read.pages.length,1);assert.ok(read.text.includes('PAGE_TWO'))
  await page.close()
  const image=await file('region.png',await sharp({create:{width:400,height:200,channels:3,background:'#e02020'}}).png().toBuffer()),view=await documentPage(browser,open,image)
  await view.waitForFunction(()=>document.querySelector('.dsh-preview-content img')?.naturalWidth>0)
  await view.click('[aria-label="框选区域与 DSH 协作"]')
  const bounds=await view.$eval('.dsh-preview-content img',e=>{const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})
  await view.mouse.move(bounds.x-45,bounds.y-30);await view.mouse.down();await view.mouse.move(bounds.x+45,bounds.y+30);await view.mouse.up()
  const context=await waitFor(async()=>{const c=await invoke('context');return c.images?.length?c:null}),data=context.selection
  assert.equal(data.file.id,image.id);assert.equal(data.location.coordinateSpace,'preview-pixels');assert.ok(data.location.region.width>0)
  const pixels=await sharp(images.at(-1).data).raw().toBuffer();assert.ok(pixels[0]>150&&pixels[1]<90)
  assert.equal((await invoke('context',{},'different-chat')).selection,null);assert.equal((await invoke('context',{},'different-chat')).images,undefined)
  assert.equal((await invoke('context',{includeImage:false})).images,undefined);await view.close()
})
test('agent recognizes binary formats, reads archive/OFD content and refuses binary-as-text',async t=>{
  const {file,invoke,images}=await setup(t),png=await file('no-extension',await sharp({create:{width:4,height:4,channels:3,background:'red'}}).png().toBuffer())
  const image=await invoke('read',{id:png.id});assert.equal(image.kind,'image');assert.ok(image.images.length);assert.ok(images.length)
  await assert.rejects(invoke('read',{id:png.id,mode:'text'}),/不是纯文本/)
  const archive=await file('files.zip',zipSync({'inner/note.txt':strToU8('HELLO')})),directory=await invoke('read',{id:archive.id})
  assert.equal(directory.entries[0].name,'inner/note.txt');assert.equal(directory.version,undefined)
  const ofd=await file('sample.ofd',zipSync({'OFD.xml':strToU8('<ofd:OFD><ofd:DocBody><ofd:DocRoot>Doc_0/Document.xml</ofd:DocRoot></ofd:DocBody></ofd:OFD>'),'Doc_0/Document.xml':strToU8('<ofd:Document><ofd:Pages><ofd:Page BaseLoc="Pages/Page_0/Content.xml"/></ofd:Pages></ofd:Document>'),'Doc_0/Pages/Page_0/Content.xml':strToU8('<ofd:Page><ofd:TextObject><ofd:TextCode>精确页面内容</ofd:TextCode></ofd:TextObject></ofd:Page>')}))
  const read=await invoke('read',{id:ofd.id,page:1});assert.equal(read.text,'精确页面内容');assert.equal(read.page,1)
})

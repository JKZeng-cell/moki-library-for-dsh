import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate'
import puppeteer from 'puppeteer-core'
import sharp from 'sharp'
import {createRuntime} from '../lib/host.mjs'
import {browserExecutables} from '../src/preview-browser.mjs'

test('PPT paper and thumbnail colors survive dark chrome and theme changes without changing the file', {timeout:60000}, async () => {
  const dir=await mkdtemp(join(tmpdir(),'moki-ppt-theme-'))
  const runtime=await createRuntime({dataDir:dir,sourceDb:null})
  let browser
  try {
    const {item}=await runtime.api('ppt-theme','POST','/api/library/files',{
      name:'theme.pptx',format:'pptx',slides:[
        {title:'WHITE PAPER',paragraphs:['Original black text']},
        {title:'CUSTOM BACKGROUND',paragraphs:['Keep the original blue fill']},
        {title:'LIGHT TEXT ON GRADIENT',paragraphs:['Keep original light text and gradient shapes']},
      ],
    })
    const entries=unzipSync(await readFile(item.target))
    entries['ppt/slides/slide2.xml']=strToU8(strFromU8(entries['ppt/slides/slide2.xml']).replace('<p:cSld>',
      '<p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="2458A6"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>'))
    // A page-sized gradient shape is common in authored decks. It bypasses
    // solid-color rendering, so inverted light text becomes unreadable on it.
    const backgroundShape='<p:sp><p:nvSpPr><p:cNvPr id="99" name="Gradient background"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="12192000" cy="6858000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="071A23"/></a:gs><a:gs pos="100000"><a:srgbClr val="123540"/></a:gs></a:gsLst><a:lin ang="0" scaled="1"/></a:gradFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>'
    entries['ppt/slides/slide3.xml']=strToU8(strFromU8(entries['ppt/slides/slide3.xml'])
      .replace('</p:grpSpPr>','</p:grpSpPr>'+backgroundShape)
      .replace(/<a:rPr([^>]*?)\/>/g,'<a:rPr$1><a:solidFill><a:srgbClr val="F3F7F9"/></a:solidFill></a:rPr>'))
    const original=zipSync(entries)
    await writeFile(item.target,original)
    browser=await puppeteer.launch({executablePath:(await browserExecutables())[0],headless:true,pipe:true})
    const page=await browser.newPage()
    await page.setViewport({width:1280,height:900})
    const frame=runtime.openFrame('moki-document-'+item.id,'dsh-app://app',item.id)
    await page.goto(frame.url+'?'+new URLSearchParams({document:item.id,theme:'dark',parent:new URL(frame.url).origin,bridge:'ppt-theme'}))
    const setTheme=dark=>page.evaluate(dark=>window.postMessage({bridge:'ppt-theme',type:'surface',active:true,mode:'sidebar',dark},location.origin),dark)
    await setTheme(true)
    await page.waitForSelector('.rpv-viewport [data-rpv-slide-index]')
    for(const dark of [true,false]) {
      await setTheme(dark)
      await page.waitForFunction(dark=>document.documentElement.dataset.colorScheme===(dark?'dark':'light'),{},dark)
      assert.deepEqual(await page.$$eval('.rpv-thumbnail__canvas [data-rpv-slide-index]',slides=>slides.slice(0,2).map(slide=>getComputedStyle(slide).backgroundColor)),['rgb(255, 255, 255)','rgb(36, 88, 166)'])
    }
    await setTheme(true)
    await page.click('[aria-label="编辑 Office"]')
    await page.waitForSelector('iframe[title*="Univer"]')
    const editor=await (await page.$('iframe[title*="Univer"]')).contentFrame()
    await editor.waitForFunction(()=>window.univerAPI?.getActivePresentation?.())
    const snapshot=await editor.evaluate(()=>JSON.stringify(univerAPI.getActivePresentation().getSlides().map(slide=>slide.getData())))
    const pixel=async rect=>{
      const bytes=await page.screenshot({clip:{x:Math.floor(rect.x+rect.width*.75),y:Math.floor(rect.y+rect.height*.7),width:3,height:3}})
      return [...await sharp(bytes).removeAlpha().raw().toBuffer()].slice(0,3)
    }
    let gradientPixel
    for(const dark of [true,false,true]) {
      await setTheme(dark)
      await editor.waitForFunction(dark=>univerAPI.isDarkMode()===dark&&document.documentElement.classList.contains('univer-dark')===dark,{},dark)
      for(const [index,expected] of [[0,[255,255,255]],[1,[36,88,166]],[2,null]]) {
        await editor.evaluate(index=>{const p=univerAPI.getActivePresentation();p.setActiveSlide(p.getSlides()[index])},index)
        // Capture actual composited pixels, including cached filmstrip previews.
        await new Promise(resolve=>setTimeout(resolve,350))
        const frameRect=await (await page.$('iframe[title*="Univer"]')).boundingBox()
        const surfaces=await editor.evaluate(()=>{
          const surfaces=[...document.querySelectorAll('canvas,img')].map(e=>({tag:e.tagName,rect:e.getBoundingClientRect().toJSON()})).filter(e=>e.rect.width>80&&e.rect.height>50)
          const main=surfaces.filter(e=>e.tag==='CANVAS').sort((a,b)=>b.rect.width*b.rect.height-a.rect.width*a.rect.height)[0]
          return {main:main.rect,thumbs:surfaces.filter(e=>e.rect.right<main.rect.left&&e.rect.top>=0).sort((a,b)=>a.rect.top-b.rect.top).map(e=>e.rect)}
        })
        const globalRect=rect=>({...rect,x:rect.x+frameRect.x,y:rect.y+frameRect.y})
        const painted=await pixel(globalRect(surfaces.main))
        if(expected) assert.deepEqual(painted,expected,`slide ${index+1} in ${dark?'dark':'light'} mode`)
        else {
          gradientPixel??=painted
          assert.deepEqual(painted,gradientPixel,'gradient fill does not change with the theme')
          const main=globalRect(surfaces.main)
          const image=await page.screenshot({clip:{x:Math.floor(main.x),y:Math.floor(main.y),width:Math.floor(main.width),height:Math.floor(main.height)}})
          const {data,info}=await sharp(image).removeAlpha().raw().toBuffer({resolveWithObject:true})
          let lightText=0
          for(let i=0;i<data.length;i+=info.channels) if(data[i]===243&&data[i+1]===247&&data[i+2]===249) lightText++
          assert.ok(lightText>200,'light text must remain visible on a dark gradient in the editor')
        }
        assert.equal(surfaces.thumbs.length,3,'all filmstrip previews are visible')
        for(const [i,color] of [[0,[255,255,255]],[1,[36,88,166]]]) assert.deepEqual(await pixel(globalRect(surfaces.thumbs[i])),color,'thumbnail keeps the original slide colors')
      }
    }
    assert.equal(await editor.evaluate(()=>JSON.stringify(univerAPI.getActivePresentation().getSlides().map(slide=>slide.getData()))),snapshot,'theme switches must not rewrite presentation data')
    assert.deepEqual(await readFile(item.target),Buffer.from(original),'viewing and theme switching must not save the source')
  } finally {
    await browser?.close()
    await runtime.close()
    await rm(dir,{recursive:true,force:true})
  }
})

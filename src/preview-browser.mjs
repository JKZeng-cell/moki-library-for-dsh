import {access, mkdtemp, rm} from 'node:fs/promises'
import {spawn} from 'node:child_process'
import {homedir, tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'

function connectWindowsTaskbar(browser) {
  if (process.platform !== 'win32') return
  // The packaged host and the page use the same content-hashed, multi-resolution ICO.
  const icon = typeof __MOKI_WINDOW_ICON__ === 'string' ? __MOKI_WINDOW_ICON__ : '../web/preview-icon.ico'
  const command = 'Add-Type -TypeDefinition ([IO.File]::ReadAllText($env:MOKI_TASKBAR_SOURCE)) -ErrorAction Stop; [MokiPreviewTaskbar]::Run([int]$env:MOKI_TASKBAR_PID, $env:MOKI_TASKBAR_ICON)'
  const helper = spawn('powershell.exe', ['-NoProfile','-NonInteractive','-Command',command], {
    windowsHide: true, stdio: ['pipe','ignore','ignore'],
    env: { ...process.env, MOKI_TASKBAR_PID: String(browser.process().pid),
      MOKI_TASKBAR_ICON: fileURLToPath(new URL(icon, import.meta.url)),
      MOKI_TASKBAR_SOURCE: fileURLToPath(new URL('./windows-preview-taskbar.cs', import.meta.url)) },
  })
  helper.on('error', () => {})
  helper.stdin.on('error', () => {})
  browser.once('disconnected', () => helper.stdin.end())
  return helper.stdin
}

export async function browserExecutables() {
  const candidates = process.platform === 'win32'
    ? [process.env['ProgramFiles(x86)'],process.env.ProgramFiles,process.env.LOCALAPPDATA].filter(Boolean)
        .flatMap(root=>['Google/Chrome/Application/chrome.exe','Microsoft/Edge/Application/msedge.exe'].map(path=>join(root,path)))
    : process.platform === 'darwin'
      ? ['/Applications',join(homedir(),'Applications')].flatMap(root=>['Google Chrome','Microsoft Edge','Chromium'].map(name=>join(root,name+'.app','Contents/MacOS',name)))
      : ['/usr/bin/google-chrome','/usr/bin/microsoft-edge','/usr/bin/chromium','/usr/bin/chromium-browser','/snap/bin/chromium']
  const available=[]
  for (const path of candidates) { try { await access(path); available.push(path) } catch {} }
  if(available.length)return available
  throw new Error('请安装 Microsoft Edge 或 Chrome 以打开系统预览窗口，也可在资料的更多菜单中选择侧边工作区。')
}

// App-mode windows have native title bars and share one private browser process.
// The control pipe is inherited by this plugin and has no listening TCP port.
export function createPreviewBrowser() {
  let instance, opening = Promise.resolve(), closed = false
  async function open(url) {
    if (closed) throw new Error('资料库正在关闭')
    if (!instance) {
      const candidates = await browserExecutables()
      const profile = await mkdtemp(join(tmpdir(),'moki-dsh-preview-'))
      try {
        const {default:puppeteer} = await import('puppeteer-core')
        let browser,lastError
        for(const executable of candidates){
          try {
            browser=await puppeteer.launch({executablePath:executable,headless:false,pipe:true,defaultViewport:null,userDataDir:profile,timeout:12000,waitForInitialPage:false,
              ignoreDefaultArgs:['--enable-automation','about:blank'],args:['--no-first-run','--no-default-browser-check','--disable-background-mode','--disable-session-crashed-bubble','--no-startup-window']})
            instance={browser,executable,profile,pages:new Set(),taskbar:connectWindowsTaskbar(browser)};break
          } catch(error){lastError=error}
        }
        if(!browser)throw new Error('无法启动系统预览窗口：'+lastError?.message)
        browser.once('disconnected',()=>{
          if (instance?.browser===browser) instance=undefined
          void rm(profile,{recursive:true,force:true,maxRetries:8,retryDelay:350}).catch(()=>{})
        })
      } catch (error) {
        await rm(profile,{recursive:true,force:true,maxRetries:3}).catch(()=>{})
        throw error
      }
    }
    // Puppeteer starts its control process hidden on Windows. Give every file,
    // including the first, a visible OS app window in that same private profile.
    const child=spawn(instance.executable,['--user-data-dir='+instance.profile,'--no-first-run','--window-size=1024,760','--app='+url],{stdio:'ignore',windowsHide:false})
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject)})
    child.unref()
    const target=await instance.browser.waitForTarget(t=>t.type()==='page' && t.url()===url,{timeout:20000})
    const page=await target.page()
    const current=instance
    current.pages.add(page)
    if (current.taskbar?.writable) current.taskbar.write(current.pages.size+'\n')
    page.once('close',()=>{
      current.pages.delete(page)
      opening=opening.then(async()=>{
        if(!current.pages.size && instance===current)await current.browser.close().catch(()=>{})
      }).catch(()=>{})
    })
    page.on('dialog',async dialog=>{
      if (dialog.type()==='beforeunload') {
        await dialog.dismiss().catch(()=>{})
        await page.evaluate(()=>window.dispatchEvent(new Event('moki:request-document-close'))).catch(()=>{})
      } else await dialog.dismiss().catch(()=>{})
    })
    return page
  }
  return {
    open(url) {
      const pending=opening.then(()=>open(url))
      opening=pending.catch(()=>{})
      return pending
    },
    async close() { closed=true; await opening; await instance?.browser.close().catch(()=>{}) }
  }
}

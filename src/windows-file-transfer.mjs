import {spawn} from 'node:child_process'
import {createInterface} from 'node:readline'
import {readFileSync} from 'node:fs'

export function createWindowsFileTransfer() {
  let worker, ready, idle, nextId = 0
  const pending = new Map()
  function stop() {
    clearTimeout(idle)
    if (worker) worker.kill()
  }
  function scheduleIdle() {
    clearTimeout(idle)
    if (!pending.size) { idle = setTimeout(stop, 90_000); idle.unref() }
  }
  function warm() {
    if (worker && !worker.killed) { scheduleIdle(); return ready }
    const script = readFileSync(new URL('./windows-file-transfer.ps1', import.meta.url), 'utf8')
    const child = spawn('powershell.exe', ['-NoProfile','-NonInteractive','-STA','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')], {windowsHide:true,stdio:['pipe','pipe','ignore']})
    worker = child
    ready = new Promise((resolve,reject) => {
      const ended = error => {
        reject(error)
        if (worker !== child) return
        worker = undefined
        clearTimeout(idle)
        for (const request of pending.values()) request.reject(error)
        pending.clear()
      }
      child.once('error', ended)
      child.once('exit', () => ended(new Error('Windows 文件传递服务已退出')))
      child.stdin.on('error', ended)
      const lines = createInterface({input:child.stdout})
      lines.on('line', line => {
        if (line === 'ready') { resolve(); scheduleIdle(); return }
        let reply
        try { reply = JSON.parse(line) } catch { return }
        const request = pending.get(reply.id)
        if (!request) return
        pending.delete(reply.id)
        if (reply.error) request.reject(new Error(reply.error))
        else request.resolve(reply.result)
        scheduleIdle()
      })
    })
    return ready
  }
  async function transfer(action, paths) {
    await warm()
    clearTimeout(idle)
    const id = ++nextId
    return new Promise((resolve,reject) => {
      pending.set(id,{resolve,reject})
      worker.stdin.write(JSON.stringify({id,action,paths})+'\n',error=>{
        if (error) { pending.delete(id); reject(error); scheduleIdle() }
      })
    })
  }
  return {warm,transfer,close:stop}
}

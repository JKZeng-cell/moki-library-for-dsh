import { execFile, spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { promisify } from 'node:util'
import { dirname } from 'node:path'
const execute = promisify(execFile)

export function focusDsh() {
  if(process.platform !== 'win32')return
  const command="$app=Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue | Where-Object MainWindowHandle -ne 0 | Select-Object -First 1; if($app){(New-Object -ComObject WScript.Shell).AppActivate($app.Id) | Out-Null}"
  return execute('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,timeout:4000}).catch(()=>{})
}

export async function openItem(item, reveal = false) {
  if (!item.target) throw new Error('请选择有本地路径或网址的资料')
  const path = item.target
  if (item.kind === 'url' && !/^https?:\/\//i.test(path)) throw new Error('仅支持网页链接')
  if (process.platform === 'win32') {
    if (item.kind !== 'url') await access(path).catch(()=>{throw new Error('映射目标不存在或无法访问')})
    // Explorer may keep its launcher alive while Windows displays Open With.
    // The handoff is complete once the shell has accepted the launch.
    await new Promise((resolve,reject)=>{
      const child=spawn('explorer.exe',reveal ? ['/select,',path] : [path],{stdio:'ignore',windowsHide:true})
      child.once('error',reject)
      child.once('spawn',()=>{child.unref();resolve()})
    })
  } else if (process.platform === 'darwin') await execute('open',reveal ? ['-R',path] : [path])
  else await execute('xdg-open',[reveal ? dirname(path) : path])
}

const dialogs = {
  file: 'System.Windows.Forms.OpenFileDialog',
  folder: 'System.Windows.Forms.FolderBrowserDialog',
  save: 'System.Windows.Forms.SaveFileDialog',
}
export async function pickPath(kind, name = '') {
  if (!Object.hasOwn(dialogs,kind)) throw new Error('无效的选择类型')
  if (process.platform === 'win32') {
    const script = `Add-Type -AssemblyName System.Windows.Forms
      [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
      $dlg = New-Object ${dialogs[kind]}
      ${kind === 'save' ? '$dlg.FileName = $env:MOKI_PICKER_NAME' : ''}
      if ($dlg.ShowDialog() -eq 'OK') { [Console]::Write($dlg.${kind === 'folder' ? 'SelectedPath' : 'FileName'}) }
      $dlg.Dispose()`
    const result = await execute('powershell.exe',['-NoProfile','-STA','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,env:{...process.env,MOKI_PICKER_NAME:name}})
    return result.stdout.trim() || null
  }
  const [program,args] = process.platform === 'darwin'
    ? ['osascript',['-e','POSIX path of ('+({file:'choose file',folder:'choose folder',save:'choose file name'}[kind])+')']]
    : ['zenity',['--file-selection',...(kind==='folder'?['--directory']:kind==='save'?['--save','--confirm-overwrite']:[])]]
  try { return (await execute(program,args)).stdout.trim() || null } catch(error) {
    if (error.code===1 || String(error.stderr).includes('(-128)')) return null
    throw error
  }
}

export async function copyLocalFiles(paths) {
  if (process.platform==='win32') {
    const command='$ErrorActionPreference = "Stop"; Add-Type -AssemblyName System.Windows.Forms; $list = New-Object System.Collections.Specialized.StringCollection; foreach ($path in (ConvertFrom-Json $env:MOKI_CLIPBOARD_PATHS)) { [void]$list.Add($path) }; [Windows.Forms.Clipboard]::SetFileDropList($list)'
    await execute('powershell.exe',['-NoProfile','-STA','-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')],{windowsHide:true,env:{...process.env,MOKI_CLIPBOARD_PATHS:JSON.stringify(paths)}})
  } else if (process.platform==='darwin') {
    await execute('osascript',['-e','on run argv','-e','set fileList to {}','-e','repeat with p in argv','-e','set end of fileList to (POSIX file (contents of p)) as alias','-e','end repeat','-e','set the clipboard to fileList','-e','end run',...paths])
  } else throw new Error('可通过「复制路径」在系统文件管理器中访问此文件')
}

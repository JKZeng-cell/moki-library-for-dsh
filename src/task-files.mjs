import {lstat, realpath} from 'node:fs/promises'
import {basename, isAbsolute, normalize, resolve} from 'node:path'
import {option} from './preferences.mjs'

const keyOf = path => process.platform === 'win32' ? normalize(path).toLowerCase() : normalize(path)
const folderName = 'DSH 任务文件'

export function taskFileMapper(db, repository, config, change) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS dsh_task_folder (slot INTEGER PRIMARY KEY CHECK(slot=1), item_id TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS dsh_task_outputs (path_key TEXT PRIMARY KEY);
  `)
  const recorded = db.prepare('SELECT 1 FROM dsh_task_outputs WHERE path_key=?')
  const record = db.prepare('INSERT INTO dsh_task_outputs VALUES (?)')
  let closed = false
  const enabled = () => !closed && option(config, 'autoMapTaskFiles') === true
  async function changed(paths) {
    if(closed)return []
    const keys=new Set()
    for(const path of new Set(paths)) {
      if(typeof path!=='string'||!isAbsolute(path))continue
      try {const actual=await realpath(path);if((await lstat(actual)).isFile()){keys.add(keyOf(path));keys.add(keyOf(actual))}}catch{}
    }
    if(!keys.size||closed)return []
    const ids=[]
    for(const row of db.prepare("SELECT id,target FROM resource_library_items WHERE kind='local_file' AND target IS NOT NULL").iterate()) {
      if(keys.has(keyOf(row.target))){change(row.id,'file');ids.push(row.id)}
    }
    return ids
  }
  async function map(paths) {
    if (!enabled()) return []
    const files = []
    for (const path of new Set(paths)) {
      if (!enabled()) return []
      if (typeof path !== 'string' || !isAbsolute(path) || recorded.get(keyOf(path))) continue
      try {
        const info = await lstat(path)
        if (info.isFile()) files.push({path:normalize(path), key:keyOf(await realpath(path)), info})
      } catch { /* A task can remove an intermediate file before the event arrives. */ }
    }
    if (!files.length || !enabled()) return []
    const added = []
    db.exec('BEGIN IMMEDIATE')
    try {
      const known = new Set(Array.from(db.prepare("SELECT target FROM resource_library_items WHERE kind='local_file' AND target IS NOT NULL").iterate(), row => keyOf(row.target)))
      let folder
      for (const {path, key, info} of files) {
        if (recorded.get(key)) continue
        record.run(key)
        if (known.has(key) || known.has(keyOf(path))) continue
        if (!folder) {
          const stored = db.prepare('SELECT item_id FROM dsh_task_folder WHERE slot=1').get()
          folder = stored && repository.find(stored.item_id)
          if (!folder) {
            folder = repository.create({kind:'folder', name:folderName, tags:[]})
            db.prepare('INSERT OR REPLACE INTO dsh_task_folder VALUES (1,?)').run(folder.id)
          }
        }
        added.push(repository.create({kind:'local_file', name:basename(path), parentId:folder.id, target:path, tags:[],
          fileCreatedAt:info.birthtime.toISOString(), fileModifiedAt:info.mtime.toISOString()}))
        known.add(key)
      }
      db.exec('COMMIT')
    } catch (error) { db.exec('ROLLBACK'); throw error }
    if (added.length) change(added[0].parentId)
    return added
  }
  // An explicit Open in Library gesture works independently of auto mapping.
  async function open(path) {
    if(closed || typeof path!=='string' || !isAbsolute(path))throw Error('Invalid local file')
    const actual=await realpath(path),info=await lstat(actual),key=keyOf(actual)
    if(!info.isFile())throw Error('请选择可访问的本地文件')
    const existing=Array.from(db.prepare("SELECT id,target FROM resource_library_items WHERE kind='local_file'").iterate()).find(row=>keyOf(row.target)===key || keyOf(row.target)===keyOf(path))
    if(existing)return repository.find(existing.id)
    const stored=db.prepare('SELECT item_id FROM dsh_task_folder WHERE slot=1').get()
    let folder=stored&&repository.find(stored.item_id),item
    db.exec('BEGIN IMMEDIATE')
    try {
      if(!folder){folder=repository.create({kind:'folder',name:folderName,tags:[]});db.prepare('INSERT OR REPLACE INTO dsh_task_folder VALUES (1,?)').run(folder.id)}
      item=repository.create({kind:'local_file',name:basename(actual),target:actual,parentId:folder.id,tags:[],fileCreatedAt:info.birthtime.toISOString(),fileModifiedAt:info.mtime.toISOString()})
      db.prepare('INSERT OR IGNORE INTO dsh_task_outputs VALUES (?)').run(key)
      db.exec('COMMIT')
    }catch(error){db.exec('ROLLBACK');throw error}
    change(folder.id);return item
  }
  // Explicit filing is scoped to the chosen folder. An existing reference in
  // another folder remains there; repeated clicks in this folder are idempotent.
  async function add(path,parentId) {
    if(closed || typeof path!=='string' || !isAbsolute(path))throw Error('Invalid local file')
    const actual=await realpath(path),info=await lstat(actual),key=keyOf(actual)
    if(!info.isFile())throw Error('请选择可访问的本地文件')
    if(parentId!==null && !['folder','local_folder'].includes(repository.find(parentId)?.kind))throw Error('目标文件夹已不存在，请重新选择')
    const existing=repository.list({parentId,thumbnails:'omit'}).find(row=>row.kind==='local_file' && row.target && [key,keyOf(path)].includes(keyOf(row.target)))
    if(existing)return {item:existing,existing:true}
    let item
    db.exec('BEGIN IMMEDIATE')
    try {
      item=repository.create({kind:'local_file',name:basename(actual),target:actual,parentId,tags:[],fileCreatedAt:info.birthtime.toISOString(),fileModifiedAt:info.mtime.toISOString()})
      db.prepare('INSERT OR IGNORE INTO dsh_task_outputs VALUES (?)').run(key)
      db.exec('COMMIT')
    }catch(error){db.exec('ROLLBACK');throw error}
    change(parentId);return {item,existing:false}
  }
  return {enabled, map, open, add, changed, close(){closed=true}}
}

export function listenForTaskFiles(ctx, mapper) {
  const report = error => ctx.logger?.warn('MOKI资料库任务文件映射失败：%s', error.message)
  ctx.on('session/event', (_session, event) => {
    if (event.type === 'deliverables/presented' && mapper.enabled())
      void mapper.map(event.data.files.map(file => file.path)).catch(report)
  })
  ctx.inject(['fs'], child => {
    const creating = new WeakMap(),writing = new WeakMap()
    child.on('fs/write-intent', async (target, actor, next) => {
      const intent = await next()
      if(actor?.agent?.session && intent){const paths=writing.get(actor)??new Set();paths.add(child.fs.processPath(target));writing.set(actor,paths)}
      if (mapper.enabled() && actor?.agent?.session && intent?.kind === 'createIfAbsent') {
        const paths = creating.get(actor) ?? new Set()
        paths.add(child.fs.processPath(target))
        creating.set(actor, paths)
      }
      return intent
    }, {prepend:true})
    child.on('fs/observed', (target, observation, actor) => {
      if(observation.kind!=='present')return
      const path = child.fs.processPath(target)
      if(writing.get(actor)?.delete(path))void mapper.changed([path]).catch(report)
      const candidates = creating.get(actor)
      if (!candidates) return
      if (candidates.delete(path)) void mapper.map([path]).catch(report)
    })
  })
  // Shell tools can create files without calling the filesystem tool. Consult
  // DSH's own per-turn change record after the recorder has published it.
  ctx.inject(['workspaceChanges'], child => {
    const starts = new WeakMap(), lifetime = new AbortController()
    child.effect(() => () => lifetime.abort())
    child.on('session/event', (session, event) => {
      if (event.type === 'turn/start') {
        starts.set(session, {turn:event.data.turn, time:Date.now()})
      }
      const start = starts.get(session)
      if (event.type !== 'workspace/changes' || start?.turn !== event.data.turn) return
      void Promise.resolve().then(async () => {
        const changes = child.workspaceChanges.summary(session.id, event.seq)
        if (!changes) return
        if(lifetime.signal.aborted)return
        // Existing mappings must track DSH writes even when automatic mapping
        // of newly generated files is switched off.
        await mapper.changed(changes.files.map(file=>resolve(changes.cwd,file.path)))
        if(!mapper.enabled())return
        const paths = []
        for (const [index, file] of changes.files.entries()) {
          if (lifetime.signal.aborted || !mapper.enabled()) return
          if (file.deleted > 0) continue
          const path = resolve(changes.cwd, file.path)
          if (file.binary || file.oversized) {
            const info = await lstat(path).catch(() => null)
            if (info?.isFile() && info.birthtimeMs >= start.time) paths.push(path)
          } else {
            const diff = await child.workspaceChanges.diff(session.id, event.seq, index, lifetime.signal)
            if (diff?.kind === 'text' && !diff.before && diff.after) paths.push(path)
          }
        }
        if (!lifetime.signal.aborted) await mapper.map(paths)
      }).catch(error => {if (!lifetime.signal.aborted) report(error)})
    })
  })
}

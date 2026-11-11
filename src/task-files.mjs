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
  return {enabled, map, close(){closed=true}}
}

export function listenForTaskFiles(ctx, mapper) {
  const report = error => ctx.logger?.warn('MOKI资料库任务文件映射失败：%s', error.message)
  ctx.on('session/event', (_session, event) => {
    if (event.type === 'deliverables/presented' && mapper.enabled())
      void mapper.map(event.data.files.map(file => file.path)).catch(report)
  })
  ctx.inject(['fs'], child => {
    const creating = new WeakMap()
    child.on('fs/write-intent', async (target, actor, next) => {
      const intent = await next()
      if (mapper.enabled() && actor?.agent?.session && intent?.kind === 'createIfAbsent') {
        const paths = creating.get(actor) ?? new Set()
        paths.add(child.fs.processPath(target))
        creating.set(actor, paths)
      }
      return intent
    }, {prepend:true})
    child.on('fs/observed', (target, observation, actor) => {
      const candidates = creating.get(actor)
      if (!candidates || observation.kind !== 'present') return
      const path = child.fs.processPath(target)
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
        if (mapper.enabled()) starts.set(session, {turn:event.data.turn, time:Date.now()})
        else starts.delete(session)
      }
      const start = starts.get(session)
      if (event.type !== 'workspace/changes' || !mapper.enabled() || start?.turn !== event.data.turn) return
      void Promise.resolve().then(async () => {
        const changes = child.workspaceChanges.summary(session.id, event.seq)
        if (!changes) return
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

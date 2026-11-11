import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const schema = `
CREATE TABLE IF NOT EXISTS resource_library_items (
  id TEXT PRIMARY KEY, parent_id TEXT, kind TEXT NOT NULL, name TEXT NOT NULL, target TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]', folder_color TEXT, assistant_permission TEXT, sort_order INTEGER NOT NULL DEFAULT 0,
  file_created_at TEXT, file_modified_at TEXT, thumbnail_data_url TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_library_parent ON resource_library_items(parent_id,sort_order);
CREATE TABLE IF NOT EXISTS resource_library_exclusions (
  parent_item_id TEXT NOT NULL, target_key TEXT NOT NULL, target TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY(parent_item_id,target_key)
);
CREATE TABLE IF NOT EXISTS initialization (id INTEGER PRIMARY KEY CHECK(id=1), imported INTEGER NOT NULL, completed_at TEXT NOT NULL);`

export function workbenchCatalog() {
  const config = process.platform === 'win32' ? process.env.APPDATA : process.platform === 'darwin'
    ? join(homedir(),'Library','Application Support') : process.env.XDG_CONFIG_HOME || join(homedir(),'.config')
  return config && join(config,'moki-workbench','data','workbench.db')
}

// Read a consistent snapshot of only the two catalog tables, including older schemas.
// Mapped paths intentionally keep the same source. Each installation owns its own index.
function importTable(source, destination, table) {
  const columns = source.prepare('PRAGMA table_info('+table+')').all().map(row => row.name)
  if (!columns.length) return 0
  const common = destination.prepare('PRAGMA table_info('+table+')').all().map(row => row.name).filter(name => columns.includes(name))
  const fields = common.join(',')
  const insert = destination.prepare('INSERT INTO '+table+' ('+fields+') VALUES ('+common.map(() => '?').join(',')+')')
  let count = 0
  for (const row of source.prepare('SELECT '+fields+' FROM '+table).iterate()) {
    insert.run(...common.map(name => row[name]))
    count++
  }
  return count
}

export function openCatalog(directory, sourcePath) {
  mkdirSync(directory,{recursive:true})
  const db = new DatabaseSync(join(directory,'library.sqlite'))
  let source
  try {
    db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;'+schema)
    db.exec('BEGIN IMMEDIATE')
    if (!db.prepare('SELECT id FROM initialization').get()) {
      let imported = 0
      if (sourcePath && existsSync(sourcePath)) {
        source = new DatabaseSync(sourcePath,{readOnly:true})
        source.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=5000; BEGIN')
        imported = importTable(source, db, 'resource_library_items')
        importTable(source, db, 'resource_library_exclusions')
        source.exec('COMMIT')
      }
      db.prepare('INSERT INTO initialization VALUES (1,?,?)').run(imported,new Date().toISOString())
    }
    db.exec('COMMIT')
    return db
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK')
    db.close()
    throw error
  } finally { source?.close() }
}

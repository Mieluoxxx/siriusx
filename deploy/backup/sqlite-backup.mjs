#!/usr/bin/env node
/** Consistent SQLite snapshot using VACUUM INTO (safe while the writer is live). */
import { DatabaseSync } from 'node:sqlite'
import { existsSync, rmSync } from 'node:fs'

const [source, target] = process.argv.slice(2)
if (source === undefined || target === undefined) {
  console.error('usage: sqlite-backup.mjs <source.sqlite> <target.sqlite>')
  process.exit(2)
}
if (!existsSync(source)) {
  console.error(`source database not found: ${source}`)
  process.exit(1)
}
if (existsSync(target)) rmSync(target)
const escaped = target.replace(/'/gu, "''")
const database = new DatabaseSync(source, { readOnly: true })
try {
  database.exec(`VACUUM INTO '${escaped}'`)
} finally {
  database.close()
}
console.error(JSON.stringify({ source, target }))

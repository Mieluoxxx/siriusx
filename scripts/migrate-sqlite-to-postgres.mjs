#!/usr/bin/env node
/** One-way offline migration of the control-plane SQLite tables into PostgreSQL. */
import { DatabaseSync } from 'node:sqlite'
import pg from 'pg'

const args = process.argv.slice(2)
const flag = name => args.includes(name)
const value = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const sqlitePath = value('--sqlite') ?? process.env.SIRIUSX_SQLITE_PATH
const databaseUrl = process.env.DATABASE_URL
const reset = flag('--reset')
const dryRun = flag('--dry-run')
if (sqlitePath === undefined || (databaseUrl === undefined && !dryRun)) {
  console.error('usage: DATABASE_URL=postgres://... node scripts/migrate-sqlite-to-postgres.mjs --sqlite <control.sqlite> [--reset] [--dry-run]')
  process.exit(2)
}
const tables = [
  'tenants', 'users', 'settings', 'devices', 'pairing_codes', 'bots',
  'device_tickets', 'device_ticket_events', 'cloud_tickets', 'cloud_ticket_events',
  'revoked_sessions', 'tenant_quotas', 'model_catalog', 'tenant_models',
  'source_bindings', 'source_events', 'tenant_billing', 'support_requests', 'platform_audit',
]
const sqlite = new DatabaseSync(sqlitePath, { readOnly: true })
const rowsByTable = new Map()
for (const table of tables) {
  try { rowsByTable.set(table, sqlite.prepare(`SELECT * FROM ${table}`).all()) }
  catch { rowsByTable.set(table, []) }
}
sqlite.close()
if (dryRun) {
  console.log(JSON.stringify(Object.fromEntries([...rowsByTable].map(([table, rows]) => [table, rows.length])), null, 2))
  process.exit(0)
}
const client = new pg.Client({ connectionString: databaseUrl })
await client.connect()
try {
  await client.query('BEGIN')
  if (reset) {
    await client.query(`TRUNCATE ${tables.map(table => `"${table}"`).join(', ')} RESTART IDENTITY CASCADE`)
  }
  const counts = {}
  for (const table of tables) {
    const rows = rowsByTable.get(table) ?? []
    counts[table] = rows.length
    if (rows.length === 0) continue
    const columns = Object.keys(rows[0])
    const quoted = columns.map(column => `"${column.replace(/"/gu, '""')}"`).join(', ')
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ')
    const statement = `INSERT INTO "${table}" (${quoted}) VALUES (${placeholders})`
    for (const row of rows) {
      await client.query(statement, columns.map(column => {
        const item = row[column]
        return item === undefined ? null : item
      }))
    }
  }
  await client.query(`SELECT setval(pg_get_serial_sequence('platform_audit', 'id'), GREATEST((SELECT COALESCE(MAX(id), 1) FROM platform_audit), 1), true)`)
  await client.query('COMMIT')
  console.log(JSON.stringify({ migrated: counts }, null, 2))
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined)
  throw error
} finally {
  await client.end()
}

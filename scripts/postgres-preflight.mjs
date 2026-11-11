#!/usr/bin/env node
/** Preflight checks after a SQLite-to-PostgreSQL migration rehearsal. */
import pg from 'pg'

const databaseUrl = process.env.DATABASE_URL
if (databaseUrl === undefined) {
  console.error('DATABASE_URL is required')
  process.exit(2)
}
const tables = [
  'tenants', 'users', 'settings', 'devices', 'pairing_codes', 'bots',
  'device_tickets', 'device_ticket_events', 'cloud_tickets', 'cloud_ticket_events',
  'revoked_sessions', 'tenant_quotas', 'model_catalog', 'tenant_models',
  'source_bindings', 'source_events', 'tenant_billing', 'support_requests', 'platform_audit',
]
const checks = {
  tenants_without_admin: 'SELECT count(*)::int AS count FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.tenant_id = t.id AND u.role = \'admin\')',
  orphan_users: 'SELECT count(*)::int AS count FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id WHERE t.id IS NULL',
  orphan_devices: 'SELECT count(*)::int AS count FROM devices d LEFT JOIN tenants t ON t.id = d.tenant_id WHERE t.id IS NULL',
  orphan_cloud_tickets: 'SELECT count(*)::int AS count FROM cloud_tickets c LEFT JOIN tenants t ON t.id = c.tenant_id WHERE t.id IS NULL',
  orphan_tenant_models: 'SELECT count(*)::int AS count FROM tenant_models tm LEFT JOIN model_catalog m ON m.id = tm.model_id WHERE m.id IS NULL',
}
const client = new pg.Client({ connectionString: databaseUrl })
await client.connect()
try {
  const counts = {}
  for (const table of tables) {
    const result = await client.query(`SELECT count(*)::int AS count FROM "${table}"`)
    counts[table] = result.rows[0].count
  }
  const failures = []
  for (const [name, sql] of Object.entries(checks)) {
    const result = await client.query(sql)
    if (result.rows[0].count !== 0) failures.push(`${name}=${result.rows[0].count}`)
  }
  console.log(JSON.stringify({ counts, failures }, null, 2))
  if (failures.length > 0) process.exit(1)
} finally {
  await client.end()
}

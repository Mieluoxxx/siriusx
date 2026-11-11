#!/usr/bin/env node
/** Check an autobot SQLite -> PostgreSQL migration rehearsal. */
import pg from 'pg'

const databaseUrl = process.env.DATABASE_URL
if (databaseUrl === undefined) { console.error('DATABASE_URL is required'); process.exit(2) }
const checks = {
  tickets_without_assignments: 'SELECT count(*)::int AS count FROM autobot_tickets t WHERE NOT EXISTS (SELECT 1 FROM autobot_assignments a WHERE a.ticket_id = t.id)',
  orphan_assignments: 'SELECT count(*)::int AS count FROM autobot_assignments a LEFT JOIN autobot_tickets t ON t.id = a.ticket_id WHERE t.id IS NULL',
  orphan_events: 'SELECT count(*)::int AS count FROM autobot_assignment_events e LEFT JOIN autobot_assignments a ON a.id = e.assignment_id WHERE a.id IS NULL',
  orphan_inputs: 'SELECT count(*)::int AS count FROM autobot_pending_inputs p LEFT JOIN autobot_tickets t ON t.id = p.ticket_id WHERE t.id IS NULL',
  orphan_outbox: 'SELECT count(*)::int AS count FROM autobot_outbox o LEFT JOIN autobot_tickets t ON t.id = o.ticket_id WHERE t.id IS NULL',
}
const client = new pg.Client({ connectionString: databaseUrl })
await client.connect()
try {
  const counts = {}
  for (const table of ['autobot_tickets', 'autobot_assignments', 'autobot_assignment_events', 'autobot_pending_inputs', 'autobot_outbox']) {
    counts[table] = (await client.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count
  }
  const failures = []
  for (const [name, sql] of Object.entries(checks)) {
    const count = (await client.query(sql)).rows[0].count
    if (count !== 0) failures.push(`${name}=${count}`)
  }
  console.log(JSON.stringify({ counts, failures }, null, 2))
  if (failures.length > 0) process.exit(1)
} finally { await client.end() }

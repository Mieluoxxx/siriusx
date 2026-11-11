import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PostgresStorage } from '@siriusx/storage'
import { FakeKernel } from '@siriusx/fake-kernel'
import { LocalExecutor } from '@siriusx/executor-local'
import { BotService } from '../src/bot-service.ts'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
const enabled = process.env.SIRIUSX_POSTGRES_TEST === '1' && process.env.DATABASE_URL !== undefined

describe.skipIf(!enabled)('autobot PostgreSQL storage', () => {
  it('runs the ticket/assignment/event/outbox flow on PostgreSQL', async () => {
    const root = await mkdtemp(join(tmpdir(), 'siriusx-autobot-pg-'))
    roots.push(root)
    const storage = new PostgresStorage(process.env.DATABASE_URL!)
    const kernel = new FakeKernel({ defaultScenario: { steps: [{ kind: 'delta', text: '```siriusx-report\n{"kind":"ready","summary":"pg done"}\n```' }] } })
    const service = new BotService({ dbPath: join(root, 'bot.sqlite'), storage, executor: new LocalExecutor({ tenantId: 'tenant-autobot-pg', backend: kernel }) })
    await service.initialize()
    try {
      const ticketId = await service.createTicket({
        tenantId: 'tenant-autobot-pg',
        workspace: { kind: 'local_dir', deviceId: 'd1', path: root },
        prompt: 'run on postgres',
      })
      const view = await service.dispatch(ticketId)
      expect(view.latestAssignment?.report?.kind).toBe('ready')
      expect((await service.getTicket(ticketId)).closed).toBe(true)
      expect(await service.eventsForTicket(ticketId)).not.toHaveLength(0)
      expect((await storage.query('SELECT prompt FROM autobot_tickets WHERE id = ?', [ticketId])).rows[0]).toEqual({ prompt: 'run on postgres' })
      expect((await storage.query('SELECT state FROM autobot_assignments WHERE ticket_id = ?', [ticketId])).rows[0]).toMatchObject({ state: 'reported' })
      expect((await storage.query('SELECT kind FROM autobot_outbox WHERE ticket_id = ?', [ticketId])).rows[0]).toEqual({ kind: 'report' })
      expect((await storage.query('SELECT count(*)::int AS count FROM autobot_assignment_events e JOIN autobot_assignments a ON a.id = e.assignment_id WHERE a.ticket_id = ?', [ticketId])).rows[0]?.count).toBeGreaterThan(0)
      await storage.query('DELETE FROM autobot_assignment_events WHERE assignment_id IN (SELECT id FROM autobot_assignments WHERE ticket_id = ?)', [ticketId])
      await storage.query('DELETE FROM autobot_outbox WHERE ticket_id = ?', [ticketId])
      await storage.query('DELETE FROM autobot_pending_inputs WHERE ticket_id = ?', [ticketId])
      await storage.query('DELETE FROM autobot_assignments WHERE ticket_id = ?', [ticketId])
      await storage.query('DELETE FROM autobot_tickets WHERE id = ?', [ticketId])
    } finally {
      service.close()
      await storage.close()
    }
  })
})

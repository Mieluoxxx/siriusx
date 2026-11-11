import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PostgresStorage } from '@siriusx/storage'
import { ToolGateway, type ActionRequest, type ToolContext } from '../src/index.ts'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
const enabled = process.env.SIRIUSX_POSTGRES_TEST === '1' && process.env.DATABASE_URL !== undefined
const request: ActionRequest = { tenantId: 'tenant-tg-pg', botId: 'bot', ticketId: 'ticket', operatorId: 'app', system: 'github', actionClass: 'send_email', target: 'a/b', mandate: { actions: [] } }
const context: ToolContext = { tenantId: 'tenant-tg-pg', botId: 'bot', ticketId: 'ticket', userId: 'admin', operatorId: 'admin', role: 'admin' }

describe.skipIf(!enabled)('tool gateway PostgreSQL storage', () => {
  it('stores approvals, policies and audit in PostgreSQL', async () => {
    const root = await mkdtemp(join(tmpdir(), 'siriusx-tg-pg-'))
    roots.push(root)
    const storage = new PostgresStorage(process.env.DATABASE_URL!)
    const gateway = new ToolGateway({ dbPath: join(root, 'gateway.sqlite'), storage, connectors: { github: { execute: async () => ({ result: { ok: true } }) } } })
    await gateway.initialize()
    try {
      await gateway.setToolPolicy('tenant-tg-pg', 'send_email', 'deny')
      expect(await gateway.listToolPolicies('tenant-tg-pg')).toEqual([{ actionClass: 'send_email', effect: 'deny' }])
      await gateway.setToolPolicy('tenant-tg-pg', 'send_email', 'approval')
      const pending = await gateway.propose(request, context)
      expect(pending.status).toBe('pending')
      expect((await gateway.listApprovals('tenant-tg-pg'))[0]).toMatchObject({ status: 'pending', ticketId: 'ticket' })
      const decided = await gateway.decide(pending.approvalId!, true, context)
      expect(decided.status).toBe('approved')
      expect(await gateway.auditForTicket('ticket', 'tenant-tg-pg')).toHaveLength(2)
      expect(await gateway.auditSummary('tenant-tg-pg')).toMatchObject({ total: 2, decisions: { 'pending:tenant_policy': 1, 'approved:human': 1 } })
      expect(await gateway.verifyAuditChain()).toMatchObject({ valid: true, checked: 2 })
      await gateway.deleteToolPolicy('tenant-tg-pg', 'send_email')
      expect(await gateway.listToolPolicies('tenant-tg-pg')).toEqual([])
    } finally {
      await storage.query('DELETE FROM tg_audit WHERE tenant_id = ?', ['tenant-tg-pg'])
      await storage.query('DELETE FROM tg_approvals WHERE tenant_id = ?', ['tenant-tg-pg'])
      await storage.query('DELETE FROM tg_tenant_tool_policies WHERE tenant_id = ?', ['tenant-tg-pg'])
      await storage.close()
      gateway.close()
    }
  })
})

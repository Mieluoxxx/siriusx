import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ToolGateway,
  ToolGatewayError,
  decidePolicy,
  type ActionRequest,
  type ToolContext,
} from '../src/index.ts'
import { startToolGatewayServer, type ToolGatewayServer } from '../src/server.ts'

const roots: string[] = []
const servers: ToolGatewayServer[] = []

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

const context: ToolContext = {
  tenantId: 'tenant-a', userId: 'user-1', operatorId: 'app:user-1', approverId: 'user-1', role: 'admin',
  botId: 'bot-1', ticketId: 'ticket-1',
}

const base: ActionRequest = {
  tenantId: 'tenant-a', botId: 'bot-1', ticketId: 'ticket-1', operatorId: 'app:user-1',
  system: 'github', actionClass: 'comment', target: 'acme/repo#1', content: 'hello', mandate: { actions: [] },
}

async function db(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'siriusx-gateway-'))
  roots.push(root)
  return join(root, 'gateway.sqlite')
}

describe('tool gateway policy', () => {
  it('allows reads/replies, requires approval outside mandate, denies baseline', () => {
    expect(decidePolicy({ ...base, actionClass: 'read' })).toMatchObject({ kind: 'allow' })
    expect(decidePolicy({ ...base, actionClass: 'reply' })).toMatchObject({ kind: 'allow' })
    expect(decidePolicy({ ...base, actionClass: 'comment' })).toMatchObject({ kind: 'allow' })
    expect(decidePolicy({ ...base, actionClass: 'send_email' })).toMatchObject({ kind: 'approval' })
    expect(decidePolicy({ ...base, actionClass: 'delete_repository' })).toMatchObject({ kind: 'deny' })
    expect(decidePolicy({ ...base, actionClass: 'send_email', mandate: { actions: ['github:send_email'] } })).toMatchObject({ kind: 'allow' })
  })

  it('does not execute an outside-mandate action before approval', async () => {
    const execute = vi.fn(async () => ({ result: { posted: true } }))
    const gateway = new ToolGateway({
      dbPath: await db(),
      connectors: { github: { execute } },
      credentials: { github: 'super-secret-token' },
    })
    const pending = await gateway.propose({ ...base, actionClass: 'send_email' }, context)
    expect(pending.status).toBe('pending')
    expect(execute).not.toHaveBeenCalled()
    const approval = gateway.listApprovals('tenant-a')[0]!
    expect(approval.status).toBe('pending')
    const approved = await gateway.decide(approval.approvalId, true, context)
    expect(approved.status).toBe('approved')
    expect(execute).toHaveBeenCalledOnce()
    const audit = JSON.stringify(gateway.auditForTicket('ticket-1'))
    expect(audit).toContain('approved:human')
    expect(audit).not.toContain('super-secret-token')
    gateway.close()
  })

  it('denies a rejected approval without executing', async () => {
    const execute = vi.fn(async () => ({ result: 'should not run' }))
    const gateway = new ToolGateway({ dbPath: await db(), connectors: { github: { execute } } })
    const pending = await gateway.propose({ ...base, actionClass: 'send_email' }, context)
    if (pending.status !== 'pending' || pending.approvalId === undefined) throw new Error('expected pending')
    await gateway.decide(pending.approvalId, false, context)
    expect(execute).not.toHaveBeenCalled()
    gateway.close()
  })

  it('fails closed when policy is unavailable', async () => {
    const gateway = new ToolGateway({ dbPath: await db(), connectors: {}, policyEnabled: false })
    await expect(gateway.propose(base, context)).rejects.toMatchObject({ code: 'POLICY_UNAVAILABLE' })
    expect(gateway.auditForTicket('ticket-1')).toHaveLength(1)
    gateway.close()
  })

  it('serves approval cards and audit over HTTP', async () => {
    const root = await mkdtemp(join(tmpdir(), 'siriusx-gateway-http-'))
    roots.push(root)
    const server = await startToolGatewayServer({
      dbPath: join(root, 'gateway.sqlite'), port: 0,
      connectors: { github: { execute: async () => ({ result: { ok: true } }) } },
    })
    servers.push(server)
    const headers = { 'content-type': 'application/json', 'x-tenant-id': 'tenant-a', 'x-user-id': 'user-1', 'x-role': 'admin' }
    const proposed = await fetch(`${server.url}/v1/actions`, { method: 'POST', headers, body: JSON.stringify({ ...base, actionClass: 'send_email' }) }).then(response => response.json()) as { status: string; approvalId: string }
    expect(proposed.status).toBe('pending')
    const list = await fetch(`${server.url}/v1/approvals`, { headers }).then(response => response.json()) as { approvals: unknown[] }
    expect(list.approvals).toHaveLength(1)
    const decided = await fetch(`${server.url}/v1/approvals/${proposed.approvalId}/decide`, { method: 'POST', headers, body: JSON.stringify({ approved: true }) }).then(response => response.json()) as { status: string }
    expect(decided.status).toBe('approved')
    const audit = await fetch(`${server.url}/v1/audit?ticketId=ticket-1`, { headers }).then(response => response.json()) as { audit: unknown[] }
    expect(audit.audit.length).toBeGreaterThanOrEqual(2)
  })
})

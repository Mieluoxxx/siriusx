/** Approval card decision wakes a ticket held by the Bot service. */
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ControlPlane } from '../../../apps/control-plane/src/index.ts'
import { startControlPlaneServer } from '../../../apps/control-plane/src/server.ts'
import { startToolGatewayServer } from '../../../apps/tool-gateway/src/server.ts'

const root = await mkdtemp(join(tmpdir(), 'siriusx-approval-resume-'))
const service = 'approval-resume-service'
const plane = await startControlPlaneServer({
  dbPath: join(root, 'control.sqlite'), dataDir: join(root, 'data'), port: 0, sessionSecret: 'approval-resume', ssoServiceToken: service, botScenario: 'waiting',
})
const tenant = plane.control.provisionTenant({ tenantId: 'tenant-approval', name: 'Approval', idpIssuer: 'https://idp.example', adminEmail: 'admin@approval.example' })
const admin = plane.control.findUserByEmail(tenant.id, 'admin@approval.example')!
const session = plane.control.verifySession(plane.control.issueSession({ tenantId: tenant.id, userId: admin.id, role: 'admin' }))
const repo = join(root, 'repo')
await mkdir(repo, { recursive: true })
const ticket = plane.control.createTicket(session, { path: repo, prompt: 'approval resume task' })
const gateway = await startToolGatewayServer({
  dbPath: join(root, 'gateway.sqlite'), port: 0,
  connectors: { github: { execute: async request => ({ result: { action: request.actionClass, ok: true } }) } },
  onApprovalDecided: async event => {
    const response = await fetch(`${plane.url}/v1/approvals/callback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-siriusx-service-token': service },
      body: JSON.stringify(event),
    })
    if (!response.ok) throw new Error(`callback failed: ${response.status}`)
  },
})
const waitReported = async (): Promise<void> => {
  for (let index = 0; index < 100; index++) {
    const detail = plane.control.ticketDetail(session, ticket.ticketId) as { latestAssignment?: { state?: string } }
    if (detail.latestAssignment?.state === 'reported') return
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error('ticket did not reach reported')
}
await waitReported()
const context = { tenantId: tenant.id, botId: 'bot-approval', ticketId: ticket.ticketId, userId: admin.id, operatorId: `app:${admin.id}`, approverId: admin.id, role: 'admin' as const }
const proposed = await gateway.gateway.propose({
  tenantId: tenant.id, botId: 'bot-approval', ticketId: ticket.ticketId, operatorId: `app:${admin.id}`,
  system: 'github', actionClass: 'open_pull_request', target: 'acme/repo#1', mandate: { actions: [] },
}, context)
if (proposed.approvalId === undefined) throw new Error('expected approval')
const decided = await gateway.gateway.decide(proposed.approvalId, true, context)
await new Promise(resolve => setTimeout(resolve, 1000))
const db = new DatabaseSync(join(root, 'data', 'tenants', tenant.id, 'bot.sqlite'))
const rows = db.prepare('SELECT kind, state FROM assignments WHERE ticket_id = ? ORDER BY created_at, rowid').all(ticket.ticketId) as Array<{ kind: string; state: string }>
const pendingRows = db.prepare('SELECT id, consumed_by FROM pending_inputs WHERE ticket_id = ?').all(ticket.ticketId) as Array<{ id: string; consumed_by: string | null }>
db.close()
console.log(JSON.stringify({ proposed, decided, assignments: rows, pendingRows, detail: plane.control.ticketDetail(session, ticket.ticketId) }, null, 2))
if (rows.length < 2 || rows.at(-1)?.state !== 'reported') process.exitCode = 1
await gateway.close()
await plane.close()
await rm(root, { recursive: true, force: true })
process.exit(process.exitCode ?? 0)

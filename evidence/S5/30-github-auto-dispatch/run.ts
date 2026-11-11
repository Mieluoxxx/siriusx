import { createHmac } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startControlPlaneServer } from '../../../apps/control-plane/src/server.ts'
process.env.SIRIUSX_SANDBOX_IMAGE = 'teams-bridge:0.2.0'
const root = await mkdtemp(join(tmpdir(), 'siriusx-github-auto-'))
const server = await startControlPlaneServer({ dbPath: join(root, 'control.sqlite'), dataDir: join(root, 'data'), port: 0, sessionSecret: 'github-auto', platformAdminToken: 'platform-secret', githubWebhookSecret: 'github-secret' })
try {
  const tenant = server.control.provisionTenant({ tenantId: 'tenant-gh-auto', name: 'GH Auto', idpIssuer: 'https://idp.example', adminEmail: 'admin@gh.example' })
  const admin = server.control.findUserByEmail(tenant.id, 'admin@gh.example')!
  const token = server.control.issueSession({ tenantId: tenant.id, userId: admin.id, role: 'admin' })
  await fetch(`${server.url}/v1/admin/source-bindings`, { method: 'POST', headers: { 'x-siriusx-platform-token': 'platform-secret', 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'github', externalId: 'acme/auto', tenantId: tenant.id, repoUrl: 'https://github.com/acme/auto.git', baseRef: 'main', autoDispatch: true }) })
  const payload = JSON.stringify({ action: 'opened', repository: { full_name: 'acme/auto' }, issue: { number: 3, title: 'Fix billing', body: 'Billing total is wrong.' } })
  const signature = `sha256=${createHmac('sha256', 'github-secret').update(payload).digest('hex')}`
  const event = await fetch(`${server.url}/v1/sources/github/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature, 'x-github-delivery': 'gh-auto-1', 'x-github-event': 'issues' }, body: payload }).then(response => response.json()) as { accepted: boolean; ticketId?: string; dispatchError?: string }
  if (event.ticketId === undefined) throw new Error(`not dispatched: ${JSON.stringify(event)}`)
  let detail: any
  for (let i = 0; i < 300; i++) { detail = server.control.ticketDetail(server.control.verifySession(token), event.ticketId); if (detail.latestAssignment?.report?.kind === 'ready') break; await new Promise(resolve => setTimeout(resolve, 100)) }
  const events = await fetch(`${server.url}/v1/source-events`, { headers: { authorization: `Bearer ${token}` } }).then(response => response.json()) as { events: Array<{ status: string; ticketId: string | null }> }
  const result = { accepted: event.accepted, ticketId: event.ticketId, sourceStatus: events.events[0]?.status, stage: detail?.stage, report: detail?.latestAssignment?.report?.kind }
  console.log(JSON.stringify(result, null, 2))
  if (result.sourceStatus !== 'dispatched' || result.stage !== 'person/review' || result.report !== 'ready') process.exitCode = 1
} finally {
  await server.close(); await rm(root, { recursive: true, force: true }); process.exit(process.exitCode ?? 0)
}

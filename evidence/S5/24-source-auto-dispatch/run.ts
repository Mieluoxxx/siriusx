import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startControlPlaneServer } from '../../../apps/control-plane/src/server.ts'
process.env.SIRIUSX_SANDBOX_IMAGE = 'teams-bridge:0.2.0'
const root = await mkdtemp(join(tmpdir(), 'siriusx-source-auto-'))
const server = await startControlPlaneServer({ dbPath: join(root, 'control.sqlite'), dataDir: join(root, 'data'), port: 0, sessionSecret: 'source-auto', platformAdminToken: 'platform-secret', sourceWebhookToken: 'gitlab-secret' })
try {
  const tenant = server.control.provisionTenant({ tenantId: 'tenant-auto', name: 'Auto', idpIssuer: 'https://idp.example', adminEmail: 'admin@auto.example' })
  const admin = server.control.findUserByEmail(tenant.id, 'admin@auto.example')!
  const token = server.control.issueSession({ tenantId: tenant.id, userId: admin.id, role: 'admin' })
  const binding = await fetch(`${server.url}/v1/admin/source-bindings`, { method: 'POST', headers: { 'x-siriusx-platform-token': 'platform-secret', 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'gitlab', externalId: 'acme/auto', tenantId: tenant.id, repoUrl: 'https://github.com/acme/auto.git', baseRef: 'main', autoDispatch: true }) })
  if (binding.status !== 201) throw new Error(`binding failed: ${binding.status}`)
  const event = await fetch(`${server.url}/v1/sources/gitlab/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-gitlab-token': 'gitlab-secret', 'x-gitlab-event': 'Issue Hook', 'x-gitlab-event-uuid': 'auto-delivery-1' }, body: JSON.stringify({ object_kind: 'issue', project: { path_with_namespace: 'acme/auto' }, object_attributes: { iid: 7, title: 'Fix login', description: 'The login page fails.' } }) }).then(response => response.json()) as { accepted: boolean; ticketId?: string; dispatchError?: string }
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

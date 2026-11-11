import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startControlPlaneServer } from '../../../apps/control-plane/src/server.ts'
process.env.SIRIUSX_SANDBOX_IMAGE = 'teams-bridge:0.2.0'
const root = await mkdtemp(join(tmpdir(), 'siriusx-cloud-followup-'))
const server = await startControlPlaneServer({ dbPath: join(root, 'control.sqlite'), dataDir: join(root, 'data'), port: 0, sessionSecret: 'followup-secret' })
const tenant = server.control.provisionTenant({ tenantId: 'tenant-followup', name: 'Cloud', idpIssuer: 'https://idp.example', adminEmail: 'admin@cloud.example' })
const admin = server.control.findUserByEmail(tenant.id, 'admin@cloud.example')!
const token = server.control.issueSession({ tenantId: tenant.id, userId: admin.id, role: 'admin' })
const session = server.control.verifySession(token)
const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
const created = server.control.createCloudTicket(session, { repoUrl: 'https://github.com/acme/repo.git', baseRef: 'main', prompt: 'cloud follow-up base' })
let detail: any
for (let i = 0; i < 300; i++) { detail = server.control.ticketDetail(session, created.ticketId); if (detail.latestAssignment?.report?.kind === 'ready') break; await new Promise(r => setTimeout(r, 100)) }
const first = detail.latestAssignment?.assignmentId
const before = detail.events?.length ?? 0
const followResponse = await fetch(`${server.url}/v1/tickets/${created.ticketId}/input`, { method: 'POST', headers, body: JSON.stringify({ text: 'please continue' }) })
const follow = await followResponse.json() as { assignmentId: string }
for (let i = 0; i < 300; i++) { detail = server.control.ticketDetail(session, created.ticketId); if (detail.latestAssignment?.assignmentId !== first && detail.latestAssignment?.state === 'reported' && detail.latestAssignment?.report?.kind === 'ready') break; await new Promise(r => setTimeout(r, 100)) }
const result = { followStatus: followResponse.status, first, final: detail.latestAssignment?.assignmentId, changed: first !== detail.latestAssignment?.assignmentId, stage: detail.stage, before, after: detail.events?.length ?? 0, report: detail.latestAssignment?.report?.kind, followAssignment: follow.assignmentId }
console.log(JSON.stringify(result, null, 2))
await server.close(); await rm(root, { recursive: true, force: true })
if (result.followStatus !== 202 || !result.changed || result.stage !== 'person/review' || result.after <= result.before || result.report !== 'ready') process.exit(1)
process.exit(0)

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ControlPlane } from '../src/index.ts'
import { startControlPlaneServer, type ControlPlaneServer } from '../src/server.ts'
import { startModelGateway, type ModelGateway } from '../src/model-gateway.ts'
import { createServer } from 'node:http'

const roots: string[] = []
const servers: ControlPlaneServer[] = []
const planes: ControlPlane[] = []
const gateways: ModelGateway[] = []

afterEach(async () => {
  for (const gateway of gateways.splice(0)) await gateway.close()
  for (const server of servers.splice(0)) await server.close()
  for (const plane of planes.splice(0)) plane.close()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'siriusx-control-'))
  roots.push(root)
  const plane = new ControlPlane({ dbPath: join(root, 'control.sqlite'), dataDir: join(root, 'data'), sessionSecret: 'test-secret' })
  planes.push(plane)
  return { root, plane }
}

async function serverSetup() {
  const root = await mkdtemp(join(tmpdir(), 'siriusx-control-http-'))
  roots.push(root)
  const server = await startControlPlaneServer({
    dbPath: join(root, 'control.sqlite'), dataDir: join(root, 'data'), port: 0, sessionSecret: 'test-secret',
  })
  servers.push(server)
  return { root, server }
}

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
}

describe('control plane', () => {
  it('provisions isolated tenants and rejects cross-tenant access', async () => {
    const { plane } = await setup()
    const a = plane.provisionTenant({ name: 'A', idpIssuer: 'https://a.example', adminEmail: 'admin@a.example' })
    const b = plane.provisionTenant({ name: 'B', idpIssuer: 'https://b.example', adminEmail: 'admin@b.example' })
    const adminA = plane.findUserByEmail(a.id, 'admin@a.example')!
    const adminB = plane.findUserByEmail(b.id, 'admin@b.example')!
    const sessionA = plane.verifySession(plane.issueSession({ tenantId: a.id, userId: adminA.id, role: 'admin' }))
    const sessionB = plane.verifySession(plane.issueSession({ tenantId: b.id, userId: adminB.id, role: 'admin' }))
    const botA = plane.createBot(sessionA, 'A bot')
    expect(plane.listBots(sessionA).map(bot => bot.id)).toEqual([botA.id])
    expect(plane.listBots(sessionB)).toEqual([])
    expect(() => plane.verifySession(plane.issueSession({ tenantId: a.id, userId: adminB.id, role: 'admin' }))).toThrow(/not a member/u)
  })

  it('pairs, revokes and authenticates a device', async () => {
    const { plane } = await setup()
    const tenant = plane.provisionTenant({ name: 'A', idpIssuer: 'https://a.example', adminEmail: 'admin@a.example' })
    const admin = plane.findUserByEmail(tenant.id, 'admin@a.example')!
    const session = plane.verifySession(plane.issueSession({ tenantId: tenant.id, userId: admin.id, role: 'admin' }))
    const pairing = plane.startPairing(session, 'Alice MacBook')
    const paired = plane.confirmPairing(session, pairing.code)
    expect(plane.verifyDeviceToken(paired.token)).toMatchObject({ tenantId: tenant.id, deviceId: paired.deviceId })
    plane.revokeDevice(session, paired.deviceId)
    expect(() => plane.verifyDeviceToken(paired.token)).toThrow(/invalid or revoked/u)
  })

  it('enforces the admin native-conversation switch', async () => {
    const { plane } = await setup()
    const tenant = plane.provisionTenant({ name: 'A', idpIssuer: 'https://a.example', adminEmail: 'admin@a.example' })
    const admin = plane.findUserByEmail(tenant.id, 'admin@a.example')!
    const member = plane.addUser({ tenantId: tenant.id, email: 'member@a.example' })
    const adminSession = plane.verifySession(plane.issueSession({ tenantId: tenant.id, userId: admin.id, role: 'admin' }))
    const memberSession = plane.verifySession(plane.issueSession({ tenantId: tenant.id, userId: member.userId, role: 'member' }))
    plane.updateSettings(adminSession, { nativeConversationEnabled: false })
    expect(plane.getSettings(tenant.id).nativeConversationEnabled).toBe(false)
    expect(() => plane.updateSettings(memberSession, { nativeConversationEnabled: true })).toThrow(/admin role required/u)
  })

  it('validates SSO sessions and hides the upstream model key', async () => {
    const { plane } = await setup()
    const tenant = plane.provisionTenant({ name: 'A', idpIssuer: 'https://a.example', adminEmail: 'admin@a.example' })
    const admin = plane.findUserByEmail(tenant.id, 'admin@a.example')!
    const token = plane.issueSession({ tenantId: tenant.id, userId: admin.id, role: 'admin' })
    const seen: Array<string | undefined> = []
    const upstream = createServer(async (request, response) => {
      seen.push(request.headers.authorization)
      for await (const _chunk of request) { /* drain */ }
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, model: 'tenant-default' }))
    })
    await new Promise<void>((resolve, reject) => { upstream.once('error', reject); upstream.listen(0, '127.0.0.1', () => { resolve() }) })
    const address = upstream.address()
    const upstreamPort = typeof address === 'object' && address !== null ? address.port : 0
    const gateway = await startModelGateway({
      control: plane, port: 0, upstreamUrl: `http://127.0.0.1:${upstreamPort}/v1/chat/completions`, upstreamKey: 'upstream-secret',
    })
    gateways.push(gateway)
    const models = await fetch(`${gateway.url}/v1/models`, { headers: { authorization: `Bearer ${token}` } }).then(response => response.json()) as { tenantId: string }
    expect(models.tenantId).toBe(tenant.id)
    const response = await fetch(`${gateway.url}/v1/chat/completions`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'tenant-default', messages: [] }),
    })
    expect(response.status).toBe(200)
    expect(seen).toEqual(['Bearer upstream-secret'])
    const unauth = await fetch(`${gateway.url}/v1/models`)
    expect(unauth.status).toBe(401)
    await new Promise<void>((resolve, reject) => upstream.close(error => { error === undefined ? resolve() : reject(error) }))
  })

  it('serves tenant-scoped tickets over the HTTP session boundary', async () => {
    const { root, server } = await serverSetup()
    const tenant = server.control.provisionTenant({ name: 'A', idpIssuer: 'https://a.example', adminEmail: 'admin@a.example' })
    const admin = server.control.findUserByEmail(tenant.id, 'admin@a.example')!
    const token = server.control.issueSession({ tenantId: tenant.id, userId: admin.id, role: 'admin' })
    const created = await fetch(`${server.url}/v1/tickets`, {
      method: 'POST', headers: auth(token),
      body: JSON.stringify({ path: root, prompt: 'tenant task' }),
    })
    expect(created.status).toBe(202)
    const createdBody = await created.json() as { ticketId: string }
    const detail = await fetch(`${server.url}/v1/tickets/${createdBody.ticketId}`, { headers: auth(token) }).then(response => response.json()) as { ticketId: string }
    expect(detail.ticketId).toBe(createdBody.ticketId)
    const noAuth = await fetch(`${server.url}/v1/tickets`)
    expect(noAuth.status).toBe(401)
    const settings = await fetch(`${server.url}/v1/settings`, { headers: auth(token) }).then(response => response.json()) as { nativeConversationEnabled: boolean }
    expect(settings.nativeConversationEnabled).toBe(true)
  })
})

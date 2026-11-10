import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ControlPlane } from '../src/index.ts'
import { startControlPlaneServer, type ControlPlaneServer } from '../src/server.ts'
import { startModelGateway, type ModelGateway } from '../src/model-gateway.ts'
import { startDeviceGateway, type DeviceGateway } from '../src/device-gateway.ts'
import { WebSocket } from 'ws'
import { createServer } from 'node:http'

const roots: string[] = []
const servers: ControlPlaneServer[] = []
const planes: ControlPlane[] = []
const gateways: ModelGateway[] = []
const deviceGateways: DeviceGateway[] = []

afterEach(async () => {
  for (const gateway of deviceGateways.splice(0)) await gateway.close()
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
  it('keeps a paired device connected and rejects a revoked token', async () => {
    const { root, server } = await serverSetup()
    const tenant = server.control.provisionTenant({ name: 'A', idpIssuer: 'https://a.example', adminEmail: 'admin@a.example' })
    const admin = server.control.findUserByEmail(tenant.id, 'admin@a.example')!
    const token = server.control.issueSession({ tenantId: tenant.id, userId: admin.id, role: 'admin' })
    const pairStart = await fetch(`${server.url}/v1/devices/pair/start`, {
      method: 'POST', headers: auth(token), body: JSON.stringify({ name: 'Device' }),
    }).then(response => response.json()) as { code: string }
    const paired = await fetch(`${server.url}/v1/devices/pair/confirm`, {
      method: 'POST', headers: auth(token), body: JSON.stringify({ code: pairStart.code }),
    }).then(response => response.json()) as { deviceId: string; token: string }
    const gateway = await startDeviceGateway({ control: server.control, port: 0 })
    deviceGateways.push(gateway)
    server.setDeviceGateway(gateway)
    const events: Array<Record<string, unknown>> = []
    const closeCode = new Promise<number>(resolve => {
      const socket = new WebSocket(`${gateway.url}?token=${encodeURIComponent(paired.token)}`)
      socket.on('message', raw => events.push(JSON.parse(raw.toString()) as Record<string, unknown>))
      socket.on('close', code => resolve(code))
      socket.on('open', () => {
        socket.send(JSON.stringify({ type: 'heartbeat' }))
        setTimeout(() => {
          fetch(`${server.url}/v1/devices/${paired.deviceId}/tickets`, {
            method: 'POST', headers: auth(token),
            body: JSON.stringify({ path: root, prompt: 'device local task' }),
          }).then(async response => {
            expect(response.status).toBe(202)
            const assigned = await response.json() as { delivered: boolean }
            expect(assigned.delivered).toBe(true)
            return fetch(`${server.url}/v1/devices/${paired.deviceId}/revoke`, { method: 'POST', headers: auth(token) })
          }).then(() => socket.send(JSON.stringify({ type: 'heartbeat' }))).catch(() => undefined)
        }, 30)
      })
    })
    expect(await closeCode).toBe(4001)
    expect(events).toContainEqual(expect.objectContaining({ type: 'registered', deviceId: paired.deviceId }))
    expect(events).toContainEqual(expect.objectContaining({ type: 'heartbeat.ack' }))
    expect(events).toContainEqual(expect.objectContaining({ type: 'ticket.assign' }))
    const bogus = new WebSocket(`${gateway.url}?token=bogus`)
    expect(await new Promise<number>(resolve => bogus.once('close', code => resolve(code)))).toBe(4001)
  })

  it('proxies approval cards to the tool gateway with tenant headers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'siriusx-control-tool-'))
    roots.push(root)
    const seen: Array<Record<string, string | string[] | undefined>> = []
    const tool = createServer((request, response) => {
      seen.push(request.headers)
      if (request.method === 'GET' && (request.url ?? '').startsWith('/v1/audit')) {
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ audit: [{ id: 'audit-1', ticket_id: 't1', decision: 'approved:human' }] }))
        return
      }
      if (request.method === 'GET') {
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ approvals: [{ approvalId: 'a1', ticketId: 't1', title: 'github: send_email', detail: 'x', risk: 'medium', status: 'pending', expiresAt: new Date().toISOString() }] }))
        return
      }
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ status: 'approved' }))
    })
    await new Promise<void>((resolve, reject) => { tool.once('error', reject); tool.listen(0, '127.0.0.1', () => resolve()) })
    const address = tool.address()
    const toolPort = typeof address === 'object' && address !== null ? address.port : 0
    const server = await startControlPlaneServer({
      dbPath: join(root, 'control.sqlite'), dataDir: join(root, 'data'), port: 0, sessionSecret: 'test-secret',
      toolGatewayUrl: `http://127.0.0.1:${toolPort}`,
    })
    servers.push(server)
    const tenant = server.control.provisionTenant({ name: 'A', idpIssuer: 'https://a.example', adminEmail: 'admin@a.example' })
    const admin = server.control.findUserByEmail(tenant.id, 'admin@a.example')!
    const token = server.control.issueSession({ tenantId: tenant.id, userId: admin.id, role: 'admin' })
    const list = await fetch(`${server.url}/v1/approvals`, { headers: auth(token) }).then(response => response.json()) as { approvals: unknown[] }
    expect(list.approvals).toHaveLength(1)
    const decided = await fetch(`${server.url}/v1/approvals/a1/decide`, { method: 'POST', headers: auth(token), body: JSON.stringify({ approved: true }) }).then(response => response.json()) as { status: string }
    expect(decided.status).toBe('approved')
    // A Bot ticket trace combines ticket events with tool-gateway audit.
    const ticket = server.control.createTicket({ tenantId: tenant.id, userId: admin.id, role: 'admin' } as never, { path: root, prompt: 'trace me' })
    const trace = await fetch(`${server.url}/v1/tickets/${ticket.ticketId}/trace`, { headers: auth(token) }).then(response => response.json()) as { ticket: { ticketId: string }; audit: unknown[] }
    expect(trace.ticket.ticketId).toBe(ticket.ticketId)
    expect(trace.audit).toHaveLength(1)
    expect(seen[0]?.['x-tenant-id']).toBe(tenant.id)
    expect(seen[0]?.['x-user-id']).toBe(admin.id)
    await new Promise<void>((resolve, reject) => tool.close(error => { error === undefined ? resolve() : reject(error) }))
  })

  it('lets only a personal bot owned by the member dispatch to that member\'s device', async () => {
    const { plane } = await setup()
    const tenant = plane.provisionTenant({ name: 'A', idpIssuer: 'https://a.example', adminEmail: 'admin@a.example' })
    const admin = plane.findUserByEmail(tenant.id, 'admin@a.example')!
    const member = plane.addUser({ tenantId: tenant.id, email: 'member@a.example' })
    const adminSession = plane.verifySession(plane.issueSession({ tenantId: tenant.id, userId: admin.id, role: 'admin' }))
    const memberSession = plane.verifySession(plane.issueSession({ tenantId: tenant.id, userId: member.userId, role: 'member' }))
    const bot = plane.createBot(adminSession, 'Admin Bot')
    const memberPair = plane.startPairing(memberSession, 'Member Mac')
    const memberDevice = plane.confirmPairing(memberSession, memberPair.code)
    expect(() => plane.createPersonalBotTicket(memberSession, bot.id, memberDevice.deviceId, { path: '/tmp', prompt: 'x' })).toThrow(expect.objectContaining({ code: 'BOT_NOT_FOUND' }))
    expect(() => plane.createPersonalBotTicket(adminSession, bot.id, memberDevice.deviceId, { path: '/tmp', prompt: 'x' })).toThrow(/own device/u)
  })

})

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createHmac } from 'node:crypto'
import { SignJWT } from 'jose'
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
    const a = await plane.provisionTenant({ name: 'A', idpIssuer: 'https://a.example', adminEmail: 'admin@a.example' })
    const b = await plane.provisionTenant({ name: 'B', idpIssuer: 'https://b.example', adminEmail: 'admin@b.example' })
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
    const tenant = await plane.provisionTenant({ name: 'A', idpIssuer: 'https://a.example', adminEmail: 'admin@a.example' })
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
    const tenant = await plane.provisionTenant({ name: 'A', idpIssuer: 'https://a.example', adminEmail: 'admin@a.example' })
    const admin = plane.findUserByEmail(tenant.id, 'admin@a.example')!
    const member = await plane.addUser({ tenantId: tenant.id, email: 'member@a.example' })
    const adminSession = plane.verifySession(plane.issueSession({ tenantId: tenant.id, userId: admin.id, role: 'admin' }))
    const memberSession = plane.verifySession(plane.issueSession({ tenantId: tenant.id, userId: member.userId, role: 'member' }))
    await plane.updateSettings(adminSession, { nativeConversationEnabled: false })
    expect(plane.getSettings(tenant.id).nativeConversationEnabled).toBe(false)
    await expect(plane.updateSettings(memberSession, { nativeConversationEnabled: true })).rejects.toThrow(/admin role required/u)
  })

  it('validates SSO sessions and hides the upstream model key', async () => {
    const { plane } = await setup()
    const tenant = await plane.provisionTenant({ name: 'A', idpIssuer: 'https://a.example', adminEmail: 'admin@a.example' })
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
    await plane.addModel({ id: 'model-a', name: 'Model A', provider: 'openai', model: 'gpt-a' })
    await plane.bindTenantModel(tenant.id, 'model-a')
    const response = await fetch(`${gateway.url}/v1/chat/completions`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'tenant-default', messages: [] }),
    })
    expect(response.status).toBe(200)
    const bound = await fetch(`${gateway.url}/v1/chat/completions`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'model-a', messages: [] }),
    })
    expect(bound.status).toBe(200)
    const unbound = await fetch(`${gateway.url}/v1/chat/completions`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'model-unbound', messages: [] }),
    })
    expect(unbound.status).toBe(400)
    expect(seen).toEqual(['Bearer upstream-secret', 'Bearer upstream-secret'])
    const unauth = await fetch(`${gateway.url}/v1/models`)
    expect(unauth.status).toBe(401)
    await new Promise<void>((resolve, reject) => upstream.close(error => { error === undefined ? resolve() : reject(error) }))
  })

  it('serves tenant-scoped tickets over the HTTP session boundary', async () => {
    const { root, server } = await serverSetup()
    const tenant = await server.control.provisionTenant({ name: 'A', idpIssuer: 'https://a.example', adminEmail: 'admin@a.example' })
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
    const tenant = await server.control.provisionTenant({ name: 'A', idpIssuer: 'https://a.example', adminEmail: 'admin@a.example' })
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
      if (request.method === 'GET' && request.url === '/v1/audit/verify') {
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ valid: true, checked: 1 }))
        return
      }
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
    const tenant = await server.control.provisionTenant({ name: 'A', idpIssuer: 'https://a.example', adminEmail: 'admin@a.example' })
    const admin = server.control.findUserByEmail(tenant.id, 'admin@a.example')!
    const token = server.control.issueSession({ tenantId: tenant.id, userId: admin.id, role: 'admin' })
    const list = await fetch(`${server.url}/v1/approvals`, { headers: auth(token) }).then(response => response.json()) as { approvals: unknown[] }
    expect(list.approvals).toHaveLength(1)
    const decided = await fetch(`${server.url}/v1/approvals/a1/decide`, { method: 'POST', headers: auth(token), body: JSON.stringify({ approved: true }) }).then(response => response.json()) as { status: string }
    expect(decided.status).toBe('approved')
    // A Bot ticket trace combines ticket events with tool-gateway audit.
    const ticket = await server.control.createTicket({ tenantId: tenant.id, userId: admin.id, role: 'admin' } as never, { path: root, prompt: 'trace me' })
    const trace = await fetch(`${server.url}/v1/tickets/${ticket.ticketId}/trace`, { headers: auth(token) }).then(response => response.json()) as { ticket: { ticketId: string }; audit: unknown[]; auditChain?: { valid: boolean } }
    expect(trace.ticket.ticketId).toBe(ticket.ticketId)
    expect(trace.audit).toHaveLength(1)
    expect(trace.auditChain?.valid).toBe(true)
    expect(seen[0]?.['x-tenant-id']).toBe(tenant.id)
    expect(seen[0]?.['x-user-id']).toBe(admin.id)
    await new Promise<void>((resolve, reject) => tool.close(error => { error === undefined ? resolve() : reject(error) }))
  })

  it('lets only a personal bot owned by the member dispatch to that member\'s device', async () => {
    const { plane } = await setup()
    const tenant = await plane.provisionTenant({ name: 'A', idpIssuer: 'https://a.example', adminEmail: 'admin@a.example' })
    const admin = plane.findUserByEmail(tenant.id, 'admin@a.example')!
    const member = await plane.addUser({ tenantId: tenant.id, email: 'member@a.example' })
    const adminSession = plane.verifySession(plane.issueSession({ tenantId: tenant.id, userId: admin.id, role: 'admin' }))
    const memberSession = plane.verifySession(plane.issueSession({ tenantId: tenant.id, userId: member.userId, role: 'member' }))
    const bot = plane.createBot(adminSession, 'Admin Bot')
    const memberPair = plane.startPairing(memberSession, 'Member Mac')
    const memberDevice = plane.confirmPairing(memberSession, memberPair.code)
    expect(() => plane.createPersonalBotTicket(memberSession, bot.id, memberDevice.deviceId, { path: '/tmp', prompt: 'x' })).toThrow(expect.objectContaining({ code: 'BOT_NOT_FOUND' }))
    expect(() => plane.createPersonalBotTicket(adminSession, bot.id, memberDevice.deviceId, { path: '/tmp', prompt: 'x' })).toThrow(/own device/u)
  })

  it('merges analytics events into a ticket trace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'siriusx-trace-analytics-'))
    roots.push(root)
    const analyticsPath = join(root, 'analytics.l0l1.jsonl')
    const server = await startControlPlaneServer({
      dbPath: join(root, 'control.sqlite'), dataDir: join(root, 'data'), port: 0, sessionSecret: 'test-secret', analyticsPath,
    })
    servers.push(server)
    const tenant = await server.control.provisionTenant({ name: 'A', idpIssuer: 'https://a.example', adminEmail: 'admin@a.example' })
    const admin = server.control.findUserByEmail(tenant.id, 'admin@a.example')!
    const session = server.control.verifySession(server.control.issueSession({ tenantId: tenant.id, userId: admin.id, role: 'admin' }))
    const ticket = await server.control.createTicket(session, { path: root, prompt: 'trace analytics' })
    await writeFile(analyticsPath, [
      JSON.stringify({ ticketId: ticket.ticketId, schema: 'report.produced', payload: { reportKind: 'ready' } }),
      JSON.stringify({ ticketId: 'other', schema: 'report.produced', payload: { reportKind: 'ready' } }),
    ].join('\n') + '\n')
    const trace = await fetch(`${server.url}/v1/tickets/${ticket.ticketId}/trace`, { headers: auth(server.control.issueSession({ tenantId: tenant.id, userId: admin.id, role: 'admin' })) }).then(response => response.json()) as { analytics: Array<{ ticketId: string }> }
    expect(trace.analytics).toHaveLength(1)
    expect(trace.analytics[0]?.ticketId).toBe(ticket.ticketId)
  })

  it('rejects expired sessions', async () => {
    let now = 1_000_000
    const dir = await mkdtemp(join(tmpdir(), 'siriusx-session-expiry-'))
    roots.push(dir)
    const plane = new ControlPlane({ dbPath: join(dir, 'expiry.sqlite'), dataDir: join(dir, 'expiry-data'), now: () => now, sessionTtlMs: 1000 })
    planes.push(plane)
    const tenant = await plane.provisionTenant({ name: 'Expiry', idpIssuer: 'https://e.example', adminEmail: 'admin@e.example' })
    const admin = plane.findUserByEmail(tenant.id, 'admin@e.example')!
    const token = plane.issueSession({ tenantId: tenant.id, userId: admin.id, role: 'admin' })
    expect(plane.verifySession(token).tenantId).toBe(tenant.id)
    now += 1001
    expect(() => plane.verifySession(token)).toThrow('session expired')
  })

  it('rejects unauthenticated team-panel requests at the server boundary', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'siriusx-server-authority-'))
    roots.push(dir)
    const server = await startControlPlaneServer({ dbPath: join(dir, 'control.sqlite'), dataDir: join(dir, 'data'), port: 0, sessionSecret: 'authority-secret' })
    servers.push(server)
    const tenant = await server.control.provisionTenant({ tenantId: 'tenant-authority', name: 'Authority', idpIssuer: 'https://idp.example', adminEmail: 'admin@authority.example' })
    const admin = server.control.findUserByEmail(tenant.id, 'admin@authority.example')!
    const token = server.control.issueSession({ tenantId: tenant.id, userId: admin.id, role: 'admin' })
    const anonymous = await fetch(`${server.url}/v1/bots`)
    const anonymousTickets = await fetch(`${server.url}/v1/tickets`)
    const authorized = await fetch(`${server.url}/v1/bots`, { headers: { authorization: `Bearer ${token}` } })
    expect(anonymous.status).toBe(401)
    expect(anonymousTickets.status).toBe(401)
    expect(authorized.status).toBe(200)
  })

  it('settles cloud tickets left running across a control-plane restart', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'siriusx-cloud-restart-'))
    roots.push(dir)
    const dbPath = join(dir, 'control.sqlite')
    const first = new ControlPlane({ dbPath, dataDir: join(dir, 'data') })
    const tenant = await first.provisionTenant({ tenantId: 'tenant-cloud-restart', name: 'Cloud', idpIssuer: 'https://idp.example', adminEmail: 'admin@cloud.example' })
    first.close()
    const db = new DatabaseSync(dbPath)
    db.prepare('INSERT INTO cloud_tickets (ticket_id, tenant_id, assignment_id, repo_url, base_ref, prompt, stage, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('ticket-cloud-restart', tenant.id, 'assignment-cloud-restart', 'https://github.com/acme/repo.git', 'main', 'lost cloud task', 'working', 'running', Date.now(), Date.now())
    db.close()
    const second = new ControlPlane({ dbPath, dataDir: join(dir, 'data') })
    planes.push(second)
    const admin = second.findUserByEmail(tenant.id, 'admin@cloud.example')!
    const session = second.verifySession(second.issueSession({ tenantId: tenant.id, userId: admin.id, role: 'admin' }))
    const tickets = await second.listTickets(session) as Array<{ ticketId: string; stage: string; latestAssignment?: { state: string; report?: { kind: string } } }>
    const recovered = tickets.find(ticket => ticket.ticketId === 'ticket-cloud-restart')
    expect(recovered?.stage).toBe('person/blocked_failed')
    expect(recovered?.latestAssignment).toMatchObject({ state: 'reported', report: { kind: 'failed' } })
  })

  it('rate-limits repeated pairing attempts', async () => {
    let now = 2_000_000
    const dir = await mkdtemp(join(tmpdir(), 'siriusx-pairing-rate-'))
    roots.push(dir)
    const plane = new ControlPlane({ dbPath: join(dir, 'control.sqlite'), dataDir: join(dir, 'data'), now: () => now })
    planes.push(plane)
    const tenant = await plane.provisionTenant({ tenantId: 'tenant-pair', name: 'Pair', idpIssuer: 'https://idp.example', adminEmail: 'admin@pair.example' })
    const admin = plane.findUserByEmail(tenant.id, 'admin@pair.example')!
    const session = { tenantId: tenant.id, userId: admin.id, role: 'admin' as const }
    const pairing = plane.startPairing(session, 'Device')
    for (let attempt = 0; attempt < 5; attempt++) expect(() => plane.confirmPairing(session, `BAD${attempt}`)).toThrow()
    expect(() => plane.confirmPairing(session, pairing.code)).toThrow('too many pairing attempts')
    now += 5 * 60 * 1000 + 1
    expect(plane.confirmPairing(session, pairing.code).deviceId).toBeTruthy()
  })

  it('rotates a device token and invalidates the old token', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'siriusx-device-rotate-'))
    roots.push(dir)
    const plane = new ControlPlane({ dbPath: join(dir, 'control.sqlite'), dataDir: join(dir, 'data') })
    planes.push(plane)
    const tenant = await plane.provisionTenant({ tenantId: 'tenant-rotate', name: 'Rotate', idpIssuer: 'https://idp.example', adminEmail: 'admin@rotate.example' })
    const admin = plane.findUserByEmail(tenant.id, 'admin@rotate.example')!
    const session = { tenantId: tenant.id, userId: admin.id, role: 'admin' as const }
    const pairing = plane.startPairing(session, 'Device')
    const paired = plane.confirmPairing(session, pairing.code)
    expect(plane.verifyDeviceToken(paired.token).deviceId).toBe(paired.deviceId)
    const rotated = plane.rotateDeviceToken(session, paired.deviceId)
    expect(() => plane.verifyDeviceToken(paired.token)).toThrow()
    expect(plane.verifyDeviceToken(rotated.token).deviceId).toBe(paired.deviceId)
  })

  it('expires device tokens after 30 days and rotates them', async () => {
    let now = 3_000_000
    const dir = await mkdtemp(join(tmpdir(), 'siriusx-device-expiry-'))
    roots.push(dir)
    const plane = new ControlPlane({ dbPath: join(dir, 'control.sqlite'), dataDir: join(dir, 'data'), now: () => now })
    planes.push(plane)
    const tenant = await plane.provisionTenant({ tenantId: 'tenant-expiry', name: 'Expiry', idpIssuer: 'https://idp.example', adminEmail: 'admin@expiry.example' })
    const admin = plane.findUserByEmail(tenant.id, 'admin@expiry.example')!
    const session = { tenantId: tenant.id, userId: admin.id, role: 'admin' as const }
    const pairing = plane.startPairing(session, 'Device')
    const paired = plane.confirmPairing(session, pairing.code)
    expect(plane.verifyDeviceToken(paired.token).deviceId).toBe(paired.deviceId)
    now += 31 * 24 * 60 * 60 * 1000
    expect(() => plane.verifyDeviceToken(paired.token)).toThrow('expired')
    const rotated = plane.rotateDeviceToken(session, paired.deviceId)
    expect(rotated.expiresAt).toBeGreaterThan(now)
    expect(plane.verifyDeviceToken(rotated.token).deviceId).toBe(paired.deviceId)
  })

  it('closes a device websocket that sends an oversized frame', async () => {
    const { plane } = await setup()
    const tenant = await plane.provisionTenant({ tenantId: 'tenant-ws-limit', name: 'WS', idpIssuer: 'https://idp.example', adminEmail: 'admin@ws-limit.example' })
    const admin = plane.findUserByEmail(tenant.id, 'admin@ws-limit.example')!
    const pairing = plane.startPairing({ tenantId: tenant.id, userId: admin.id, role: 'admin' }, 'Device')
    const paired = plane.confirmPairing({ tenantId: tenant.id, userId: admin.id, role: 'admin' }, pairing.code)
    const gateway = await startDeviceGateway({ control: plane, port: 0 })
    deviceGateways.push(gateway)
    const closeCode = await new Promise<number>(resolve => {
      const socket = new WebSocket(`${gateway.url}?token=${encodeURIComponent(paired.token)}`)
      socket.on('open', () => socket.send('x'.repeat(2 * 1024 * 1024)))
      socket.on('close', code => resolve(code))
      socket.on('error', () => undefined)
    })
    expect(closeCode).toBe(1009)
  })

  it('closes a device websocket after the heartbeat timeout', async () => {
    const { plane } = await setup()
    const tenant = await plane.provisionTenant({ tenantId: 'tenant-heartbeat', name: 'Heartbeat', idpIssuer: 'https://idp.example', adminEmail: 'admin@heartbeat.example' })
    const admin = plane.findUserByEmail(tenant.id, 'admin@heartbeat.example')!
    const session = { tenantId: tenant.id, userId: admin.id, role: 'admin' as const }
    const pairing = plane.startPairing(session, 'Device')
    const paired = plane.confirmPairing(session, pairing.code)
    const gateway = await startDeviceGateway({ control: plane, port: 0, heartbeatTimeoutMs: 60 })
    deviceGateways.push(gateway)
    const closeCode = await new Promise<number>(resolve => {
      const socket = new WebSocket(`${gateway.url}?token=${encodeURIComponent(paired.token)}`)
      socket.on('close', code => resolve(code))
      socket.on('error', () => undefined)
    })
    expect(closeCode).toBe(4002)
  })

  it('rejects cloud project URLs with unsupported schemes or credentials', async () => {
    const { plane } = await setup()
    const tenant = await plane.provisionTenant({ tenantId: 'tenant-repo-url', name: 'Repo', idpIssuer: 'https://idp.example', adminEmail: 'admin@repo.example' })
    const admin = plane.findUserByEmail(tenant.id, 'admin@repo.example')!
    const session = { tenantId: tenant.id, userId: admin.id, role: 'admin' as const }
    expect(() => plane.createCloudTicket(session, { repoUrl: 'file:///etc/passwd', baseRef: 'main', prompt: 'x' })).toThrow('http or https')
    expect(() => plane.createCloudTicket(session, { repoUrl: 'https://user:pass@github.com/acme/repo.git', baseRef: 'main', prompt: 'x' })).toThrow('must not contain credentials')
  })

  it('revokes a server-side session token', async () => {
    const { plane } = await setup()
    const tenant = await plane.provisionTenant({ tenantId: 'tenant-revoke', name: 'Revoke', idpIssuer: 'https://idp.example', adminEmail: 'admin@revoke.example' })
    const admin = plane.findUserByEmail(tenant.id, 'admin@revoke.example')!
    const token = plane.issueSession({ tenantId: tenant.id, userId: admin.id, role: 'admin' })
    expect(plane.verifySession(token).userId).toBe(admin.id)
    expect(plane.revokeSession(token)).toEqual({ revoked: true })
    expect(() => plane.verifySession(token)).toThrow('session revoked')
  })

  it('serves platform and tenant user administration APIs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'siriusx-admin-api-'))
    roots.push(root)
    const server = await startControlPlaneServer({ dbPath: join(root, 'control.sqlite'), dataDir: join(root, 'data'), port: 0, sessionSecret: 'admin-api', platformAdminToken: 'platform-secret' })
    servers.push(server)
    const platform = { 'x-siriusx-platform-token': 'platform-secret', 'content-type': 'application/json' }
    expect((await fetch(`${server.url}/v1/admin/tenants`, { headers: { 'content-type': 'application/json' } })).status).toBe(401)
    const created = await fetch(`${server.url}/v1/admin/tenants`, { method: 'POST', headers: platform, body: JSON.stringify({ tenantId: 'tenant-admin-api', name: 'Admin API', idpIssuer: 'https://idp.example', adminEmail: 'admin@admin.example' }) })
    expect(created.status).toBe(201)
    const admin = server.control.findUserByEmail('tenant-admin-api', 'admin@admin.example')!
    const token = server.control.issueSession({ tenantId: 'tenant-admin-api', userId: admin.id, role: 'admin' })
    const added = await fetch(`${server.url}/v1/admin/tenants/tenant-admin-api/users`, { method: 'POST', headers: platform, body: JSON.stringify({ email: 'member@admin.example', role: 'member' }) })
    expect(added.status).toBe(201)
    const list = await fetch(`${server.url}/v1/users`, { headers: auth(token) }).then(response => response.json()) as { users: Array<{ email: string; role: string }> }
    expect(list.users).toEqual(expect.arrayContaining([{ email: 'admin@admin.example', role: 'admin' }, { email: 'member@admin.example', role: 'member' }].map(item => expect.objectContaining(item))))
    const member = list.users.find(user => user.email === 'member@admin.example')!
    const memberId = (await fetch(`${server.url}/v1/users`, { headers: auth(token) }).then(response => response.json()) as { users: Array<{ userId: string; email: string }> }).users.find(user => user.email === 'member@admin.example')!.userId
    const updated = await fetch(`${server.url}/v1/users/${memberId}/role`, { method: 'PUT', headers: auth(token), body: JSON.stringify({ role: 'admin' }) })
    expect(updated.status).toBe(200)
    expect(member.role).toBe('member')
  })

  it('enforces tenant user, device and ticket quotas', async () => {
    const { plane } = await setup()
    const tenant = await plane.provisionTenant({ tenantId: 'tenant-quota', name: 'Quota', idpIssuer: 'https://idp.example', adminEmail: 'admin@quota.example' })
    const admin = plane.findUserByEmail(tenant.id, 'admin@quota.example')!
    const session = { tenantId: tenant.id, userId: admin.id, role: 'admin' as const }
    await plane.setQuota(tenant.id, { maxUsers: 1, maxDevices: 1, maxCloudTicketsPerDay: 0, maxDeviceTicketsPerDay: 0 })
    await expect(plane.addUser({ tenantId: tenant.id, email: 'second@quota.example' })).rejects.toThrow('users quota exceeded')
    const pairing = plane.startPairing(session, 'Device')
    expect(() => plane.startPairing(session, 'Second')).toThrow('devices quota exceeded')
    const paired = plane.confirmPairing(session, pairing.code)
    expect(() => plane.createDeviceTicket(session, paired.deviceId, { path: '/tmp', prompt: 'quota' })).toThrow('deviceTickets quota exceeded')
    expect(() => plane.createCloudTicket(session, { repoUrl: 'https://github.com/acme/repo.git', baseRef: 'main', prompt: 'quota' })).toThrow('cloudTickets quota exceeded')
  })

  it('binds tenant model catalog entries', async () => {
    const { plane } = await setup()
    const tenant = await plane.provisionTenant({ tenantId: 'tenant-models', name: 'Models', idpIssuer: 'https://idp.example', adminEmail: 'admin@models.example' })
    expect(await plane.listTenantModels(tenant.id)).toEqual([expect.objectContaining({ id: 'tenant-default', isDefault: true })])
    await plane.addModel({ id: 'model-a', name: 'Model A', provider: 'openai', model: 'gpt-x' })
    await plane.bindTenantModel(tenant.id, 'model-a', true)
    expect(await plane.listTenantModels(tenant.id)).toEqual([
      expect.objectContaining({ id: 'model-a', isDefault: true }),
      expect.objectContaining({ id: 'tenant-default', isDefault: false }),
    ])
  })

  it('reports daily tenant usage with zero-filled days', async () => {
    const { plane } = await setup()
    const tenant = await plane.provisionTenant({ tenantId: 'tenant-usage-daily', name: 'Usage', idpIssuer: 'https://idp.example', adminEmail: 'admin@usage.example' })
    const usage = plane.usageDaily(tenant.id, 7)
    expect(usage).toHaveLength(7)
    expect(usage.every(day => day.cloudTickets === 0 && day.deviceTickets === 0)).toBe(true)
    expect(usage[0]?.date).not.toBe(usage[6]?.date)
  })

  it('requires tenant approval for support access requests', async () => {
    const { plane } = await setup()
    const tenant = await plane.provisionTenant({ tenantId: 'tenant-support', name: 'Support', idpIssuer: 'https://idp.example', adminEmail: 'admin@support.example' })
    const created = await plane.createSupportRequest(tenant.id, 'platform', 'investigate incident')
    expect(created.status).toBe('pending')
    expect(await plane.listSupportRequests(tenant.id)).toEqual([expect.objectContaining({ id: created.id, status: 'pending', reason: 'investigate incident' })])
    const approved = await plane.decideSupportRequest(tenant.id, created.id, true, 'admin@support.example')
    expect(approved.status).toBe('approved')
    expect(approved.expiresAt).toBeGreaterThan(Date.now())
    await expect(plane.decideSupportRequest(tenant.id, created.id, false, 'admin@support.example')).rejects.toThrow('approved')
  })

  it('suspends a tenant and invalidates its sessions', async () => {
    const { plane } = await setup()
    const tenant = await plane.provisionTenant({ tenantId: 'tenant-suspend', name: 'Suspend', idpIssuer: 'https://idp.example', adminEmail: 'admin@suspend.example' })
    const admin = plane.findUserByEmail(tenant.id, 'admin@suspend.example')!
    const token = plane.issueSession({ tenantId: tenant.id, userId: admin.id, role: 'admin' })
    expect(plane.verifySession(token).tenantId).toBe(tenant.id)
    expect((await plane.setTenantStatus(tenant.id, 'suspended')).status).toBe('suspended')
    expect(() => plane.verifySession(token)).toThrow('tenant is suspended')
    expect(() => plane.issueSession({ tenantId: tenant.id, userId: admin.id, role: 'admin' })).toThrow('tenant is suspended')
    expect((await plane.setTenantStatus(tenant.id, 'active')).status).toBe('active')
    expect(plane.issueSession({ tenantId: tenant.id, userId: admin.id, role: 'admin' })).toBeTruthy()
  })

  it('stores tenant billing rates and estimates usage cost', async () => {
    const { plane } = await setup()
    const tenant = await plane.provisionTenant({ tenantId: 'tenant-billing', name: 'Billing', idpIssuer: 'https://idp.example', adminEmail: 'admin@billing.example' })
    expect(await plane.getBilling(tenant.id)).toEqual({ currency: 'USD', cloudTicketCents: 0, deviceTicketCents: 0, monthlyBudgetCents: null })
    const billing = await plane.setBilling(tenant.id, { currency: 'EUR', cloudTicketCents: 100, deviceTicketCents: 10, monthlyBudgetCents: 5000 })
    expect(billing).toEqual({ currency: 'EUR', cloudTicketCents: 100, deviceTicketCents: 10, monthlyBudgetCents: 5000 })
    expect(await plane.billingEstimate(tenant.id, 7)).toMatchObject({ currency: 'EUR', estimatedCents: 0, monthlyBudgetCents: 5000 })
  })

  it('ingests GitLab webhook events idempotently into the bound tenant', async () => {
    const root = await mkdtemp(join(tmpdir(), 'siriusx-source-webhook-'))
    roots.push(root)
    const server = await startControlPlaneServer({ dbPath: join(root, 'control.sqlite'), dataDir: join(root, 'data'), port: 0, sessionSecret: 'source-webhook', platformAdminToken: 'platform-secret', sourceWebhookToken: 'gitlab-secret' })
    servers.push(server)
    const tenant = await server.control.provisionTenant({ tenantId: 'tenant-source', name: 'Source', idpIssuer: 'https://idp.example', adminEmail: 'admin@source.example' })
    const admin = server.control.findUserByEmail(tenant.id, 'admin@source.example')!
    const token = server.control.issueSession({ tenantId: tenant.id, userId: admin.id, role: 'admin' })
    const binding = await fetch(`${server.url}/v1/admin/source-bindings`, { method: 'POST', headers: { 'x-siriusx-platform-token': 'platform-secret', 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'gitlab', externalId: 'acme/repo', tenantId: tenant.id }) })
    expect(binding.status).toBe(201)
    const payload = { object_kind: 'issue', project: { path_with_namespace: 'acme/repo' }, object_attributes: { iid: 1, title: 'webhook issue' } }
    const unauthorized = await fetch(`${server.url}/v1/sources/gitlab/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-gitlab-token': 'bad' }, body: JSON.stringify(payload) })
    expect(unauthorized.status).toBe(401)
    const headers = { 'content-type': 'application/json', 'x-gitlab-token': 'gitlab-secret', 'x-gitlab-event': 'Issue Hook', 'x-gitlab-event-uuid': 'delivery-1' }
    const first = await fetch(`${server.url}/v1/sources/gitlab/webhook`, { method: 'POST', headers, body: JSON.stringify(payload) }).then(response => response.json()) as { accepted: boolean; duplicate: boolean }
    const second = await fetch(`${server.url}/v1/sources/gitlab/webhook`, { method: 'POST', headers, body: JSON.stringify(payload) }).then(response => response.json()) as { accepted: boolean; duplicate: boolean }
    expect(first).toMatchObject({ accepted: true, duplicate: false })
    expect(second).toMatchObject({ accepted: false, duplicate: true })
    const events = await fetch(`${server.url}/v1/source-events`, { headers: auth(token) }).then(response => response.json()) as { events: Array<{ status: string; ticketId: string | null }> }
    expect(events.events).toHaveLength(1)
    expect(events.events[0]?.status).toBe('received')
    await server.control.setQuota(tenant.id, { maxCloudTicketsPerDay: 0 })
    await fetch(`${server.url}/v1/admin/source-bindings`, { method: 'POST', headers: { 'x-siriusx-platform-token': 'platform-secret', 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'gitlab', externalId: 'acme/auto', tenantId: tenant.id, repoUrl: 'https://github.com/acme/auto.git', autoDispatch: true }) })
    const autoPayload = { object_kind: 'issue', project: { path_with_namespace: 'acme/auto' }, object_attributes: { iid: 2, title: 'auto issue', description: 'do it' } }
    const auto = await fetch(`${server.url}/v1/sources/gitlab/webhook`, { method: 'POST', headers: { ...headers, 'x-gitlab-event-uuid': 'delivery-auto' }, body: JSON.stringify(autoPayload) }).then(response => response.json()) as { accepted: boolean; dispatchError?: string }
    expect(auto.accepted).toBe(true)
    expect(auto.dispatchError).toContain('cloudTickets quota exceeded')
    const after = await fetch(`${server.url}/v1/source-events`, { headers: auth(token) }).then(response => response.json()) as { events: Array<{ status: string }> }
    expect(after.events[0]?.status).toBe('failed')
  })

  it('verifies and deduplicates GitHub webhook events', async () => {
    const root = await mkdtemp(join(tmpdir(), 'siriusx-github-webhook-'))
    roots.push(root)
    const server = await startControlPlaneServer({ dbPath: join(root, 'control.sqlite'), dataDir: join(root, 'data'), port: 0, sessionSecret: 'github-webhook', platformAdminToken: 'platform-secret', githubWebhookSecret: 'github-secret' })
    servers.push(server)
    const tenant = await server.control.provisionTenant({ tenantId: 'tenant-github', name: 'GitHub', idpIssuer: 'https://idp.example', adminEmail: 'admin@github.example' })
    await fetch(`${server.url}/v1/admin/source-bindings`, { method: 'POST', headers: { 'x-siriusx-platform-token': 'platform-secret', 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'github', externalId: 'acme/repo', tenantId: tenant.id }) })
    const payload = JSON.stringify({ action: 'opened', repository: { full_name: 'acme/repo' }, issue: { number: 1, title: 'github issue', body: 'fix it' } })
    const bad = await fetch(`${server.url}/v1/sources/github/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=bad', 'x-github-delivery': 'gh-1', 'x-github-event': 'issues' }, body: payload })
    expect(bad.status).toBe(401)
    const signature = `sha256=${createHmac('sha256', 'github-secret').update(payload).digest('hex')}`
    const headers = { 'content-type': 'application/json', 'x-hub-signature-256': signature, 'x-github-delivery': 'gh-1', 'x-github-event': 'issues' }
    const first = await fetch(`${server.url}/v1/sources/github/webhook`, { method: 'POST', headers, body: payload }).then(response => response.json()) as { accepted: boolean; duplicate: boolean }
    const second = await fetch(`${server.url}/v1/sources/github/webhook`, { method: 'POST', headers, body: payload }).then(response => response.json()) as { accepted: boolean; duplicate: boolean }
    expect(first).toMatchObject({ accepted: true, duplicate: false })
    expect(second).toMatchObject({ accepted: false, duplicate: true })
  })

  it('ingests Feishu and Teams message webhooks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'siriusx-im-webhook-'))
    roots.push(root)
    const server = await startControlPlaneServer({ dbPath: join(root, 'control.sqlite'), dataDir: join(root, 'data'), port: 0, sessionSecret: 'im-webhook', platformAdminToken: 'platform-secret', sourceWebhookToken: 'source-secret' })
    servers.push(server)
    const tenant = await server.control.provisionTenant({ tenantId: 'tenant-im', name: 'IM', idpIssuer: 'https://idp.example', adminEmail: 'admin@im.example' })
    const platform = { 'x-siriusx-platform-token': 'platform-secret', 'content-type': 'application/json' }
    await fetch(`${server.url}/v1/admin/source-bindings`, { method: 'POST', headers: platform, body: JSON.stringify({ provider: 'feishu', externalId: 'chat-1', tenantId: tenant.id }) })
    await fetch(`${server.url}/v1/admin/source-bindings`, { method: 'POST', headers: platform, body: JSON.stringify({ provider: 'teams', externalId: 'conv-1', tenantId: tenant.id }) })
    const headers = { 'content-type': 'application/json', 'x-siriusx-source-token': 'source-secret' }
    const challenge = await fetch(`${server.url}/v1/sources/feishu/webhook`, { method: 'POST', headers, body: JSON.stringify({ type: 'url_verification', challenge: 'abc' }) }).then(response => response.json()) as { challenge: string }
    expect(challenge.challenge).toBe('abc')
    const feishu = { header: { event_id: 'feishu-1', event_type: 'im.message.receive_v1' }, event: { message: { chat_id: 'chat-1', content: JSON.stringify({ text: 'hello feishu' }) } } }
    const first = await fetch(`${server.url}/v1/sources/feishu/webhook`, { method: 'POST', headers, body: JSON.stringify(feishu) }).then(response => response.json()) as { accepted: boolean }
    const second = await fetch(`${server.url}/v1/sources/feishu/webhook`, { method: 'POST', headers, body: JSON.stringify(feishu) }).then(response => response.json()) as { accepted: boolean; duplicate: boolean }
    expect(first.accepted).toBe(true)
    expect(second).toMatchObject({ accepted: false, duplicate: true })
    const teams = { id: 'teams-1', type: 'message', conversation: { id: 'conv-1' }, text: 'hello teams' }
    const accepted = await fetch(`${server.url}/v1/sources/teams/webhook`, { method: 'POST', headers, body: JSON.stringify(teams) }).then(response => response.json()) as { accepted: boolean }
    expect(accepted.accepted).toBe(true)
  })

})

const postgresEnabled = process.env.SIRIUSX_POSTGRES_TEST === '1' && process.env.DATABASE_URL !== undefined
describe.skipIf(!postgresEnabled)('control plane PostgreSQL audit', () => {
  it('writes platform audit to PostgreSQL', async () => {
    const { PostgresStorage } = await import('@siriusx/storage')
    const root = await mkdtemp(join(tmpdir(), 'siriusx-pg-audit-'))
    roots.push(root)
    const storage = new PostgresStorage(process.env.DATABASE_URL!)
    const plane = new ControlPlane({ dbPath: join(root, 'control.sqlite'), dataDir: join(root, 'data'), storage })
    planes.push(plane)
    await plane.initialize()
    try {
      await plane.recordPlatformAudit({ actor: 'platform', action: 'test.audit', target: 'tenant-test', detail: 'postgres' })
      const rows = await plane.listPlatformAudit(10)
      expect(rows[0]).toMatchObject({ actor: 'platform', action: 'test.audit', target: 'tenant-test', detail: 'postgres' })
      await storage.query("DELETE FROM platform_audit WHERE action = 'test.audit'")
    } finally {
      await storage.close()
    }
  })
  it('moves support requests to PostgreSQL when storage is configured', async () => {
    const { PostgresStorage } = await import('@siriusx/storage')
    const root = await mkdtemp(join(tmpdir(), 'siriusx-pg-support-'))
    roots.push(root)
    const storage = new PostgresStorage(process.env.DATABASE_URL!)
    const plane = new ControlPlane({ dbPath: join(root, 'control.sqlite'), dataDir: join(root, 'data'), storage })
    planes.push(plane)
    await plane.initialize()
    const tenant = await plane.provisionTenant({ tenantId: 'tenant-pg-support', name: 'PG', idpIssuer: 'https://idp.example', adminEmail: 'admin@pg.example' })
    await storage.query('INSERT INTO tenants (id, name, idp_issuer, status, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING', [tenant.id, tenant.name, tenant.idpIssuer, tenant.status, tenant.createdAt])
    try {
      const created = await plane.createSupportRequest(tenant.id, 'platform', 'pg support')
      expect((await plane.listSupportRequests(tenant.id))[0]).toMatchObject({ id: created.id, status: 'pending' })
      expect((await plane.decideSupportRequest(tenant.id, created.id, true, 'admin@pg.example')).status).toBe('approved')
      await storage.query('DELETE FROM support_requests WHERE tenant_id = ?', [tenant.id])
      await storage.query('DELETE FROM users WHERE tenant_id = ?', [tenant.id])
      await storage.query('DELETE FROM tenant_models WHERE tenant_id = ?', [tenant.id])
      await storage.query('DELETE FROM tenant_quotas WHERE tenant_id = ?', [tenant.id])
      await storage.query('DELETE FROM settings WHERE tenant_id = ?', [tenant.id])
      await storage.query('DELETE FROM tenants WHERE id = ?', [tenant.id])
    } finally {
      await storage.close()
    }
  })

  it('moves tenant billing to PostgreSQL when storage is configured', async () => {
    const { PostgresStorage } = await import('@siriusx/storage')
    const root = await mkdtemp(join(tmpdir(), 'siriusx-pg-billing-'))
    roots.push(root)
    const storage = new PostgresStorage(process.env.DATABASE_URL!)
    const plane = new ControlPlane({ dbPath: join(root, 'control.sqlite'), dataDir: join(root, 'data'), storage })
    planes.push(plane)
    await plane.initialize()
    const tenant = await plane.provisionTenant({ tenantId: 'tenant-pg-billing', name: 'PG Billing', idpIssuer: 'https://idp.example', adminEmail: 'admin@pg-billing.example' })
    await storage.query('INSERT INTO tenants (id, name, idp_issuer, status, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING', [tenant.id, tenant.name, tenant.idpIssuer, tenant.status, tenant.createdAt])
    try {
      expect((await plane.setBilling(tenant.id, { currency: 'EUR', cloudTicketCents: 100 })).currency).toBe('EUR')
      expect(await plane.getBilling(tenant.id)).toMatchObject({ currency: 'EUR', cloudTicketCents: 100 })
      await storage.query('DELETE FROM tenant_billing WHERE tenant_id = ?', [tenant.id])
      await storage.query('DELETE FROM users WHERE tenant_id = ?', [tenant.id])
      await storage.query('DELETE FROM tenant_models WHERE tenant_id = ?', [tenant.id])
      await storage.query('DELETE FROM tenant_quotas WHERE tenant_id = ?', [tenant.id])
      await storage.query('DELETE FROM settings WHERE tenant_id = ?', [tenant.id])
      await storage.query('DELETE FROM tenants WHERE id = ?', [tenant.id])
    } finally {
      await storage.close()
    }
  })

  it('mirrors users to PostgreSQL when storage is configured', async () => {
    const { PostgresStorage } = await import('@siriusx/storage')
    const root = await mkdtemp(join(tmpdir(), 'siriusx-pg-users-'))
    roots.push(root)
    const storage = new PostgresStorage(process.env.DATABASE_URL!)
    const plane = new ControlPlane({ dbPath: join(root, 'control.sqlite'), dataDir: join(root, 'data'), storage })
    planes.push(plane)
    await plane.initialize()
    const tenant = await plane.provisionTenant({ tenantId: 'tenant-pg-users', name: 'PG Users', idpIssuer: 'https://idp.example', adminEmail: 'admin@pg-users.example' })
    try {
      const member = await plane.addUser({ tenantId: tenant.id, email: 'member@pg-users.example', role: 'member' })
      expect((await storage.query('SELECT role FROM users WHERE id = ?', [member.userId])).rows[0]).toEqual({ role: 'member' })
      await plane.updateUserRole(tenant.id, member.userId, 'admin')
      expect((await storage.query('SELECT role FROM users WHERE id = ?', [member.userId])).rows[0]).toEqual({ role: 'admin' })
      await storage.query('DELETE FROM users WHERE tenant_id = ?', [tenant.id])
      await storage.query('DELETE FROM tenant_models WHERE tenant_id = ?', [tenant.id])
      await storage.query('DELETE FROM tenant_quotas WHERE tenant_id = ?', [tenant.id])
      await storage.query('DELETE FROM settings WHERE tenant_id = ?', [tenant.id])
      await storage.query('DELETE FROM tenants WHERE id = ?', [tenant.id])
    } finally {
      await storage.close()
    }
  })

  it('mirrors model catalog and bindings to PostgreSQL', async () => {
    const { PostgresStorage } = await import('@siriusx/storage')
    const root = await mkdtemp(join(tmpdir(), 'siriusx-pg-models-'))
    roots.push(root)
    const storage = new PostgresStorage(process.env.DATABASE_URL!)
    const plane = new ControlPlane({ dbPath: join(root, 'control.sqlite'), dataDir: join(root, 'data'), storage })
    planes.push(plane)
    await plane.initialize()
    const tenant = await plane.provisionTenant({ tenantId: 'tenant-pg-models', name: 'PG Models', idpIssuer: 'https://idp.example', adminEmail: 'admin@pg-models.example' })
    try {
      await plane.addModel({ id: 'model-pg', name: 'PG Model', provider: 'openai', model: 'gpt-pg' })
      await plane.bindTenantModel(tenant.id, 'model-pg', true)
      expect(await plane.listTenantModels(tenant.id)).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'model-pg', isDefault: true })]))
      expect((await storage.query('SELECT model_id, is_default FROM tenant_models WHERE tenant_id = ? ORDER BY is_default DESC', [tenant.id])).rows[0]).toMatchObject({ model_id: 'model-pg' })
      await storage.query('DELETE FROM tenant_models WHERE tenant_id = ?', [tenant.id])
      await storage.query('DELETE FROM users WHERE tenant_id = ?', [tenant.id])
      await storage.query('DELETE FROM tenant_quotas WHERE tenant_id = ?', [tenant.id])
      await storage.query('DELETE FROM settings WHERE tenant_id = ?', [tenant.id])
      await storage.query('DELETE FROM tenants WHERE id = ?', [tenant.id])
      await storage.query('DELETE FROM model_catalog WHERE id = ?', ['model-pg'])
    } finally {
      await storage.close()
    }
  })

  it('mirrors source bindings and events to PostgreSQL', async () => {
    const { PostgresStorage } = await import('@siriusx/storage')
    const root = await mkdtemp(join(tmpdir(), 'siriusx-pg-sources-'))
    roots.push(root)
    const storage = new PostgresStorage(process.env.DATABASE_URL!)
    const plane = new ControlPlane({ dbPath: join(root, 'control.sqlite'), dataDir: join(root, 'data'), storage })
    planes.push(plane)
    await plane.initialize()
    const tenant = await plane.provisionTenant({ tenantId: 'tenant-pg-sources', name: 'PG Sources', idpIssuer: 'https://idp.example', adminEmail: 'admin@pg-sources.example' })
    try {
      const binding = await plane.createSourceBinding({ provider: 'gitlab', externalId: 'acme/pg', tenantId: tenant.id, repoUrl: 'https://github.com/acme/pg.git', autoDispatch: false })
      expect((await plane.findSourceBinding('gitlab', 'acme/pg'))?.id).toBe(binding.id)
      const event = await plane.recordSourceEvent({ provider: 'gitlab', deliveryId: 'pg-delivery', bindingId: binding.id, tenantId: tenant.id, eventType: 'Issue Hook', payload: { object_kind: 'issue' } })
      expect(event.accepted).toBe(true)
      await plane.markSourceEvent(event.id, 'received')
      expect((await plane.listSourceEvents(tenant.id))[0]).toMatchObject({ id: event.id, status: 'received' })
      await storage.query('DELETE FROM source_events WHERE tenant_id = ?', [tenant.id])
      await storage.query('DELETE FROM source_bindings WHERE tenant_id = ?', [tenant.id])
      await storage.query('DELETE FROM tenant_models WHERE tenant_id = ?', [tenant.id])
      await storage.query('DELETE FROM users WHERE tenant_id = ?', [tenant.id])
      await storage.query('DELETE FROM tenant_quotas WHERE tenant_id = ?', [tenant.id])
      await storage.query('DELETE FROM settings WHERE tenant_id = ?', [tenant.id])
      await storage.query('DELETE FROM tenants WHERE id = ?', [tenant.id])
    } finally {
      await storage.close()
    }
  })

  it('reads tenants and users from the PostgreSQL cache after SQLite rows are removed', async () => {
    const { PostgresStorage } = await import('@siriusx/storage')
    const root = await mkdtemp(join(tmpdir(), 'siriusx-pg-primary-'))
    roots.push(root)
    const dbPath = join(root, 'control.sqlite')
    const storage = new PostgresStorage(process.env.DATABASE_URL!)
    const plane = new ControlPlane({ dbPath, dataDir: join(root, 'data'), storage })
    planes.push(plane)
    await plane.initialize()
    const tenant = await plane.provisionTenant({ tenantId: 'tenant-pg-primary', name: 'PG Primary', idpIssuer: 'https://idp.example', adminEmail: 'admin@pg-primary.example' })
    const user = await plane.addUser({ tenantId: tenant.id, email: 'member@pg-primary.example', role: 'member' })
    const sqlite = new DatabaseSync(dbPath)
    sqlite.exec('PRAGMA foreign_keys = OFF; DELETE FROM users; DELETE FROM tenants;')
    sqlite.close()
    try {
      expect(plane.listTenants()).toEqual(expect.arrayContaining([expect.objectContaining({ id: tenant.id })]))
      expect(plane.findUserByEmail(tenant.id, 'member@pg-primary.example')).toMatchObject({ id: user.userId, role: 'member' })
      expect(plane.listUsers(tenant.id)).toEqual(expect.arrayContaining([expect.objectContaining({ userId: user.userId })]))
      const token = plane.issueSession({ tenantId: tenant.id, userId: user.userId, role: 'member' })
      expect(plane.verifySession(token)).toMatchObject({ tenantId: tenant.id, userId: user.userId, role: 'member' })
      await plane.updateUserRole(tenant.id, user.userId, 'admin')
      expect(plane.verifySession(token).role).toBe('admin')
      expect((await plane.setTenantStatus(tenant.id, 'suspended')).status).toBe('suspended')
      expect(() => plane.issueSession({ tenantId: tenant.id, userId: user.userId, role: 'member' })).toThrow('tenant is suspended')
      await storage.query('DELETE FROM tenant_models WHERE tenant_id = ?', [tenant.id])
      await storage.query('DELETE FROM users WHERE tenant_id = ?', [tenant.id])
      await storage.query('DELETE FROM tenant_quotas WHERE tenant_id = ?', [tenant.id])
      await storage.query('DELETE FROM settings WHERE tenant_id = ?', [tenant.id])
      await storage.query('DELETE FROM tenants WHERE id = ?', [tenant.id])
    } finally {
      await storage.close()
    }
  })

  it('reads settings and quotas from the PostgreSQL cache', async () => {
    const { PostgresStorage } = await import('@siriusx/storage')
    const root = await mkdtemp(join(tmpdir(), 'siriusx-pg-settings-'))
    roots.push(root)
    const dbPath = join(root, 'control.sqlite')
    const storage = new PostgresStorage(process.env.DATABASE_URL!)
    const plane = new ControlPlane({ dbPath, dataDir: join(root, 'data'), storage })
    planes.push(plane)
    await plane.initialize()
    const tenant = await plane.provisionTenant({ tenantId: 'tenant-pg-settings', name: 'PG Settings', idpIssuer: 'https://idp.example', adminEmail: 'admin@pg-settings.example' })
    const admin = plane.findUserByEmail(tenant.id, 'admin@pg-settings.example')!
    const session = plane.verifySession(plane.issueSession({ tenantId: tenant.id, userId: admin.id, role: 'admin' }))
    await plane.updateSettings(session, { nativeConversationEnabled: false, localExecutionEnabled: false })
    await plane.setQuota(tenant.id, { maxUsers: 3, maxCloudTicketsPerDay: 2 })
    const sqlite = new DatabaseSync(dbPath)
    sqlite.exec('PRAGMA foreign_keys = OFF; DELETE FROM tenant_quotas; DELETE FROM settings; DELETE FROM users; DELETE FROM tenants;')
    sqlite.close()
    try {
      expect(plane.getSettings(tenant.id)).toMatchObject({ nativeConversationEnabled: false, localExecutionEnabled: false })
      expect(plane.getQuota(tenant.id)).toMatchObject({ maxUsers: 3, maxCloudTicketsPerDay: 2 })
      expect((await storage.query('SELECT native_conversation_enabled FROM settings WHERE tenant_id = ?', [tenant.id])).rows[0]).toEqual({ native_conversation_enabled: 0 })
      expect((await storage.query('SELECT max_users FROM tenant_quotas WHERE tenant_id = ?', [tenant.id])).rows[0]).toEqual({ max_users: 3 })
      await storage.query('DELETE FROM tenant_models WHERE tenant_id = ?', [tenant.id])
      await storage.query('DELETE FROM tenant_quotas WHERE tenant_id = ?', [tenant.id])
      await storage.query('DELETE FROM users WHERE tenant_id = ?', [tenant.id])
      await storage.query('DELETE FROM settings WHERE tenant_id = ?', [tenant.id])
      await storage.query('DELETE FROM tenants WHERE id = ?', [tenant.id])
    } finally {
      await storage.close()
    }
  })

  it('refreshes tenant/user/settings/quota caches from PostgreSQL', async () => {
    const { PostgresStorage } = await import('@siriusx/storage')
    const root = await mkdtemp(join(tmpdir(), 'siriusx-pg-refresh-'))
    roots.push(root)
    const storage = new PostgresStorage(process.env.DATABASE_URL!)
    const plane = new ControlPlane({ dbPath: join(root, 'control.sqlite'), dataDir: join(root, 'data'), storage })
    planes.push(plane)
    await plane.initialize()
    try {
      await storage.query('INSERT INTO tenants (id, name, idp_issuer, status, created_at) VALUES (?, ?, ?, ?, ?)', ['tenant-pg-refresh', 'Refresh', 'https://refresh.example', 'active', Date.now()])
      await storage.query('INSERT INTO settings (tenant_id, native_conversation_enabled, byok_enabled, local_execution_enabled) VALUES (?, 0, 1, 1)', ['tenant-pg-refresh'])
      await storage.query('INSERT INTO tenant_quotas (tenant_id, max_users, max_devices, max_cloud_tickets_per_day, max_device_tickets_per_day, updated_at) VALUES (?, 4, 2, 3, 1, ?)', ['tenant-pg-refresh', Date.now()])
      await plane.refreshCache()
      expect(plane.listTenants()).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'tenant-pg-refresh' })]))
      expect(plane.getSettings('tenant-pg-refresh').nativeConversationEnabled).toBe(false)
      expect(plane.getQuota('tenant-pg-refresh')).toMatchObject({ maxUsers: 4, maxCloudTicketsPerDay: 3 })
      await storage.query('DELETE FROM tenant_quotas WHERE tenant_id = ?', ['tenant-pg-refresh'])
      await storage.query('DELETE FROM settings WHERE tenant_id = ?', ['tenant-pg-refresh'])
      await storage.query('DELETE FROM tenants WHERE id = ?', ['tenant-pg-refresh'])
    } finally {
      await storage.close()
    }
  })

  it('invalidates peer caches through PostgreSQL LISTEN/NOTIFY', async () => {
    const { PostgresStorage } = await import('@siriusx/storage')
    const rootA = await mkdtemp(join(tmpdir(), 'siriusx-pg-notify-a-'))
    const rootB = await mkdtemp(join(tmpdir(), 'siriusx-pg-notify-b-'))
    roots.push(rootA, rootB)
    const storageA = new PostgresStorage(process.env.DATABASE_URL!)
    const storageB = new PostgresStorage(process.env.DATABASE_URL!)
    const planeA = new ControlPlane({ dbPath: join(rootA, 'control.sqlite'), dataDir: join(rootA, 'data'), storage: storageA })
    const planeB = new ControlPlane({ dbPath: join(rootB, 'control.sqlite'), dataDir: join(rootB, 'data'), storage: storageB })
    planes.push(planeA, planeB)
    await planeA.initialize(); await planeB.initialize()
    await planeA.startCacheInvalidation(); await planeB.startCacheInvalidation()
    try {
      await planeA.provisionTenant({ tenantId: 'tenant-pg-notify', name: 'Notify', idpIssuer: 'https://notify.example', adminEmail: 'admin@notify.example' })
      let visible = false
      for (let index = 0; index < 100; index++) {
        if (planeB.listTenants().some(tenant => tenant.id === 'tenant-pg-notify')) { visible = true; break }
        await new Promise(resolve => setTimeout(resolve, 20))
      }
      expect(visible).toBe(true)
      await storageA.query('DELETE FROM tenant_models WHERE tenant_id = ?', ['tenant-pg-notify'])
      await storageA.query('DELETE FROM tenant_quotas WHERE tenant_id = ?', ['tenant-pg-notify'])
      await storageA.query('DELETE FROM users WHERE tenant_id = ?', ['tenant-pg-notify'])
      await storageA.query('DELETE FROM settings WHERE tenant_id = ?', ['tenant-pg-notify'])
      await storageA.query('DELETE FROM tenants WHERE id = ?', ['tenant-pg-notify'])
    } finally {
      await planeA.stopCacheInvalidation(); await planeB.stopCacheInvalidation()
      await storageA.close(); await storageB.close()
    }
  })

  it('exchanges a desktop OIDC token for a control-plane session with model metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'siriusx-desktop-sso-'))
    roots.push(root)
    const server = await startControlPlaneServer({
      dbPath: join(root, 'control.sqlite'), dataDir: join(root, 'data'), port: 0, sessionSecret: 'desktop-sso',
      desktopSso: { issuer: 'https://idp.example', clientId: 'siriusx-desktop', hs256Secret: 'desktop-secret', modelGatewayUrl: 'http://127.0.0.1:4321' },
    })
    servers.push(server)
    const tenant = await server.control.provisionTenant({ tenantId: 'tenant-desktop-sso', name: 'Desktop SSO', idpIssuer: 'https://idp.example', adminEmail: 'admin@desktop.example' })
    await server.control.addModel({ id: 'desktop-model', name: 'Desktop Model', provider: 'openai', model: 'gpt-desktop' })
    await server.control.bindTenantModel(tenant.id, 'desktop-model', true)
    const idToken = await new SignJWT({ tenant_id: tenant.id, email: 'admin@desktop.example', roles: ['admin'] })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('https://idp.example')
      .setAudience('siriusx-desktop')
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('desktop-secret'))
    const exchanged = await fetch(`${server.url}/v1/sso/desktop/exchange`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken }) }).then(response => response.json()) as { token: string; tenantId: string; role: string; model: { id: string; provider: string } }
    expect(exchanged).toMatchObject({ tenantId: tenant.id, role: 'admin', model: { id: 'desktop-model', provider: 'openai' } })
    expect(server.control.verifySession(exchanged.token)).toMatchObject({ tenantId: tenant.id, role: 'admin' })
  })

})

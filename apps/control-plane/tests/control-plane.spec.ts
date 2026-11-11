import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
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
    const tenant = server.control.provisionTenant({ name: 'A', idpIssuer: 'https://a.example', adminEmail: 'admin@a.example' })
    const admin = server.control.findUserByEmail(tenant.id, 'admin@a.example')!
    const token = server.control.issueSession({ tenantId: tenant.id, userId: admin.id, role: 'admin' })
    const list = await fetch(`${server.url}/v1/approvals`, { headers: auth(token) }).then(response => response.json()) as { approvals: unknown[] }
    expect(list.approvals).toHaveLength(1)
    const decided = await fetch(`${server.url}/v1/approvals/a1/decide`, { method: 'POST', headers: auth(token), body: JSON.stringify({ approved: true }) }).then(response => response.json()) as { status: string }
    expect(decided.status).toBe('approved')
    // A Bot ticket trace combines ticket events with tool-gateway audit.
    const ticket = server.control.createTicket({ tenantId: tenant.id, userId: admin.id, role: 'admin' } as never, { path: root, prompt: 'trace me' })
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

  it('merges analytics events into a ticket trace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'siriusx-trace-analytics-'))
    roots.push(root)
    const analyticsPath = join(root, 'analytics.l0l1.jsonl')
    const server = await startControlPlaneServer({
      dbPath: join(root, 'control.sqlite'), dataDir: join(root, 'data'), port: 0, sessionSecret: 'test-secret', analyticsPath,
    })
    servers.push(server)
    const tenant = server.control.provisionTenant({ name: 'A', idpIssuer: 'https://a.example', adminEmail: 'admin@a.example' })
    const admin = server.control.findUserByEmail(tenant.id, 'admin@a.example')!
    const session = server.control.verifySession(server.control.issueSession({ tenantId: tenant.id, userId: admin.id, role: 'admin' }))
    const ticket = server.control.createTicket(session, { path: root, prompt: 'trace analytics' })
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
    const tenant = plane.provisionTenant({ name: 'Expiry', idpIssuer: 'https://e.example', adminEmail: 'admin@e.example' })
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
    const tenant = server.control.provisionTenant({ tenantId: 'tenant-authority', name: 'Authority', idpIssuer: 'https://idp.example', adminEmail: 'admin@authority.example' })
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
    const tenant = first.provisionTenant({ tenantId: 'tenant-cloud-restart', name: 'Cloud', idpIssuer: 'https://idp.example', adminEmail: 'admin@cloud.example' })
    first.close()
    const db = new DatabaseSync(dbPath)
    db.prepare('INSERT INTO cloud_tickets (ticket_id, tenant_id, assignment_id, repo_url, base_ref, prompt, stage, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('ticket-cloud-restart', tenant.id, 'assignment-cloud-restart', 'https://github.com/acme/repo.git', 'main', 'lost cloud task', 'working', 'running', Date.now(), Date.now())
    db.close()
    const second = new ControlPlane({ dbPath, dataDir: join(dir, 'data') })
    planes.push(second)
    const admin = second.findUserByEmail(tenant.id, 'admin@cloud.example')!
    const session = second.verifySession(second.issueSession({ tenantId: tenant.id, userId: admin.id, role: 'admin' }))
    const tickets = second.listTickets(session) as Array<{ ticketId: string; stage: string; latestAssignment?: { state: string; report?: { kind: string } } }>
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
    const tenant = plane.provisionTenant({ tenantId: 'tenant-pair', name: 'Pair', idpIssuer: 'https://idp.example', adminEmail: 'admin@pair.example' })
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
    const tenant = plane.provisionTenant({ tenantId: 'tenant-rotate', name: 'Rotate', idpIssuer: 'https://idp.example', adminEmail: 'admin@rotate.example' })
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
    const tenant = plane.provisionTenant({ tenantId: 'tenant-expiry', name: 'Expiry', idpIssuer: 'https://idp.example', adminEmail: 'admin@expiry.example' })
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
    const tenant = plane.provisionTenant({ tenantId: 'tenant-ws-limit', name: 'WS', idpIssuer: 'https://idp.example', adminEmail: 'admin@ws-limit.example' })
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

})

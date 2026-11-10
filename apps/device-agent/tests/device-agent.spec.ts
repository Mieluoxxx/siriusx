import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { startControlPlaneServer, type ControlPlaneServer } from '@siriusx/control-plane/server'
import { startDeviceGateway, type DeviceGateway } from '@siriusx/control-plane/device-gateway'
import { FakeKernel } from '@siriusx/fake-kernel'
import { LocalExecutor } from '@siriusx/executor-local'
import { startDeviceAgent } from '../src/index.ts'

const execFileAsync = promisify(execFile)
const roots: string[] = []
const servers: ControlPlaneServer[] = []
const gateways: DeviceGateway[] = []
const agents: Array<{ close(): void }> = []

afterEach(async () => {
  for (const agent of agents.splice(0)) agent.close()
  for (const gateway of gateways.splice(0)) await gateway.close()
  for (const server of servers.splice(0)) await server.close()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('device agent', () => {
  it('receives ticket.assign, runs a local_dir task and uplifts events', async () => {
    const root = await mkdtemp(join(tmpdir(), 'siriusx-device-agent-'))
    roots.push(root)
    await execFileAsync('git', ['init', '-q'], { cwd: root })
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: root })
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: root })
    await writeFile(join(root, 'app.txt'), 'one\n')
    await execFileAsync('git', ['add', '.'], { cwd: root })
    await execFileAsync('git', ['commit', '-q', '-m', 'base'], { cwd: root })

    const server = await startControlPlaneServer({ dbPath: join(root, 'control.sqlite'), dataDir: join(root, 'data'), port: 0, sessionSecret: 'test-secret' })
    servers.push(server)
    const tenant = server.control.provisionTenant({ name: 'A', idpIssuer: 'https://a.example', adminEmail: 'admin@a.example' })
    const admin = server.control.findUserByEmail(tenant.id, 'admin@a.example')!
    const token = server.control.issueSession({ tenantId: tenant.id, userId: admin.id, role: 'admin' })
    const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
    const pairStart = await fetch(`${server.url}/v1/devices/pair/start`, { method: 'POST', headers: auth, body: JSON.stringify({ name: 'Device' }) }).then(response => response.json()) as { code: string }
    const paired = await fetch(`${server.url}/v1/devices/pair/confirm`, { method: 'POST', headers: auth, body: JSON.stringify({ code: pairStart.code }) }).then(response => response.json()) as { deviceId: string; token: string }
    const gateway = await startDeviceGateway({ control: server.control, port: 0 })
    gateways.push(gateway)
    server.setDeviceGateway(gateway)
    const bot = await fetch(`${server.url}/v1/bots`, {
      method: 'POST', headers: auth, body: JSON.stringify({ name: 'Personal Dev Bot' }),
    }).then(response => response.json()) as { id: string }

    // The device is offline: the ticket waits in person/delivery.
    const created = await fetch(`${server.url}/v1/bots/${bot.id}/tickets`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ deviceId: paired.deviceId, path: root, prompt: 'device task' }),
    })
    expect(created.status).toBe(202)
    const assigned = await created.json() as { ticketId: string; delivered: boolean }
    expect(assigned.delivered).toBe(false)
    const waiting = await fetch(`${server.url}/v1/tickets/${assigned.ticketId}`, { headers: auth }).then(response => response.json()) as { stage: string }
    expect(waiting.stage).toBe('person/delivery')

    // Connecting the paired device replays the pending assignment.
    const agent = await startDeviceAgent({ url: gateway.url, token: paired.token })
    agents.push(agent)
    await agent.ready

    let detail: { stage: string; latestAssignment?: { report?: { kind: string } }; events?: unknown[] } | undefined
    for (let index = 0; index < 200; index++) {
      detail = await fetch(`${server.url}/v1/tickets/${assigned.ticketId}`, { headers: auth }).then(response => response.json()) as typeof detail
      if (detail?.latestAssignment?.report?.kind === 'ready') break
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    expect(detail?.stage).toBe('person/review')
    expect(detail?.latestAssignment?.report?.kind).toBe('ready')
    expect(detail?.events?.length).toBeGreaterThanOrEqual(3)
    expect((detail?.events ?? []).every(event => (event as { type?: string }).type !== 'log')).toBe(true)

    const beforeFollowUp = detail?.events?.length ?? 0
    const followUp = await fetch(`${server.url}/v1/tickets/${assigned.ticketId}/input`, {
      method: 'POST', headers: auth, body: JSON.stringify({ text: 'follow up on the same device' }),
    }).then(response => response.json()) as { delivered: boolean }
    expect(followUp.delivered).toBe(true)
    let afterFollowUp: { stage: string; latestAssignment?: { report?: { kind: string } }; events?: unknown[] } | undefined
    for (let index = 0; index < 200; index++) {
      afterFollowUp = await fetch(`${server.url}/v1/tickets/${assigned.ticketId}`, { headers: auth }).then(response => response.json()) as typeof afterFollowUp
      if ((afterFollowUp?.events?.length ?? 0) > beforeFollowUp && afterFollowUp?.latestAssignment?.report?.kind === 'ready') break
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    expect(afterFollowUp?.stage).toBe('person/review')
    expect((afterFollowUp?.events?.length ?? 0)).toBeGreaterThan(beforeFollowUp)
  })
  it('cancels a running device ticket through the gateway', async () => {
    const root = await mkdtemp(join(tmpdir(), 'siriusx-device-cancel-'))
    roots.push(root)
    await execFileAsync('git', ['init', '-q'], { cwd: root })
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: root })
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: root })
    await writeFile(join(root, 'app.txt'), 'one\n')
    await execFileAsync('git', ['add', '.'], { cwd: root })
    await execFileAsync('git', ['commit', '-q', '-m', 'base'], { cwd: root })
    const server = await startControlPlaneServer({ dbPath: join(root, 'control.sqlite'), dataDir: join(root, 'data'), port: 0, sessionSecret: 'test-secret' })
    servers.push(server)
    const tenant = server.control.provisionTenant({ name: 'A', idpIssuer: 'https://a.example', adminEmail: 'admin@a.example' })
    const admin = server.control.findUserByEmail(tenant.id, 'admin@a.example')!
    const token = server.control.issueSession({ tenantId: tenant.id, userId: admin.id, role: 'admin' })
    const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
    const pairing = await fetch(`${server.url}/v1/devices/pair/start`, { method: 'POST', headers: auth, body: JSON.stringify({ name: 'Slow Device' }) }).then(response => response.json()) as { code: string }
    const paired = await fetch(`${server.url}/v1/devices/pair/confirm`, { method: 'POST', headers: auth, body: JSON.stringify({ code: pairing.code }) }).then(response => response.json()) as { deviceId: string; token: string }
    const bot = await fetch(`${server.url}/v1/bots`, { method: 'POST', headers: auth, body: JSON.stringify({ name: 'Cancel Bot' }) }).then(response => response.json()) as { id: string }
    const gateway = await startDeviceGateway({ control: server.control, port: 0 })
    gateways.push(gateway)
    server.setDeviceGateway(gateway)
    const executor = new LocalExecutor({
      tenantId: tenant.id,
      backend: new FakeKernel({ defaultScenario: { steps: [{ kind: 'wait', millis: 60_000 }] } }),
    })
    const agent = await startDeviceAgent({ url: gateway.url, token: paired.token, executor })
    agents.push(agent)
    await agent.ready
    const created = await fetch(`${server.url}/v1/bots/${bot.id}/tickets`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ deviceId: paired.deviceId, path: root, prompt: 'run until cancelled' }),
    }).then(response => response.json()) as { ticketId: string; delivered: boolean }
    expect(created.delivered).toBe(true)
    let working = false
    for (let index = 0; index < 100; index++) {
      const detail = await fetch(`${server.url}/v1/tickets/${created.ticketId}`, { headers: auth }).then(response => response.json()) as { stage: string }
      if (detail.stage === 'working') { working = true; break }
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    expect(working).toBe(true)
    const cancelled = await fetch(`${server.url}/v1/tickets/${created.ticketId}/cancel`, {
      method: 'POST', headers: auth, body: '{}',
    }).then(response => response.json()) as { delivered: boolean; status: string }
    expect(cancelled).toMatchObject({ delivered: true, status: 'cancel-requested' })
    let final: { stage: string; latestAssignment?: { state: string } } | undefined
    for (let index = 0; index < 900; index++) {
      final = await fetch(`${server.url}/v1/tickets/${created.ticketId}`, { headers: auth }).then(response => response.json()) as typeof final
      if (final?.latestAssignment?.state === 'cancelled') break
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    expect(final?.latestAssignment?.state).toBe('cancelled')
    expect(final?.stage).toBe('idle')
  }, 30_000)

})

/** WebSocket frame capture of a device task: local secret must not appear on the wire. */
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { startControlPlaneServer } from '../../../apps/control-plane/src/server.ts'
import { startDeviceGateway } from '../../../apps/control-plane/src/device-gateway.ts'
import { FakeKernel } from '../../../packages/fake-kernel/src/index.ts'
import { LocalExecutor } from '../../../packages/executor-local/src/index.ts'
import { startDeviceAgent } from '../../../apps/device-agent/src/index.ts'

const run = promisify(execFile)
const require = createRequire(import.meta.url)
const { WebSocket, WebSocketServer } = require('/root/siriusx/apps/control-plane/node_modules/ws')
const root = await mkdtemp(join(tmpdir(), 'siriusx-capture-'))
const secret = 'LOCAL_SECRET_CODE_42'
await run('git', ['init', '-q'], { cwd: root })
await run('git', ['config', 'user.email', 'test@example.com'], { cwd: root })
await run('git', ['config', 'user.name', 'Test'], { cwd: root })
await writeFile(join(root, 'secret.txt'), `${secret}\n`)
await run('git', ['add', '.'], { cwd: root })
await run('git', ['commit', '-q', '-m', 'base'], { cwd: root })
const server = await startControlPlaneServer({ dbPath: join(root, 'control.sqlite'), dataDir: join(root, 'data'), port: 0, sessionSecret: 'capture-secret' })
const tenant = server.control.provisionTenant({ name: 'Capture', idpIssuer: 'https://a.example', adminEmail: 'admin@a.example' })
const admin = server.control.findUserByEmail(tenant.id, 'admin@a.example')!
const token = server.control.issueSession({ tenantId: tenant.id, userId: admin.id, role: 'admin' })
const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
const pair = await fetch(`${server.url}/v1/devices/pair/start`, { method: 'POST', headers: auth, body: JSON.stringify({ name: 'Capture Device' }) }).then(r => r.json()) as { code: string }
const paired = await fetch(`${server.url}/v1/devices/pair/confirm`, { method: 'POST', headers: auth, body: JSON.stringify({ code: pair.code }) }).then(r => r.json()) as { deviceId: string; token: string }
const bot = await fetch(`${server.url}/v1/bots`, { method: 'POST', headers: auth, body: JSON.stringify({ name: 'Capture Bot' }) }).then(r => r.json()) as { id: string }
const gateway = await startDeviceGateway({ control: server.control, port: 0 })
server.setDeviceGateway(gateway)
const frames: string[] = []
const proxy = new WebSocketServer({ host: '127.0.0.1', port: 0 })
await new Promise(resolve => proxy.once('listening', resolve))
const proxyPort = (proxy.address() as { port: number }).port
proxy.on('connection', (client, request) => {
  const upstream = new WebSocket(`${gateway.url}${request.url?.includes('?') === true ? request.url.slice(request.url.indexOf('?')) : `?token=${encodeURIComponent(paired.token)}`}`)
  client.on('message', data => { frames.push(data.toString()); if (upstream.readyState === WebSocket.OPEN) upstream.send(data.toString()) })
  upstream.on('message', data => { if (client.readyState === WebSocket.OPEN) client.send(data.toString()) })
  client.on('close', () => upstream.close())
  upstream.on('close', () => client.close())
  upstream.on('error', () => client.close())
  client.on('error', () => upstream.close())
})
const executor = new LocalExecutor({
  tenantId: tenant.id,
  backend: new FakeKernel({ defaultScenario: { steps: [
    { kind: 'delta', text: secret },
    { kind: 'tool', name: secret },
    { kind: 'delta', text: `\`\`\`siriusx-report\n{"kind":"ready","summary":"packet capture task","diffStats":{"filesChanged":0,"insertions":0,"deletions":0},"diffBasis":"ticketStart"}\n\`\`\`` },
  ] } }),
})
const agent = await startDeviceAgent({ url: `ws://127.0.0.1:${proxyPort}`, token: paired.token, executor })
await agent.ready
const gatewayPort = new URL(gateway.url).port
await new Promise(resolve => setTimeout(resolve, 200))
const created = await fetch(`${server.url}/v1/bots/${bot.id}/tickets`, {
  method: 'POST', headers: auth, body: JSON.stringify({ deviceId: paired.deviceId, path: root, prompt: 'run capture task' }),
}).then(r => r.json()) as { ticketId: string }
let detail: { stage: string; events?: unknown[] } | undefined
for (let index = 0; index < 300; index++) {
  detail = await fetch(`${server.url}/v1/tickets/${created.ticketId}`, { headers: auth }).then(r => r.json()) as typeof detail
  if (detail?.stage === 'person/review') break
  await new Promise(resolve => setTimeout(resolve, 20))
}
await new Promise(resolve => setTimeout(resolve, 500))
const leakedOnWire = frames.some(frame => frame.includes(secret))
const leakedInEvents = JSON.stringify(detail?.events ?? []).includes(secret)
console.log(JSON.stringify({ stage: detail?.stage, wireFrames: frames.length, leakedOnWire, leakedInEvents, eventCount: detail?.events?.length ?? 0 }, null, 2))
agent.close()
proxy.close()
await gateway.close()
await server.close()
await rm(root, { recursive: true, force: true })
if (leakedOnWire || leakedInEvents || detail?.stage !== 'person/review') process.exit(1)
process.exit(0)

/** Device task with a real host tcpdump capture on the device-gateway port. */
import { execFile } from 'node:child_process'
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
const port = Number(process.env.DEVICE_GATEWAY_PORT ?? 14445)
const secret = 'LOCAL_SECRET_CODE_42'
const root = await mkdtemp(join(tmpdir(), 'siriusx-tcpdump-'))
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
const gateway = await startDeviceGateway({ control: server.control, port })
server.setDeviceGateway(gateway)
const executor = new LocalExecutor({
  tenantId: tenant.id,
  backend: new FakeKernel({ defaultScenario: { steps: [
    { kind: 'delta', text: secret },
    { kind: 'tool', name: secret },
    { kind: 'delta', text: `\`\`\`siriusx-report\n{"kind":"ready","summary":"tcpdump task","diffStats":{"filesChanged":0,"insertions":0,"deletions":0},"diffBasis":"ticketStart"}\n\`\`\`` },
  ] } }),
})
const agent = await startDeviceAgent({ url: gateway.url, token: paired.token, executor })
await agent.ready
const created = await fetch(`${server.url}/v1/bots/${bot.id}/tickets`, {
  method: 'POST', headers: auth, body: JSON.stringify({ deviceId: paired.deviceId, path: root, prompt: 'run tcpdump task' }),
}).then(r => r.json()) as { ticketId: string }
let detail: { stage: string; events?: unknown[] } | undefined
for (let index = 0; index < 300; index++) {
  detail = await fetch(`${server.url}/v1/tickets/${created.ticketId}`, { headers: auth }).then(r => r.json()) as typeof detail
  if (detail?.stage === 'person/review') break
  await new Promise(resolve => setTimeout(resolve, 20))
}
console.log(JSON.stringify({ stage: detail?.stage, events: detail?.events?.length ?? 0 }, null, 2))
agent.close()
await gateway.close()
await server.close()
await rm(root, { recursive: true, force: true })
process.exit(detail?.stage === 'person/review' ? 0 : 1)

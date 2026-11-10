/** The upstream model key stays in the gateway; it never appears on the client wire or data dir. */
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startControlPlaneServer } from '../../../apps/control-plane/src/server.ts'
import { startModelGateway } from '../../../apps/control-plane/src/model-gateway.ts'

const root = await mkdtemp(join(tmpdir(), 'siriusx-key-isolation-'))
const upstreamKey = 'UPSTREAM_SECRET_KEY_7f3a'
const gatewayPort = 14500
let upstreamAuth = ''
const upstream = createServer(async (request, response) => {
  upstreamAuth = String(request.headers.authorization ?? '')
  for await (const _chunk of request) { /* drain */ }
  response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id: 'chatcmpl-test', choices: [{ message: { role: 'assistant', content: 'ok' } }] }))
})
await new Promise<void>(resolve => upstream.listen(18082, '127.0.0.1', () => resolve()))
const plane = await startControlPlaneServer({ dbPath: join(root, 'control.sqlite'), dataDir: join(root, 'data'), port: 0, sessionSecret: 'key-isolation' })
const tenant = plane.control.provisionTenant({ tenantId: 'tenant-key', name: 'Key', idpIssuer: 'https://idp.example', adminEmail: 'admin@key.example' })
const admin = plane.control.findUserByEmail(tenant.id, 'admin@key.example')!
const token = plane.control.issueSession({ tenantId: tenant.id, userId: admin.id, role: 'admin' })
const gateway = await startModelGateway({ control: plane.control, port: gatewayPort, upstreamUrl: 'http://127.0.0.1:18082/v1/chat/completions', upstreamKey })
const capturePath = join(root, 'client.cap')
const captureErrPath = join(root, 'tcpdump.err')
const capture = spawn('sh', ['-c', `exec tcpdump -i any -A -nn -l 'tcp port ${gatewayPort}' > ${capturePath} 2>${captureErrPath}`], { stdio: 'ignore' })
await new Promise(resolve => setTimeout(resolve, 500))
const response = await fetch(`${gateway.url}/v1/chat/completions`, {
  method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ model: 'tenant-default', messages: [{ role: 'user', content: 'hello' }] }),
})
await response.text()
await new Promise(resolve => setTimeout(resolve, 300))
const captureExited = new Promise(resolve => capture.once('exit', () => resolve()))
capture.kill('SIGTERM')
await Promise.race([captureExited, new Promise(resolve => setTimeout(resolve, 1000))])
const wire = await readFile(capturePath, 'utf8').catch(() => '')
let disk = ''
try {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const run = promisify(execFile)
  disk = (await run('grep', ['-R', '-l', upstreamKey, root], { maxBuffer: 4 * 1024 * 1024 }).catch(error => ({ stdout: String(error.stdout ?? '') }))).stdout
} catch { /* no grep result */ }
const result = { status: response.status, gatewaySawClientKey: wire.includes(upstreamKey), upstreamSawKey: upstreamAuth.includes(upstreamKey), diskHits: disk.trim() === '' ? [] : disk.trim().split('\n') }
console.log(JSON.stringify(result, null, 2))
await gateway.close()
await plane.close()
await new Promise<void>(resolve => upstream.close(() => resolve()))
await rm(root, { recursive: true, force: true })
if (result.status !== 200 || result.gatewaySawClientKey || !result.upstreamSawKey || result.diskHits.length > 0) process.exit(1)
process.exit(0)

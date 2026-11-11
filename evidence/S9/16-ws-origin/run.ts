import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startControlPlaneServer } from '../../../apps/control-plane/src/server.ts'
import { startWebGateway } from '../../../apps/web-gateway/src/index.ts'
const require = createRequire(import.meta.url)
const WebSocket = require('/root/siriusx/apps/control-plane/node_modules/ws')
const root = await mkdtemp(join(tmpdir(), 'siriusx-ws-origin-'))
const dsh = createServer((_q, r) => r.writeHead(200, { 'set-cookie': 'dsh=x; Path=/', 'content-type': 'text/html' }).end('ok'))
await new Promise<void>(resolve => dsh.listen(0, '127.0.0.1', () => resolve()))
const addr = dsh.address(); const dshPort = typeof addr === 'object' && addr !== null ? addr.port : 0
const control = await startControlPlaneServer({ dbPath: join(root, 'control.sqlite'), dataDir: join(root, 'data'), port: 0, sessionSecret: 'ws-secret' })
const tenant = control.control.provisionTenant({ tenantId: 'tenant-ws', name: 'WS', idpIssuer: 'https://idp.example', adminEmail: 'admin@ws.example' })
const admin = control.control.findUserByEmail(tenant.id, 'admin@ws.example')!
const token = control.control.issueSession({ tenantId: tenant.id, userId: admin.id, role: 'admin' })
const gateway = await startWebGateway({ controlPlaneUrl: control.url, dshWebUrl: `http://127.0.0.1:${dshPort}/`, port: 0 })
try {
  const login = await fetch(`${gateway.url}/auth/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) })
  const cookie = login.headers.get('set-cookie')?.split(';', 1)[0] ?? ''
  const status = await new Promise<number>(resolve => {
    const ws = new WebSocket(gateway.url.replace('http', 'ws'), { headers: { cookie, origin: 'https://evil.example' } })
    ws.on('unexpected-response', (_request: unknown, response: { statusCode: number }) => { resolve(response.statusCode); ws.terminate() })
    ws.on('open', () => { resolve(101); ws.close() })
    ws.on('error', () => resolve(-1))
  })
  console.log(JSON.stringify({ login: login.status, originRejectedStatus: status }, null, 2))
  if (login.status !== 204 || status !== 403) process.exitCode = 1
} finally {
  await gateway.close(); await control.close(); await new Promise<void>(resolve => dsh.close(() => resolve())); await rm(root, { recursive: true, force: true }); process.exit(process.exitCode ?? 0)
}

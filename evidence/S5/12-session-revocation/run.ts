import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startControlPlaneServer } from '../../../apps/control-plane/src/server.ts'
import { startWebGateway } from '../../../apps/web-gateway/src/index.ts'
const root = await mkdtemp(join(tmpdir(), 'siriusx-session-revoke-'))
const dsh = createServer((_q, r) => r.writeHead(200, { 'set-cookie': 'dsh=x; Path=/', 'content-type': 'text/html' }).end('ok'))
await new Promise<void>(resolve => dsh.listen(0, '127.0.0.1', () => resolve()))
const addr = dsh.address(); const dshPort = typeof addr === 'object' && addr !== null ? addr.port : 0
const control = await startControlPlaneServer({ dbPath: join(root, 'control.sqlite'), dataDir: join(root, 'data'), port: 0, sessionSecret: 'session-revoke' })
const tenant = control.control.provisionTenant({ tenantId: 'tenant-session', name: 'Session', idpIssuer: 'https://idp.example', adminEmail: 'admin@session.example' })
const admin = control.control.findUserByEmail(tenant.id, 'admin@session.example')!
const token = control.control.issueSession({ tenantId: tenant.id, userId: admin.id, role: 'admin' })
const gateway = await startWebGateway({ controlPlaneUrl: control.url, dshWebUrl: `http://127.0.0.1:${dshPort}/`, port: 0 })
try {
  const login = await fetch(`${gateway.url}/auth/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) })
  const cookie = login.headers.get('set-cookie')?.split(';', 1)[0] ?? ''
  const logout = await fetch(`${gateway.url}/auth/logout`, { headers: { cookie }, redirect: 'manual' })
  const after = await fetch(`${control.url}/v1/me`, { headers: { authorization: `Bearer ${token}` } }).then(r => r.json()) as { code?: string }
  console.log(JSON.stringify({ login: login.status, logout: logout.status, after }, null, 2))
  if (login.status !== 204 || logout.status !== 302 || after.code !== 'SESSION_REVOKED') process.exitCode = 1
} finally {
  await gateway.close(); await control.close(); await new Promise<void>(resolve => dsh.close(() => resolve())); await rm(root, { recursive: true, force: true }); process.exit(process.exitCode ?? 0)
}

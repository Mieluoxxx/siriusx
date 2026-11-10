/** Web Gateway rejects cross-origin state-changing requests and sets login security headers. */
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startControlPlaneServer } from '../../../apps/control-plane/src/server.ts'
import { startWebGateway } from '../../../apps/web-gateway/src/index.ts'

const root = await mkdtemp(join(tmpdir(), 'siriusx-csrf-'))
const dsh = createServer((_request, response) => response.writeHead(200, { 'set-cookie': 'dsh_session=dsh; Path=/', 'content-type': 'text/html' }).end('<html>dsh</html>'))
await new Promise<void>(resolve => dsh.listen(19097, '127.0.0.1', () => resolve()))
const control = await startControlPlaneServer({ dbPath: join(root, 'control.sqlite'), dataDir: join(root, 'data'), port: 0, sessionSecret: 'csrf-secret' })
const tenant = control.control.provisionTenant({ tenantId: 'tenant-csrf', name: 'Csrf', idpIssuer: 'https://idp.example', adminEmail: 'admin@csrf.example' })
const admin = control.control.findUserByEmail(tenant.id, 'admin@csrf.example')!
const token = control.control.issueSession({ tenantId: tenant.id, userId: admin.id, role: 'admin' })
const gateway = await startWebGateway({ controlPlaneUrl: control.url, dshWebUrl: 'http://127.0.0.1:19097/', port: 19098 })
try {
  const evil = await fetch(`${gateway.url}/auth/session`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: JSON.stringify({ token }) })
  const sameOrigin = await fetch(`${gateway.url}/auth/session`, { method: 'POST', headers: { 'content-type': 'application/json', origin: gateway.url }, body: JSON.stringify({ token }) })
  const noOrigin = await fetch(`${gateway.url}/auth/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) })
  const login = await fetch(`${gateway.url}/login`)
  const result = {
    evil: evil.status,
    sameOrigin: sameOrigin.status,
    noOrigin: noOrigin.status,
    loginStatus: login.status,
    nosniff: login.headers.get('x-content-type-options'),
    frame: login.headers.get('x-frame-options'),
    referrer: login.headers.get('referrer-policy'),
  }
  console.log(JSON.stringify(result, null, 2))
  if (result.evil !== 403 || result.sameOrigin !== 204 || result.noOrigin !== 204 || result.nosniff !== 'nosniff' || result.frame !== 'DENY') process.exitCode = 1
} finally {
  await gateway.close()
  await control.close()
  await new Promise<void>(resolve => dsh.close(() => resolve()))
  await rm(root, { recursive: true, force: true })
  process.exit(process.exitCode ?? 0)
}

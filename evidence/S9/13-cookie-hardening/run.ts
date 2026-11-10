/** Web Gateway local logout clears the HttpOnly session cookie. */
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startControlPlaneServer } from '../../../apps/control-plane/src/server.ts'
import { startWebGateway } from '../../../apps/web-gateway/src/index.ts'

const root = await mkdtemp(join(tmpdir(), 'siriusx-logout-'))
const dsh = createServer((_request, response) => response.writeHead(200, { 'set-cookie': 'dsh_session=dsh; Path=/', 'content-type': 'text/html' }).end('<html>dsh</html>'))
await new Promise<void>(resolve => dsh.listen(19096, '127.0.0.1', () => resolve()))
const control = await startControlPlaneServer({ dbPath: join(root, 'control.sqlite'), dataDir: join(root, 'data'), port: 0, sessionSecret: 'logout-secret' })
const tenant = control.control.provisionTenant({ tenantId: 'tenant-logout', name: 'Logout', idpIssuer: 'https://idp.example', adminEmail: 'admin@logout.example' })
const admin = control.control.findUserByEmail(tenant.id, 'admin@logout.example')!
const token = control.control.issueSession({ tenantId: tenant.id, userId: admin.id, role: 'admin' })
const gateway = await startWebGateway({ controlPlaneUrl: control.url, dshWebUrl: 'http://127.0.0.1:19096/', port: 19097 })
try {
  const login = await fetch(`${gateway.url}/auth/session`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-proto': 'https' }, body: JSON.stringify({ token }) })
  const setCookie = login.headers.get('set-cookie') ?? ''
  const cookie = setCookie.split(';', 1)[0] ?? ''
  const before = await fetch(`${gateway.url}/v1/me`, { headers: { cookie } })
  const logout = await fetch(`${gateway.url}/auth/logout`, { headers: { cookie, 'x-forwarded-proto': 'https' }, redirect: 'manual' })
  const cleared = logout.headers.get('set-cookie') ?? ''
  const after = await fetch(`${gateway.url}/v1/me`, { headers: { cookie: cleared.split(';', 1)[0] ?? '' } })
  console.log(JSON.stringify({ login: login.status, secure: setCookie.includes('Secure'), before: before.status, logout: logout.status, cleared: cleared.includes('Max-Age=0') && cleared.includes('Secure'), after: after.status }, null, 2))
  if (login.status !== 204 || !setCookie.includes('Secure') || before.status !== 200 || logout.status !== 302 || !cleared.includes('Max-Age=0') || !cleared.includes('Secure') || after.status !== 401) process.exitCode = 1
} finally {
  await gateway.close()
  await control.close()
  await new Promise<void>(resolve => dsh.close(() => resolve()))
  await rm(root, { recursive: true, force: true })
  process.exit(process.exitCode ?? 0)
}

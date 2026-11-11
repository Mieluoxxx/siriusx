import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startControlPlaneServer } from '../../../apps/control-plane/src/server.ts'
import { startWebGateway } from '../../../apps/web-gateway/src/index.ts'
const root = await mkdtemp(join(tmpdir(), 'siriusx-login-csp-'))
const dsh = createServer((_q, r) => r.writeHead(200, { 'set-cookie': 'dsh=x; Path=/', 'content-type': 'text/html' }).end('ok'))
await new Promise<void>(resolve => dsh.listen(0, '127.0.0.1', () => resolve()))
const addr = dsh.address(); const dshPort = typeof addr === 'object' && addr !== null ? addr.port : 0
const control = await startControlPlaneServer({ dbPath: join(root, 'control.sqlite'), dataDir: join(root, 'data'), port: 0, sessionSecret: 'login-csp' })
const gateway = await startWebGateway({ controlPlaneUrl: control.url, dshWebUrl: `http://127.0.0.1:${dshPort}/`, port: 0 })
try {
  const response = await fetch(`${gateway.url}/login`)
  const headers = { csp: response.headers.get('content-security-policy'), frame: response.headers.get('x-frame-options'), nosniff: response.headers.get('x-content-type-options') }
  console.log(JSON.stringify({ status: response.status, headers }, null, 2))
  if (response.status !== 200 || !headers.csp?.includes("frame-ancestors 'none'") || !headers.csp?.includes("script-src 'unsafe-inline'") || headers.frame !== 'DENY') process.exitCode = 1
} finally {
  await gateway.close(); await control.close(); await new Promise<void>(resolve => dsh.close(() => resolve())); await rm(root, { recursive: true, force: true }); process.exit(process.exitCode ?? 0)
}

import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startControlPlaneServer } from '../../../apps/control-plane/src/server.ts'
import { startToolGatewayServer } from '../../../apps/tool-gateway/src/server.ts'
import { startWebGateway } from '../../../apps/web-gateway/src/index.ts'
const root = await mkdtemp(join(tmpdir(), 'siriusx-body-limit-'))
const control = await startControlPlaneServer({ dbPath: join(root, 'control.sqlite'), dataDir: join(root, 'data'), port: 0, sessionSecret: 'body-limit' })
const tenant = control.control.provisionTenant({ tenantId: 'tenant-body', name: 'Body', idpIssuer: 'https://idp.example', adminEmail: 'admin@body.example' })
const admin = control.control.findUserByEmail(tenant.id, 'admin@body.example')!
const token = control.control.issueSession({ tenantId: tenant.id, userId: admin.id, role: 'admin' })
const tool = await startToolGatewayServer({ dbPath: join(root, 'tool.sqlite'), port: 0, connectors: {} })
const dsh = createServer((_q, r) => r.writeHead(200, { 'set-cookie': 'dsh=x; Path=/', 'content-type': 'text/html' }).end('ok'))
await new Promise<void>(resolve => dsh.listen(0, '127.0.0.1', () => resolve()))
const dshAddress = dsh.address(); const dshPort = typeof dshAddress === 'object' && dshAddress !== null ? dshAddress.port : 0
const gateway = await startWebGateway({ controlPlaneUrl: control.url, dshWebUrl: `http://127.0.0.1:${dshPort}/`, port: 0 })
try {
  const large = 'x'.repeat(2 * 1024 * 1024)
  const controlResponse = await fetch(`${control.url}/v1/cloud-projects/tickets`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ repoUrl: 'https://github.com/acme/repo.git', prompt: large, baseRef: 'main' }),
  })
  const toolResponse = await fetch(`${tool.url}/v1/actions`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-tenant-id': 'tenant-body', 'x-user-id': 'user-body', 'x-role': 'admin' }, body: JSON.stringify({ content: large }),
  })
  const webResponse = await fetch(`${gateway.url}/auth/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: large }) })
  const result = { controlStatus: controlResponse.status, controlBody: await controlResponse.text(), toolStatus: toolResponse.status, toolBody: await toolResponse.text(), webStatus: webResponse.status, webBody: await webResponse.text() }
  console.log(JSON.stringify(result, null, 2))
  if (result.controlStatus !== 413 || result.toolStatus !== 413 || result.webStatus !== 413) process.exitCode = 1
} finally {
  await gateway.close(); await tool.close(); await control.close(); await new Promise<void>(resolve => dsh.close(() => resolve())); await rm(root, { recursive: true, force: true }); process.exit(process.exitCode ?? 0)
}

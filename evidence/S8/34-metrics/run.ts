import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startControlPlaneServer } from '../../../apps/control-plane/src/server.ts'
import { startToolGatewayServer } from '../../../apps/tool-gateway/src/server.ts'
import { startWebGateway } from '../../../apps/web-gateway/src/index.ts'
const root = await mkdtemp(join(tmpdir(), 'siriusx-metrics-'))
const dsh = createServer((_q, r) => r.writeHead(200, { 'set-cookie': 'dsh=x; Path=/', 'content-type': 'text/html' }).end('ok'))
await new Promise<void>(resolve => dsh.listen(0, '127.0.0.1', () => resolve()))
const addr = dsh.address(); const dshPort = typeof addr === 'object' && addr !== null ? addr.port : 0
const control = await startControlPlaneServer({ dbPath: join(root, 'control.sqlite'), dataDir: join(root, 'data'), port: 0, sessionSecret: 'metrics' })
const tenant = control.control.provisionTenant({ tenantId: 'tenant-metrics', name: 'Metrics', idpIssuer: 'https://idp.example', adminEmail: 'admin@metrics.example' })
control.control.startPairing({ tenantId: tenant.id, userId: control.control.findUserByEmail(tenant.id, 'admin@metrics.example')!.id, role: 'admin' }, 'Device')
const tool = await startToolGatewayServer({ dbPath: join(root, 'tool.sqlite'), port: 0, connectors: { github: { execute: async () => ({ result: { ok: true } }) } } })
await fetch(`${tool.url}/v1/actions`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-tenant-id': 'tenant-metrics', 'x-user-id': 'user-1', 'x-role': 'admin' }, body: JSON.stringify({ tenantId: 'tenant-metrics', botId: 'bot', ticketId: 'ticket', operatorId: 'op', system: 'github', actionClass: 'read', target: 'acme/repo#1', content: 'check', mandate: { actions: [] } }) })
const web = await startWebGateway({ controlPlaneUrl: control.url, dshWebUrl: `http://127.0.0.1:${dshPort}/`, port: 0 })
try {
  const bodies = {
    control: await fetch(`${control.url}/metrics`).then(r => r.text()),
    tool: await fetch(`${tool.url}/metrics`).then(r => r.text()),
    web: await fetch(`${web.url}/metrics`).then(r => r.text()),
  }
  console.log(JSON.stringify(bodies, null, 2))
  if (!bodies.control.includes('siriusx_control_plane_tenants 1') || !bodies.control.includes('siriusx_control_plane_devices 1')) process.exitCode = 1
  if (!bodies.tool.includes('siriusx_tool_gateway_audits 1') || !bodies.tool.includes('siriusx_tool_gateway_audit_chain_valid 1')) process.exitCode = 1
  if (!bodies.web.includes('siriusx_web_gateway_up 1')) process.exitCode = 1
} finally {
  await web.close(); await tool.close(); await control.close(); await new Promise<void>(resolve => dsh.close(() => resolve())); await rm(root, { recursive: true, force: true })
}

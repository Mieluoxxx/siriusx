import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startControlPlaneServer } from '../../../apps/control-plane/src/server.ts'
import { startToolGatewayServer } from '../../../apps/tool-gateway/src/server.ts'
import { startWebGateway } from '../../../apps/web-gateway/src/index.ts'
const root = await mkdtemp(join(tmpdir(), 'siriusx-ready-'))
const dsh = createServer((_q, r) => r.writeHead(200, { 'set-cookie': 'dsh=x; Path=/', 'content-type': 'text/html' }).end('ok'))
await new Promise<void>(resolve => dsh.listen(0, '127.0.0.1', () => resolve()))
const addr = dsh.address(); const dshPort = typeof addr === 'object' && addr !== null ? addr.port : 0
const control = await startControlPlaneServer({ dbPath: join(root, 'control.sqlite'), dataDir: join(root, 'data'), port: 0, sessionSecret: 'ready' })
const tool = await startToolGatewayServer({ dbPath: join(root, 'tool.sqlite'), port: 0, connectors: {} })
const gateway = await startWebGateway({ controlPlaneUrl: control.url, dshWebUrl: `http://127.0.0.1:${dshPort}/`, port: 0 })
try {
  const get = async (url: string) => ({ status: (await fetch(url)).status, body: await (await fetch(url)).json() })
  const healthy = { control: await get(`${control.url}/ready`), tool: await get(`${tool.url}/ready`), web: await get(`${gateway.url}/ready`) }
  await new Promise<void>(resolve => dsh.close(() => resolve()))
  const degraded = await get(`${gateway.url}/ready`)
  console.log(JSON.stringify({ healthy, degraded }, null, 2))
  if (healthy.control.status !== 200 || healthy.tool.status !== 200 || healthy.web.status !== 200) process.exitCode = 1
  if (degraded.status !== 503 || degraded.body.checks?.dshWeb !== false) process.exitCode = 1
} finally {
  await gateway.close(); await tool.close(); await control.close(); await rm(root, { recursive: true, force: true }); process.exit(process.exitCode ?? 0)
}

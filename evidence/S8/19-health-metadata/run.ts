import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startControlPlaneServer } from '../../../apps/control-plane/src/server.ts'
import { startToolGatewayServer } from '../../../apps/tool-gateway/src/server.ts'
import { startWebGateway } from '../../../apps/web-gateway/src/index.ts'
process.env.SIRIUSX_VERSION = '9.8.7'
process.env.SIRIUSX_COMMIT = 'abc1234'
const root = await mkdtemp(join(tmpdir(), 'siriusx-health-'))
const dsh = createServer((_q, r) => r.writeHead(200, { 'set-cookie': 'dsh=x; Path=/', 'content-type': 'text/html' }).end('ok'))
await new Promise<void>(resolve => dsh.listen(0, '127.0.0.1', () => resolve()))
const address = dsh.address(); const dshPort = typeof address === 'object' && address !== null ? address.port : 0
const cp = await startControlPlaneServer({ dbPath: join(root, 'control.sqlite'), dataDir: join(root, 'data'), port: 0, sessionSecret: 'health' })
const tool = await startToolGatewayServer({ dbPath: join(root, 'tool.sqlite'), port: 0, connectors: {} })
const web = await startWebGateway({ controlPlaneUrl: cp.url, dshWebUrl: `http://127.0.0.1:${dshPort}/`, port: 0 })
try {
  const bodies = {
    controlPlane: await fetch(`${cp.url}/health`).then(r => r.json()),
    toolGateway: await fetch(`${tool.url}/health`).then(r => r.json()),
    webGateway: await fetch(`${web.url}/health`).then(r => r.json()),
  }
  console.log(JSON.stringify(bodies, null, 2))
  const all = Object.values(bodies) as Array<Record<string, unknown>>
  if (all.some(body => body.version !== '9.8.7' || body.commit !== 'abc1234')) process.exitCode = 1
} finally {
  await web.close(); await tool.close(); await cp.close(); await new Promise<void>(resolve => dsh.close(() => resolve()))
  await rm(root, { recursive: true, force: true }); process.exit(process.exitCode ?? 0)
}

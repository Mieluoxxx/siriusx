import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startControlPlaneServer } from '../../../apps/control-plane/src/server.ts'
import { startWebGateway } from '../../../apps/web-gateway/src/index.ts'
const require = createRequire(import.meta.url)
const WebSocket = require('/root/siriusx/apps/control-plane/node_modules/ws')
const root = await mkdtemp(join(tmpdir(), 'siriusx-forwarded-origin-'))
const dsh = createServer((_q, r) => r.writeHead(200, { 'set-cookie': 'dsh=x; Path=/', 'content-type': 'text/html' }).end('ok'))
await new Promise<void>(resolve => dsh.listen(0, '127.0.0.1', () => resolve()))
const addr = dsh.address(); const dshPort = typeof addr === 'object' && addr !== null ? addr.port : 0
const control = await startControlPlaneServer({ dbPath: join(root, 'control.sqlite'), dataDir: join(root, 'data'), port: 0, sessionSecret: 'forwarded-origin' })
const gateway = await startWebGateway({ controlPlaneUrl: control.url, dshWebUrl: `http://127.0.0.1:${dshPort}/`, port: 0 })
try {
  const forwarded = { origin: 'https://app.example', 'x-forwarded-proto': 'https', 'x-forwarded-host': 'app.example', 'content-type': 'application/json' }
  const login = await fetch(`${gateway.url}/auth/session`, { method: 'POST', headers: forwarded, body: JSON.stringify({ token: 'bad' }) })
  const wsStatus = await new Promise<number>(resolve => {
    const ws = new WebSocket(gateway.url.replace('http', 'ws'), { headers: forwarded })
    ws.on('unexpected-response', (_request: unknown, response: { statusCode: number }) => { resolve(response.statusCode); ws.terminate() })
    ws.on('open', () => { resolve(101); ws.close() })
    ws.on('error', () => resolve(-1))
  })
  console.log(JSON.stringify({ login: login.status, ws: wsStatus }, null, 2))
  if (login.status !== 401 || wsStatus !== 401) process.exitCode = 1
} finally {
  await gateway.close(); await control.close(); await new Promise<void>(resolve => dsh.close(() => resolve())); await rm(root, { recursive: true, force: true })
}

import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startWebGateway } from '../../../apps/web-gateway/src/index.ts'
const issuer = 'http://127.0.0.1:19091'
const idp = createServer((request, response) => {
  if (request.url === '/.well-known/openid-configuration') {
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token` }))
  } else response.writeHead(404).end()
})
await new Promise<void>(resolve => idp.listen(19091, '127.0.0.1', () => resolve()))
const dsh = createServer((_q, r) => r.writeHead(200, { 'set-cookie': 'dsh=x; Path=/', 'content-type': 'text/html' }).end('ok'))
await new Promise<void>(resolve => dsh.listen(0, '127.0.0.1', () => resolve()))
const dshAddr = dsh.address(); const dshPort = typeof dshAddr === 'object' && dshAddr !== null ? dshAddr.port : 0
const control = createServer((_q, r) => r.writeHead(200, { 'content-type': 'application/json' }).end('{}'))
await new Promise<void>(resolve => control.listen(0, '127.0.0.1', () => resolve()))
const controlAddr = control.address(); const controlPort = typeof controlAddr === 'object' && controlAddr !== null ? controlAddr.port : 0
const gateway = await startWebGateway({
  controlPlaneUrl: `http://127.0.0.1:${controlPort}`,
  dshWebUrl: `http://127.0.0.1:${dshPort}/`,
  port: 0,
  controlPlaneServiceToken: 'service-token',
  oidc: { issuer, clientId: 'client', clientSecret: 'secret', redirectUri: 'http://127.0.0.1:8080/auth/oidc/callback', tenantId: 'tenant', idTokenAlg: 'HS256' },
})
try {
  const start = await fetch(`${gateway.url}/auth/oidc/start`, { redirect: 'manual' })
  const location = start.headers.get('location') ?? ''
  const state = new URL(location).searchParams.get('state') ?? ''
  const stateCookie = start.headers.get('set-cookie')?.split(';', 1)[0] ?? ''
  const callback = await fetch(`${gateway.url}/auth/oidc/callback?state=${encodeURIComponent(state)}&code=x`, { redirect: 'manual' })
  const result = { start: start.status, hasStateCookie: stateCookie.startsWith('siriusx_oidc_state='), stateLength: state.length, noCookieCallback: callback.status, noCookieBody: await callback.text() }
  console.log(JSON.stringify(result, null, 2))
  if (start.status !== 302 || !result.hasStateCookie || result.stateLength < 10 || callback.status !== 400) process.exitCode = 1
} finally {
  await gateway.close(); await new Promise<void>(resolve => control.close(() => resolve())); await new Promise<void>(resolve => dsh.close(() => resolve())); await new Promise<void>(resolve => idp.close(() => resolve())); await rm(join(tmpdir(), 'unused'), { recursive: true, force: true })
}

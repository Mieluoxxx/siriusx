/** Browser OIDC authorization-code flow with RS256 ID token + JWKS discovery. */
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { exportJWK, generateKeyPair, SignJWT } from '../../../apps/web-gateway/node_modules/jose/dist/webapi/index.js'
import { startControlPlaneServer } from '../../../apps/control-plane/src/server.ts'
import { startWebGateway } from '../../../apps/web-gateway/src/index.ts'

const root = await mkdtemp(join(tmpdir(), 'siriusx-oidc-rs256-'))
const issuer = 'http://127.0.0.1:19093'
const clientId = 'siriusx-web-rs256'
const secret = 'rs256-client-secret'
const service = 'rs256-service-secret'
const { publicKey, privateKey } = await generateKeyPair('RS256')
const publicJwk = { ...await exportJWK(publicKey), kid: 'rs256-key', alg: 'RS256', use: 'sig' }
const codes = new Map<string, string>()
const idp = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', issuer)
  if (url.pathname === '/.well-known/openid-configuration') {
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
      issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`,
    }))
    return
  }
  if (url.pathname === '/jwks') {
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ keys: [publicJwk] }))
    return
  }
  if (url.pathname === '/authorize') {
    const code = `rs256-${Date.now()}`
    codes.set(code, url.searchParams.get('nonce') ?? '')
    const target = new URL(url.searchParams.get('redirect_uri') ?? '')
    target.searchParams.set('code', code)
    target.searchParams.set('state', url.searchParams.get('state') ?? '')
    response.writeHead(302, { location: target.toString() }).end()
    return
  }
  if (url.pathname === '/token') {
    let body = ''
    for await (const chunk of request) body += chunk
    const params = new URLSearchParams(body)
    const nonce = codes.get(params.get('code') ?? '') ?? ''
    const idToken = await new SignJWT({ email: 'admin@rs256.example', nonce })
      .setProtectedHeader({ alg: 'RS256', kid: 'rs256-key' })
      .setIssuer(issuer).setAudience(clientId).setSubject('rs256-user').setIssuedAt().setExpirationTime('5m')
      .sign(privateKey)
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id_token: idToken, token_type: 'Bearer' }))
    return
  }
  response.writeHead(404).end()
})
await new Promise<void>((resolve, reject) => idp.listen(19093, '127.0.0.1', () => resolve()).once('error', reject))
const dsh = createServer((_request, response) => {
  response.writeHead(200, { 'set-cookie': 'dsh_session=rs256; Path=/', 'content-type': 'text/html' }).end('<html>dsh</html>')
})
await new Promise<void>(resolve => dsh.listen(19094, '127.0.0.1', () => resolve()))
const control = await startControlPlaneServer({ dbPath: join(root, 'control.sqlite'), dataDir: join(root, 'data'), port: 0, sessionSecret: 'rs256-session', ssoServiceToken: service })
control.control.provisionTenant({ tenantId: 'tenant-rs256', name: 'RS256', idpIssuer: issuer, adminEmail: 'admin@rs256.example' })
const gateway = await startWebGateway({
  controlPlaneUrl: control.url, dshWebUrl: 'http://127.0.0.1:19094/', port: 19095,
  controlPlaneServiceToken: service,
  oidc: { issuer, clientId, clientSecret: secret, redirectUri: 'http://127.0.0.1:19095/auth/oidc/callback', tenantId: 'tenant-rs256', role: 'admin', idTokenAlg: 'RS256' },
})
try {
  const start = await fetch(`${gateway.url}/auth/oidc/start`, { redirect: 'manual' })
  const authorization = start.headers.get('location')
  if (authorization === null) throw new Error('no authorization redirect')
  const authorizeResponse = await fetch(authorization, { redirect: 'manual' })
  const callback = authorizeResponse.headers.get('location')
  if (callback === null) throw new Error('no callback redirect')
  const callbackResponse = await fetch(callback, { redirect: 'manual' })
  const cookie = callbackResponse.headers.get('set-cookie')
  if (cookie === null) throw new Error('no session cookie')
  const me = await fetch(`${gateway.url}/v1/me`, { headers: { cookie: cookie.split(';', 1)[0]! } })
  console.log(JSON.stringify({ start: start.status, authorize: authorizeResponse.status, callback: callbackResponse.status, me: me.status, meBody: await me.json() }, null, 2))
} finally {
  await gateway.close()
  await control.close()
  await new Promise<void>(resolve => idp.close(() => resolve()))
  await new Promise<void>(resolve => dsh.close(() => resolve()))
  await rm(root, { recursive: true, force: true })
}

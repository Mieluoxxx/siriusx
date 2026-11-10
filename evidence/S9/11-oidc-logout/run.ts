/** Authorization-code + PKCE + HS256 ID token through web-gateway and control-plane. */
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SignJWT } from '../../../apps/web-gateway/node_modules/jose/dist/webapi/index.js'
import { ControlPlane } from '../../../apps/control-plane/src/index.ts'
import { startControlPlaneServer } from '../../../apps/control-plane/src/server.ts'
import { startWebGateway } from '../../../apps/web-gateway/src/index.ts'

const root = await mkdtemp(join(tmpdir(), 'siriusx-oidc-logout-'))
const issuer = 'http://127.0.0.1:19090'
const clientId = 'siriusx-web'
const clientSecret = 'oidc-test-secret'
const serviceToken = 'sso-service-secret'
const codes = new Map<string, string>()
const idp = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', issuer)
  if (url.pathname === '/.well-known/openid-configuration') {
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
      issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`, end_session_endpoint: `${issuer}/end-session`,
    }))
    return
  }
  if (url.pathname === '/end-session') {
    response.writeHead(302, { location: url.searchParams.get('post_logout_redirect_uri') ?? `${issuer}/logged-out` }).end()
    return
  }
  if (url.pathname === '/authorize') {
    const code = `code-${Date.now()}`
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
    const idToken = await new SignJWT({ email: 'admin@oidc.example', nonce })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(issuer).setAudience(clientId).setSubject('oidc-user').setIssuedAt().setExpirationTime('5m')
      .sign(new TextEncoder().encode(clientSecret))
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id_token: idToken, token_type: 'Bearer' }))
    return
  }
  response.writeHead(404).end()
})
await new Promise<void>((resolve, reject) => idp.listen(19090, '127.0.0.1', () => resolve()).once('error', reject))
const dsh = createServer((_request, response) => {
  response.writeHead(200, { 'set-cookie': 'dsh_session=test; Path=/', 'content-type': 'text/html' }).end('<html>dsh</html>')
})
await new Promise<void>(resolve => dsh.listen(19091, '127.0.0.1', () => resolve()))
const control = await startControlPlaneServer({
  dbPath: join(root, 'control.sqlite'), dataDir: join(root, 'data'), port: 0, sessionSecret: 'oidc-session',
  ssoServiceToken: serviceToken,
})
control.control.provisionTenant({ tenantId: 'tenant-oidc', name: 'OIDC', idpIssuer: issuer, adminEmail: 'admin@oidc.example' })
const gateway = await startWebGateway({
  controlPlaneUrl: control.url, dshWebUrl: 'http://127.0.0.1:19091/', port: 19092,
  controlPlaneServiceToken: serviceToken,
  oidc: { issuer, clientId, clientSecret, redirectUri: 'http://127.0.0.1:19092/auth/oidc/callback', tenantId: 'tenant-oidc', role: 'admin', idTokenAlg: 'HS256' },
})
try {
  const start = await fetch(`${gateway.url}/auth/oidc/start`, { redirect: 'manual' })
  const authorization = start.headers.get('location')
  if (authorization === null) throw new Error('no OIDC authorization redirect')
  const authorizeResponse = await fetch(authorization, { redirect: 'manual' })
  const callback = authorizeResponse.headers.get('location')
  if (callback === null) throw new Error('no OIDC callback redirect')
  const callbackResponse = await fetch(callback, { redirect: 'manual' })
  const cookie = callbackResponse.headers.get('set-cookie')
  if (cookie === null) throw new Error('no session cookie')
  const cookieValue = cookie.split(';', 1)[0]!
  const me = await fetch(`${gateway.url}/v1/me`, { headers: { cookie: cookieValue } })
  const logout = await fetch(`${gateway.url}/auth/logout`, { headers: { cookie: cookieValue }, redirect: 'manual' })
  const endSession = logout.headers.get('location')
  const endSessionResponse = endSession === null ? undefined : await fetch(endSession, { redirect: 'manual' })
  const cleared = logout.headers.get('set-cookie') ?? ''
  const after = await fetch(`${gateway.url}/v1/me`, { headers: { cookie: cleared.split(';', 1)[0] ?? '' } })
  console.log(JSON.stringify({ start: start.status, authorize: authorizeResponse.status, callback: callbackResponse.status, me: me.status, meBody: await me.json(), logout: logout.status, endSession: endSessionResponse?.status, endSessionBody: endSessionResponse === undefined ? undefined : await endSessionResponse.text(), cleared: cleared.includes('Max-Age=0'), after: after.status }, null, 2))
} finally {
  await gateway.close()
  await control.close()
  await new Promise<void>(resolve => idp.close(() => resolve()))
  await new Promise<void>(resolve => dsh.close(() => resolve()))
  await rm(root, { recursive: true, force: true })
}

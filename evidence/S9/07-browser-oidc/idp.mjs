import { createServer } from 'node:http'
import { SignJWT } from '../../../apps/web-gateway/node_modules/jose/dist/webapi/index.js'
const issuer = 'http://127.0.0.1:19090'
const clientId = 'siriusx-web'
const clientSecret = 'browser-oidc-secret'
const codes = new Map()
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', issuer)
  if (url.pathname === '/.well-known/openid-configuration') {
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
      issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`,
    }))
    return
  }
  if (url.pathname === '/authorize') {
    const code = `browser-${Date.now()}`
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
    const idToken = await new SignJWT({ email: 'admin@acme.example', nonce })
      .setProtectedHeader({ alg: 'HS256' }).setIssuer(issuer).setAudience(clientId).setSubject('browser-oidc-user').setIssuedAt().setExpirationTime('5m')
      .sign(new TextEncoder().encode(clientSecret))
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id_token: idToken, token_type: 'Bearer' }))
    return
  }
  response.writeHead(404).end()
})
server.listen(19090, '127.0.0.1', () => console.log('idp ready'))

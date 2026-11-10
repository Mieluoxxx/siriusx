/** Tiny OIDC authorization-code + HS256 token endpoint for the S5 SSO probe. */
import { createHmac, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'

const port = Number(process.env.PORT ?? 18082)
const issuer = `http://127.0.0.1:${port}`
const clientId = process.env.CLIENT_ID ?? 'siriusx-desktop'
const secret = process.env.HS256_SECRET ?? 'test-secret'
const codes = new Map()

function b64(value) { return Buffer.from(JSON.stringify(value)).toString('base64url') }
function sign(input) { return createHmac('sha256', secret).update(input).digest('base64url') }
function token(nonce) {
  const header = b64({ alg: 'HS256', typ: 'JWT' })
  const now = Math.floor(Date.now() / 1000)
  const payload = b64({
    iss: issuer,
    aud: clientId,
    sub: 'user-42',
    email: 'user@acme.example',
    name: 'Acme User',
    tenant_id: 'tenant-acme',
    roles: ['member'],
    nonce,
    iat: now,
    exp: now + 300,
  })
  return `${header}.${payload}.${sign(`${header}.${payload}`)}`
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', issuer)
  if (request.method === 'GET' && url.pathname === '/oauth/authorize') {
    const state = url.searchParams.get('state') ?? ''
    const nonce = url.searchParams.get('nonce') ?? ''
    const redirect = url.searchParams.get('redirect_uri')
    if (redirect === null) { response.writeHead(400).end('redirect_uri required'); return }
    const code = randomUUID()
    codes.set(code, nonce)
    const target = new URL(redirect)
    target.searchParams.set('code', code)
    target.searchParams.set('state', state)
    response.writeHead(302, { location: target.href }).end()
    return
  }
  if (request.method === 'POST' && url.pathname === '/oauth/token') {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'))
    const code = form.get('code')
    const nonce = code === null ? undefined : codes.get(code)
    if (code === null || nonce === undefined) { response.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'invalid_grant' })); return }
    codes.delete(code)
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
      access_token: 'access-token-s5',
      token_type: 'Bearer',
      id_token: token(nonce),
    }))
    return
  }
  response.writeHead(404).end('not found')
})
server.listen(port, '127.0.0.1', () => console.log(JSON.stringify({ ready: true, issuer })))

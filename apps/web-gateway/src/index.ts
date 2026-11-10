/**
 * One origin for the Web app and the control-plane API:
 * - `/auth/*` sets/checks the HttpOnly SSO session cookie;
 * - `/v1/*` is proxied with the cookie converted to a Bearer header;
 * - everything else is proxied to the DSH Web Host, with the Host's own
 *   authority-bound cookie attached server-side.
 */
import { createHash, randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import httpProxy from 'http-proxy'
import { createRemoteJWKSet, jwtVerify } from 'jose'

export interface OidcOptions {
  readonly issuer: string
  readonly clientId: string
  readonly clientSecret: string
  readonly redirectUri: string
  readonly tenantId: string
  readonly role?: 'admin' | 'member'
  readonly scope?: string
  readonly idTokenAlg?: 'HS256' | 'RS256'
}

export interface WebGatewayOptions {
  readonly controlPlaneUrl: string
  readonly dshWebUrl: string
  readonly port?: number
  readonly host?: string
  readonly cookieName?: string
  readonly controlPlaneServiceToken?: string
  readonly oidc?: OidcOptions
}

interface OidcMetadata {
  readonly issuer: string
  readonly authorizationEndpoint: string
  readonly tokenEndpoint: string
  readonly jwksUri?: string
  readonly endSessionEndpoint?: string
}

interface PendingOidc {
  readonly verifier: string
  readonly nonce: string
  readonly createdAt: number
}

export interface WebGateway {
  readonly server: ReturnType<typeof createServer>
  readonly url: string
  readonly dshCookie: string
  close(): Promise<void>
}

function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {}
  for (const part of (header ?? '').split(';')) {
    const index = part.indexOf('=')
    if (index < 1) continue
    cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim())
  }
  return cookies
}

async function discoverOidc(options: OidcOptions): Promise<OidcMetadata> {
  const response = await fetch(`${options.issuer.replace(/\/$/u, '')}/.well-known/openid-configuration`)
  if (!response.ok) throw new Error(`OIDC discovery failed: HTTP ${response.status}`)
  const value = await response.json() as Record<string, unknown>
  if (typeof value.authorization_endpoint !== 'string' || typeof value.token_endpoint !== 'string') throw new Error('OIDC discovery is missing endpoints')
  return {
    issuer: typeof value.issuer === 'string' ? value.issuer : options.issuer,
    authorizationEndpoint: value.authorization_endpoint,
    tokenEndpoint: value.token_endpoint,
    ...(typeof value.jwks_uri === 'string' ? { jwksUri: value.jwks_uri } : {}),
    ...(typeof value.end_session_endpoint === 'string' ? { endSessionEndpoint: value.end_session_endpoint } : {}),
  }
}

async function exchangeDshCookie(dshWebUrl: string): Promise<string> {
  const response = await fetch(dshWebUrl, { redirect: 'manual' })
  const setCookies = response.headers.getSetCookie?.() ?? []
  const cookie = setCookies.find(value => value.includes('='))
  if (cookie === undefined) throw new Error('DSH Web Host did not issue a browser-session cookie')
  return cookie.split(';', 1)[0]!
}

async function accountFor(controlPlaneUrl: string, token: string): Promise<boolean> {
  try {
    const response = await fetch(`${controlPlaneUrl}/v1/me`, { headers: { authorization: `Bearer ${token}` } })
    return response.ok
  } catch {
    return false
  }
}

function json(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' })
  response.end(body)
}

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  const text = Buffer.concat(chunks).toString('utf8')
  if (text === '') return {}
  return JSON.parse(text) as Record<string, unknown>
}

export async function startWebGateway(options: WebGatewayOptions): Promise<WebGateway> {
  const cookieName = options.cookieName ?? 'siriusx_session'
  const controlPlaneUrl = options.controlPlaneUrl.replace(/\/$/u, '')
  const dshWebUrl = new URL(options.dshWebUrl)
  const dshCookie = await exchangeDshCookie(options.dshWebUrl)
  const proxy = httpProxy.createProxyServer({ target: dshWebUrl.origin, changeOrigin: true, ws: true })
  proxy.on('error', (_error, _request, response) => {
    if ('writeHead' in response && !response.headersSent) response.writeHead(502).end()
  })

  const oidc = options.oidc
  const oidcMetadata = oidc === undefined ? undefined : await discoverOidc(oidc)
  const pending = new Map<string, PendingOidc>()
  const jwks = oidcMetadata?.jwksUri === undefined ? undefined : createRemoteJWKSet(new URL(oidcMetadata.jwksUri))
  const oidcEnabled = oidc !== undefined && oidcMetadata !== undefined && options.controlPlaneServiceToken !== undefined

  const authenticated = async (request: IncomingMessage): Promise<string | undefined> => {
    const token = parseCookies(request.headers.cookie)[cookieName]
    if (token === undefined) return undefined
    return await accountFor(controlPlaneUrl, token) ? token : undefined
  }

  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`)
      const origin = request.headers.origin
      if (origin !== undefined && origin !== url.origin) {
        response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }).end('cross-origin request rejected')
        return
      }
      if (request.method === 'GET' && url.pathname === '/health') { json(response, 200, { ok: true, service: 'siriusx-web-gateway' }); return }
      if (request.method === 'GET' && url.pathname === '/auth/oidc/start' && oidcEnabled && oidc !== undefined && oidcMetadata !== undefined) {
        const state = randomBytes(24).toString('base64url')
        const verifier = randomBytes(48).toString('base64url')
        const nonce = randomBytes(24).toString('base64url')
        pending.set(state, { verifier, nonce, createdAt: Date.now() })
        const challenge = createHash('sha256').update(verifier).digest('base64url')
        const target = new URL(oidcMetadata.authorizationEndpoint)
        target.searchParams.set('response_type', 'code')
        target.searchParams.set('client_id', oidc.clientId)
        target.searchParams.set('redirect_uri', oidc.redirectUri)
        target.searchParams.set('scope', oidc.scope ?? 'openid email profile')
        target.searchParams.set('state', state)
        target.searchParams.set('nonce', nonce)
        target.searchParams.set('code_challenge', challenge)
        target.searchParams.set('code_challenge_method', 'S256')
        response.writeHead(302, { location: target.toString(), 'cache-control': 'no-store' }).end()
        return
      }
      if (request.method === 'GET' && url.pathname === '/auth/oidc/callback' && oidcEnabled && oidc !== undefined && oidcMetadata !== undefined) {
        const state = url.searchParams.get('state') ?? ''
        const code = url.searchParams.get('code')
        const requestState = pending.get(state)
        pending.delete(state)
        if (code === null || requestState === undefined || Date.now() - requestState.createdAt > 10 * 60 * 1000) { response.writeHead(400).end('invalid OIDC state'); return }
        const tokenResponse = await fetch(oidcMetadata.tokenEndpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: oidc.redirectUri, client_id: oidc.clientId, client_secret: oidc.clientSecret, code_verifier: requestState.verifier }),
        })
        if (!tokenResponse.ok) { response.writeHead(502).end('OIDC token exchange failed'); return }
        const tokenBody = await tokenResponse.json() as { id_token?: unknown }
        if (typeof tokenBody.id_token !== 'string') { response.writeHead(502).end('OIDC response has no id_token'); return }
        const alg = oidc.idTokenAlg ?? 'RS256'
        const key = alg === 'HS256' ? new TextEncoder().encode(oidc.clientSecret) : jwks
        if (key === undefined) { response.writeHead(500).end('OIDC JWKS is not configured'); return }
        const verified = await jwtVerify(tokenBody.id_token, key, { issuer: oidcMetadata.issuer, audience: oidc.clientId })
        if (verified.payload.nonce !== requestState.nonce) { response.writeHead(401).end('OIDC nonce mismatch'); return }
        const email = typeof verified.payload.email === 'string' ? verified.payload.email : typeof verified.payload.preferred_username === 'string' ? verified.payload.preferred_username : undefined
        if (email === undefined) { response.writeHead(401).end('OIDC identity has no email'); return }
        const session = await fetch(`${controlPlaneUrl}/v1/sso/session`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-siriusx-service-token': options.controlPlaneServiceToken! },
          body: JSON.stringify({ tenantId: oidc.tenantId, email, role: oidc.role ?? 'member' }),
        })
        if (!session.ok) { response.writeHead(401).end('control-plane SSO exchange failed'); return }
        const sessionBody = await session.json() as { token: string }
        response.writeHead(302, {
          'set-cookie': `${cookieName}=${encodeURIComponent(sessionBody.token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`,
          location: '/', 'cache-control': 'no-store',
        }).end()
        return
      }
      if (request.method === 'GET' && url.pathname === '/login') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY' })
        response.end(`<!doctype html><meta charset="utf-8"><title>SiriusX Login</title>
<script>try { localStorage.setItem('siriusx.gatewayAuth','1') } catch {}</script>
<form id="f"><input id="t" type="password" placeholder="control-plane session token" style="width:360px"><button>Sign in</button></form>
${oidcEnabled ? '<p><a href="/auth/oidc/start">Sign in with organization SSO</a></p>' : ''}
<script>
document.getElementById('f').onsubmit = async (event) => {
  event.preventDefault();
  const response = await fetch('/auth/session', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:document.getElementById('t').value})});
  if (!response.ok) { alert('Sign-in failed'); return }
  localStorage.setItem('siriusx.gatewayAuth','1');
  location.assign('/');
};
</script>`)
        return
      }
      if ((request.method === 'GET' || request.method === 'POST') && url.pathname === '/auth/logout') {
        let location = '/login'
        if (oidcEnabled && oidc !== undefined && oidcMetadata?.endSessionEndpoint !== undefined) {
          const endSession = new URL(oidcMetadata.endSessionEndpoint)
          endSession.searchParams.set('client_id', oidc.clientId)
          endSession.searchParams.set('post_logout_redirect_uri', `${new URL(oidc.redirectUri).origin}/login`)
          location = endSession.toString()
        }
        response.writeHead(302, {
          'set-cookie': `${cookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
          location, 'cache-control': 'no-store',
        }).end()
        return
      }
      if (request.method === 'POST' && url.pathname === '/auth/session') {
        const payload = await body(request)
        if (typeof payload.token !== 'string' || payload.token === '' || !(await accountFor(controlPlaneUrl, payload.token))) {
          json(response, 401, { error: 'invalid session' }); return
        }
        response.writeHead(204, {
          'set-cookie': `${cookieName}=${encodeURIComponent(payload.token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`,
          'cache-control': 'no-store',
        }).end()
        return
      }
      const token = await authenticated(request)
      if (token === undefined) {
        if (url.pathname.startsWith('/v1/')) json(response, 401, { error: 'authentication required' })
        else { response.writeHead(302, { location: '/login', 'cache-control': 'no-store' }).end() }
        return
      }
      if (url.pathname === '/auth/me') {
        const upstream = await fetch(`${controlPlaneUrl}/v1/me`, { headers: { authorization: `Bearer ${token}` } })
        json(response, upstream.status, await upstream.json())
        return
      }
      if (url.pathname.startsWith('/v1/')) {
        const chunks: Buffer[] = []
        for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        const upstream = await fetch(`${controlPlaneUrl}${url.pathname}${url.search}`, {
          method: request.method ?? 'GET',
          headers: {
            'content-type': request.headers['content-type'] ?? 'application/json',
            authorization: `Bearer ${token}`,
          },
          ...(request.method === 'GET' || request.method === 'HEAD' ? {} : { body: new Uint8Array(Buffer.concat(chunks)) }),
        })
        const headers: Record<string, string> = { 'content-type': upstream.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' }
        response.writeHead(upstream.status, headers)
        if (upstream.body === null) response.end()
        else { for await (const chunk of upstream.body) response.write(chunk); response.end() }
        return
      }
      request.headers.cookie = `${dshCookie}; ${request.headers.cookie ?? ''}`
      request.headers.host = dshWebUrl.host
      if (request.headers.origin !== undefined) request.headers.origin = dshWebUrl.origin
      proxy.web(request, response)
    })().catch(error => {
      if (!response.headersSent) json(response, 500, { error: error instanceof Error ? error.message : String(error) })
      else response.end()
    })
  })
  server.on('upgrade', (request, socket, head) => {
    void (async () => {
      const token = await authenticated(request)
      if (token === undefined) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return }
      request.headers.cookie = `${dshCookie}; ${request.headers.cookie ?? ''}`
      request.headers.host = dshWebUrl.host
      request.headers.origin = dshWebUrl.origin
      proxy.ws(request, socket, head)
    })().catch(() => socket.destroy())
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? 8080, options.host ?? '127.0.0.1', () => { resolve() })
  })
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : options.port ?? 8080
  return {
    server,
    url: `http://${options.host ?? '127.0.0.1'}:${port}`,
    dshCookie,
    close: async () => { proxy.close(); await new Promise<void>((resolve, reject) => server.close(error => { error === undefined ? resolve() : reject(error) })) },
  }
}

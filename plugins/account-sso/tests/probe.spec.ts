/**
 * Control-plane exchange and `/__siriusx/tenant` probe behavior:
 * - Surfaces control-plane error details and target URL when exchange fails.
 * - Awaits in-flight startup exchange instead of racing with the probe.
 * - Retries a failed exchange on probe refresh after the cooldown.
 * - Clears error state and cancels in-flight exchanges on signOut.
 * - Updates cached grant after OIDC callback so same-process profile reads work.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import type { AccountClientMetadata } from '@deepseek-ai/dsh-deepseek-account'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { SignJWT } from 'jose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SiriusXSsoAccount from '../src/index.ts'

const ISSUER = 'http://idp.test'
const CLIENT_ID = 'siriusx-desktop'
const HS256_SECRET = 'test-hs256-secret-that-is-long-enough-for-jose'
const CONTROL_PLANE_URL = 'http://control.test:4320'
const META = { clientKind: 'desktop' } as unknown as AccountClientMetadata

async function makeIdToken(nonce?: string): Promise<string> {
  const claims: Record<string, unknown> = {
    sub: 'user-1',
    email: 'alice@acme.test',
    tenant_id: 'tenant-acme',
    roles: ['admin'],
  }
  if (nonce !== undefined) claims.nonce = nonce
  return await new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience(CLIENT_ID)
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(HS256_SECRET))
}

function createHarness(initialGrant?: unknown) {
  let stored = initialGrant
  const routes = new Map<string, WebRoute['handler']>()
  const ctx = new Context()
  ctx.provide('credentials', {
    readRecord: async () => (stored === undefined ? undefined : { kind: 'grant', payload: stored }),
    modifyRecord: async (_key: unknown, fn: (cur: unknown) => Promise<unknown>) => {
      const next = await fn(stored === undefined ? undefined : { kind: 'grant', payload: stored }) as { payload: unknown }
      stored = next.payload
      return next
    },
    deleteRecord: async () => { stored = undefined },
  } as never)
  ctx.provide('webServer', {
    register: (route: WebRoute) => {
      routes.set(route.path, route.handler)
      return () => { routes.delete(route.path) }
    },
  } as never)
  const account = new SiriusXSsoAccount(ctx)

  const callRoute = async (path: string, url = path): Promise<{ status: number; body: string }> => {
    const handler = routes.get(path)
    if (handler === undefined) throw new Error(`missing route: ${path}`)
    let status = 200
    let body = ''
    const request = { method: 'GET', url, socket: { remoteAddress: '127.0.0.1' } } as unknown as IncomingMessage
    const response = {
      writeHead(code: number) { status = code; return this },
      end(chunk?: string) { if (chunk !== undefined) body += chunk; return this },
    } as unknown as ServerResponse
    await handler(request, response)
    return { status, body }
  }

  return { ctx, account, callRoute, getStored: () => stored }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const originalEnv = { ...process.env }

beforeEach(() => {
  process.env.SIRIUSX_SSO_ISSUER = ISSUER
  process.env.SIRIUSX_SSO_CLIENT_ID = CLIENT_ID
  process.env.SIRIUSX_SSO_HS256_SECRET = HS256_SECRET
  process.env.SIRIUSX_CONTROL_PLANE_URL = CONTROL_PLANE_URL
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key]
  }
  Object.assign(process.env, originalEnv)
})

describe('SiriusXSsoAccount probe and exchange lifecycle', () => {
  it('surfaces control-plane error details and URL when exchange returns 401', async () => {
    const idToken = await makeIdToken()
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      error: '"exp" claim timestamp check failed',
      code: 'SSO_TOKEN_INVALID',
    }, 401)))

    const { ctx, callRoute } = createHarness({
      version: 1,
      issuer: ISSUER,
      accessToken: 'at-1',
      idToken,
      claims: { sub: 'user-1', tenant_id: 'tenant-acme', roles: ['admin'], exp: Math.floor(Date.now() / 1000) + 300 },
    })
    try {
      const res = await callRoute('/__siriusx/tenant')
      expect(res.status).toBe(200)
      const payload = JSON.parse(res.body) as Record<string, unknown>
      expect(payload.authenticated).toBe(true)
      expect(payload.hasControlPlaneSession).toBe(false)
      expect(payload.controlPlaneUrl).toBe(CONTROL_PLANE_URL)
      expect(payload.controlPlaneError).toBe('control-plane SSO exchange failed: HTTP 401 (SSO_TOKEN_INVALID: "exp" claim timestamp check failed)')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('awaits in-flight startup exchange on /__siriusx/tenant instead of returning a transient failure', async () => {
    const idToken = await makeIdToken()
    let resolveExchange!: (res: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { resolveExchange = resolve })))

    const { ctx, account, callRoute } = createHarness({
      version: 1,
      issuer: ISSUER,
      accessToken: 'at-1',
      idToken,
      claims: { sub: 'user-1', tenant_id: 'tenant-acme', roles: ['admin'], exp: Math.floor(Date.now() / 1000) + 300 },
    })
    try {
      const statePromise = account.getState()
      const probePromise = callRoute('/__siriusx/tenant')
      await vi.waitFor(() => { expect(resolveExchange).toBeTypeOf('function') })
      resolveExchange(jsonResponse({
        token: 'cp-session-1',
        tenantId: 'tenant-acme',
        role: 'admin',
        model: { id: 'deepseek-flash', provider: 'claude', model: 'deepseek-flash' },
      }))
      await statePromise
      const res = await probePromise
      const payload = JSON.parse(res.body) as Record<string, unknown>
      expect(payload.hasControlPlaneSession).toBe(true)
      expect(payload.controlPlaneError).toBeNull()
      expect(payload.model).toEqual({ id: 'deepseek-flash', provider: 'claude', model: 'deepseek-flash' })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('retries failed exchange on probe refresh after cooldown', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-13T12:00:00Z'))
    const idToken = await makeIdToken()
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1
      if (calls === 1) return jsonResponse({ error: 'temporarily unavailable', code: 'UPSTREAM_DOWN' }, 503)
      return jsonResponse({
        token: 'cp-session-2',
        tenantId: 'tenant-acme',
        role: 'admin',
        model: { id: 'deepseek-flash', provider: 'claude', model: 'deepseek-flash' },
      })
    }))

    const { ctx, callRoute } = createHarness({
      version: 1,
      issuer: ISSUER,
      accessToken: 'at-1',
      idToken,
      claims: { sub: 'user-1', tenant_id: 'tenant-acme', roles: ['admin'], exp: Math.floor(Date.now() / 1000) + 300 },
    })
    try {
      const first = JSON.parse((await callRoute('/__siriusx/tenant')).body) as Record<string, unknown>
      expect(first.hasControlPlaneSession).toBe(false)
      expect(first.controlPlaneError).toContain('HTTP 503')

      // Within the 5-second cooldown, the probe does not hammer the control plane.
      const withinCooldown = JSON.parse((await callRoute('/__siriusx/tenant')).body) as Record<string, unknown>
      expect(withinCooldown.hasControlPlaneSession).toBe(false)
      expect(calls).toBe(1)

      vi.advanceTimersByTime(5000)
      const recovered = JSON.parse((await callRoute('/__siriusx/tenant')).body) as Record<string, unknown>
      expect(calls).toBe(2)
      expect(recovered.hasControlPlaneSession).toBe(true)
      expect(recovered.controlPlaneError).toBeNull()
      expect(recovered.model).toEqual({ id: 'deepseek-flash', provider: 'claude', model: 'deepseek-flash' })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('updates cached grant on OIDC sign-in and clears error state on signOut', async () => {
    const { ctx, account, callRoute } = createHarness(undefined)
    try {
      // Signed out initially: caches empty readRecord, then sign-in runs in the same process.
      expect((await account.getState()).status).toBe('signed-out')
      expect(await account.getProfile(META)).toBeNull()

      const view = await account.startSignIn(META, 'http://127.0.0.1:62892', 'desktop')
      const authorizeUrl = new URL(view.attempt?.phase === 'waiting-browser' ? (view.attempt.authorizeUrl ?? '') : '')
      const state = authorizeUrl.searchParams.get('state')!
      const nonce = authorizeUrl.searchParams.get('nonce')!
      const idToken = await makeIdToken(nonce)

      vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
        const url = String(input)
        if (url.endsWith('/oauth/token')) {
          return jsonResponse({ id_token: idToken, access_token: 'at-new', refresh_token: 'rt-new' })
        }
        return jsonResponse({ error: 'tenant suspended', code: 'TENANT_SUSPENDED' }, 403)
      }))

      const cb = await callRoute('/__siriusx/sso/callback', `/__siriusx/sso/callback?code=abc&state=${encodeURIComponent(state)}`)
      expect(cb.status).toBe(200)

      // Same-process profile and state reflect the newly signed-in grant immediately.
      expect((await account.getState()).status).toBe('credential-stored')
      expect(await account.getProfile(META)).toEqual({
        status: 'ready',
        value: { id: 'user-1', name: 'alice@acme.test', contact: 'alice@acme.test' },
      })

      const beforeSignOut = JSON.parse((await callRoute('/__siriusx/tenant')).body) as Record<string, unknown>
      expect(beforeSignOut.controlPlaneError).toContain('HTTP 403 (TENANT_SUSPENDED: tenant suspended)')

      let notifications = 0
      const tenantSvc = ctx.get('siriusxTenant') as { onChange: (fn: () => void) => () => void }
      const stopListening = tenantSvc.onChange(() => { notifications += 1 })

      await account.signOut(META)
      expect(notifications).toBe(1)
      stopListening()
      const afterSignOut = JSON.parse((await callRoute('/__siriusx/tenant')).body) as Record<string, unknown>
      expect(afterSignOut).toEqual({
        authenticated: false,
        tenantId: null,
        subjectId: null,
        role: [],
        model: null,
        controlPlaneUrl: null,
        hasControlPlaneSession: false,
        controlPlaneError: null,
      })
    } finally {
      await ctx.fiber.dispose()
    }
  })
})

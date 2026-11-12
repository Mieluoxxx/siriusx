/**
 * Enterprise OIDC provider for the DSH account seam, plus Host tenant context.
 *
 * This replaces `deepseek-account-platform`; the existing desktop welcome and
 * account controller consume the same service/RPC shape. It does not touch
 * `client-connection`'s loopback transport cookie.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import { credentialKey, type CredentialRecord } from '@deepseek-ai/dsh-credentials'
import {
  DeepSeekAccount,
  type AccountBonusBatch,
  type AccountBonusOrderId,
  type AccountClientMetadata,
  type AccountDetails,
  type AccountUserId,
  type AccountView,
  type PlatformSession,
  type SignInAttemptId,
  type SignInAttemptView,
} from '@deepseek-ai/dsh-deepseek-account'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { createRemoteJWKSet, jwtVerify } from 'jose'

const KEY = credentialKey('siriusx-account-sso', 'grant')
const ATTEMPT = 'siriusx-sso-attempt' as SignInAttemptId
const TENANT = process.env.SIRIUSX_SSO_TENANT_CLAIM ?? 'tenant_id'

interface SsoClaims {
  readonly sub: string
  readonly email?: string
  readonly name?: string
  readonly tenant_id?: string
  readonly org_id?: string
  readonly roles?: readonly string[]
  readonly [key: string]: unknown
}

interface StoredGrant {
  readonly version: 1
  readonly issuer: string
  readonly accessToken: string
  readonly idToken: string
  readonly claims: SsoClaims
  /**
   * Offline refresh credential. Absent for grants written before the scope
   * asked for `offline_access`, which is also why every reader tolerates it:
   * a grant without one keeps working until its access token expires, then
   * surfaces a re-sign-in instead of failing silently.
   */
  readonly refreshToken?: string
}

/**
 * Whether a stored grant's id_token is expired or close enough to it that the
 * next exchange would fail.
 *
 * The headroom keeps clock skew from producing a 401 the user cannot explain,
 * and keeps a healthy grant from being refreshed on every read.
 * @param expSeconds - `exp` claim in seconds; absent means it cannot be trusted.
 * @param nowMs - current wall-clock time in milliseconds.
 * @returns `true` when the credential should be refreshed before use.
 */
export function idTokenExpiring(expSeconds: number | undefined, nowMs: number): boolean {
  if (typeof expSeconds !== 'number') return true
  return expSeconds * 1000 - nowMs < 60_000
}

interface ControlPlaneModel {
  readonly id: string
  readonly provider: string
  readonly model: string
}

interface ControlPlaneSession {
  readonly baseUrl: string
  readonly token: string
  readonly tenantId: string
  readonly role: 'admin' | 'member'
  readonly model: ControlPlaneModel | null
  readonly modelGatewayUrl?: string
}

interface AttemptState {
  readonly state: string
  readonly nonce: string
  readonly verifier: string
  readonly callbackOrigin: string
  readonly callbackUri: string
}

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}

function s256(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

function env(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') throw new Error(`siriusx-account-sso: ${name} is required`)
  return value
}

function tenantOf(claims: SsoClaims): string | undefined {
  const value = claims[TENANT] ?? claims.tenant_id ?? claims.org_id
  return typeof value === 'string' && value !== '' ? value : undefined
}

export class SiriusXTenantContext extends Service {
  tenantId: string | undefined
  subjectId: string | undefined
  roles: readonly string[] = []
  controlPlaneUrl: string | undefined
  controlPlaneToken: string | undefined
  model: ControlPlaneModel | null = null
  authenticated = false

  constructor(ctx: Context) {
    super(ctx, 'siriusxTenant')
  }

  update(claims: SsoClaims): void {
    this.tenantId = tenantOf(claims)
    this.subjectId = claims.sub
    this.roles = claims.roles ?? []
    this.authenticated = this.tenantId !== undefined
  }

  clear(): void {
    this.tenantId = undefined
    this.subjectId = undefined
    this.roles = []
    this.controlPlaneUrl = undefined
    this.controlPlaneToken = undefined
    this.model = null
    this.authenticated = false
  }
}

async function verifyIdToken(idToken: string): Promise<SsoClaims> {
  const issuer = env('SIRIUSX_SSO_ISSUER')
  const audience = env('SIRIUSX_SSO_CLIENT_ID')
  const hs256 = process.env.SIRIUSX_SSO_HS256_SECRET
  const jwksUri = process.env.SIRIUSX_SSO_JWKS_URI
  if (hs256 !== undefined && hs256 !== '') {
    const { payload } = await jwtVerify(idToken, new TextEncoder().encode(hs256), { issuer, audience })
    return payload as unknown as SsoClaims
  }
  if (jwksUri !== undefined && jwksUri !== '') {
    const { payload } = await jwtVerify(idToken, createRemoteJWKSet(new URL(jwksUri)), { issuer, audience })
    return payload as unknown as SsoClaims
  }
  throw new Error('siriusx-account-sso: set SIRIUSX_SSO_JWKS_URI (or HS256 test secret); refusing unverified id_token')
}

export default class SiriusXSsoAccount extends DeepSeekAccount {
  static inject = ['credentials', 'webServer']

  private state: AccountView = {
    status: 'signed-out',
    links: { usageUrl: process.env.SIRIUSX_SSO_USAGE_URL ?? 'https://siriusx.invalid/usage', topUpUrl: process.env.SIRIUSX_SSO_TOPUP_URL ?? 'https://siriusx.invalid/top-up' },
    attempt: null,
  }
  private readonly tenant: SiriusXTenantContext
  private readonly watchers = new Set<(view: AccountView) => void>()
  private attempt: AttemptState | undefined
  private controlSession: ControlPlaneSession | undefined
  /**
   * Why the last control-plane exchange failed, when it did. Exposed through
   * the loopback probes so a signed-in-but-useless desktop is diagnosable
   * instead of merely empty.
   */
  private controlSessionError: string | undefined
  private loaded: Promise<StoredGrant | undefined> | undefined

  constructor(ctx: Context) {
    super(ctx)
    this.tenant = new SiriusXTenantContext(ctx)
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: process.env.SIRIUSX_SSO_REDIRECT_PATH ?? '/__siriusx/sso/callback',
      handler: async (request, response) => {
        if (request.method !== 'GET') { response.writeHead(405).end(); return }
        try {
          const url = new URL(request.url ?? '/', 'http://siriusx.invalid')
          const code = url.searchParams.get('code')
          const state = url.searchParams.get('state')
          if (code === null || state === null || this.attempt === undefined || state !== this.attempt.state) {
            throw new Error('invalid OIDC callback state')
          }
          const attempt = this.attempt
          this.attempt = undefined
          const issuer = env('SIRIUSX_SSO_ISSUER')
          const tokenUrl = new URL(process.env.SIRIUSX_SSO_TOKEN_PATH ?? '/oauth/token', issuer)
          const body = new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: attempt.callbackUri,
            client_id: env('SIRIUSX_SSO_CLIENT_ID'),
            code_verifier: attempt.verifier,
          })
          const tokenResponse = await fetch(tokenUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body,
          })
          if (!tokenResponse.ok) throw new Error(`OIDC token exchange failed: HTTP ${tokenResponse.status}`)
          const token = await tokenResponse.json() as { id_token?: unknown; access_token?: unknown; refresh_token?: unknown }
          if (typeof token.id_token !== 'string' || typeof token.access_token !== 'string') throw new Error('OIDC token response lacks id_token/access_token')
          const claims = await verifyIdToken(token.id_token)
          if (claims.nonce !== attempt.nonce) throw new Error('OIDC nonce mismatch')
          if (tenantOf(claims) === undefined) throw new Error(`OIDC token has no ${TENANT} claim`)
          const grant: StoredGrant = {
            version: 1, issuer, accessToken: token.access_token, idToken: token.id_token, claims,
            // A realm that does not grant `offline_access` stays usable until
            // this token expires; the refresh path then reports re-sign-in.
            ...(typeof token.refresh_token === 'string' && token.refresh_token !== '' ? { refreshToken: token.refresh_token } : {}),
          }
          await this.ctx.credentials.modifyRecord(KEY, async () => ({ kind: 'grant', payload: grant }))
          this.tenant.update(claims)
          await this.exchangeControlPlane(grant)
          this.setState({
            status: 'credential-stored',
            links: this.state.links,
            attempt: { id: ATTEMPT, phase: 'succeeded' },
          })
          response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
            .end('<!doctype html><meta charset="utf-8"><title>Signed in</title><p>Signed in. You can close this tab.</p>')
        } catch (error) {
          this.setState({
            status: this.state.status,
            links: this.state.links,
            attempt: { id: ATTEMPT, phase: 'failed', errorCode: 'protocol' },
          })
          response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
            .end(error instanceof Error ? error.message : String(error))
        }
      },
    }), 'siriusx-account-sso: callback')
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: '/__siriusx/tenant',
      handler: (request, response) => {
        const remote = request.socket.remoteAddress
        if (remote !== '127.0.0.1' && remote !== '::1' && remote !== '::ffff:127.0.0.1') {
          response.writeHead(403).end()
          return
        }
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        response.end(JSON.stringify({
          authenticated: this.tenant.authenticated,
          tenantId: this.tenant.tenantId ?? null,
          subjectId: this.tenant.subjectId ?? null,
          role: this.tenant.roles,
          model: this.tenant.model,
          controlPlaneUrl: this.tenant.controlPlaneUrl ?? null,
          hasControlPlaneSession: this.controlSession !== undefined,
          controlPlaneError: this.controlSessionError ?? null,
        }))
      },
    }), 'siriusx-account-sso: tenant probe')
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: '/__siriusx/control-plane',
      handler: (request, response) => {
        const remote = request.socket.remoteAddress
        if (remote !== '127.0.0.1' && remote !== '::1' && remote !== '::ffff:127.0.0.1') { response.writeHead(403).end(); return }
        const session = this.controlSession
        response.writeHead(session === undefined ? 404 : 200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        response.end(JSON.stringify(session === undefined ? {
          error: 'control-plane session unavailable',
          ...(this.controlSessionError === undefined ? {} : { detail: this.controlSessionError }),
        } : {
          baseUrl: session.baseUrl, token: session.token, tenantId: session.tenantId, role: session.role,
          model: session.model, ...(session.modelGatewayUrl === undefined ? {} : { modelGatewayUrl: session.modelGatewayUrl }),
        }))
      },
    }), 'siriusx-account-sso: control-plane session')
  }

  private async exchangeControlPlane(grant: StoredGrant): Promise<void> {
    const baseUrl = process.env.SIRIUSX_CONTROL_PLANE_URL?.trim()
    if (baseUrl === undefined || baseUrl === '') return
    const endpoint = baseUrl.replace(/\/$/u, '')
    try {
      let active = grant
      let response = await this.postExchange(endpoint, active)
      // An id_token lives far shorter than a control-plane session. Retrying
      // once through the offline refresh credential is what makes a sign-in
      // outlive the id_token instead of dying with it.
      if (response.status === 401) {
        const refreshed = await this.refreshGrant(active)
        if (refreshed !== undefined) {
          active = refreshed
          response = await this.postExchange(endpoint, active)
        }
      }
      if (!response.ok) throw new Error(`control-plane SSO exchange failed: HTTP ${response.status}`)
      const body = await response.json() as { token?: unknown; tenantId?: unknown; role?: unknown; model?: unknown; modelGatewayUrl?: unknown }
      if (typeof body.token !== 'string' || typeof body.tenantId !== 'string' || (body.role !== 'admin' && body.role !== 'member')) throw new Error('control-plane SSO exchange returned an invalid session')
      const model = typeof body.model === 'object' && body.model !== null && typeof (body.model as Record<string, unknown>).id === 'string' && typeof (body.model as Record<string, unknown>).provider === 'string' && typeof (body.model as Record<string, unknown>).model === 'string'
        ? { id: (body.model as Record<string, unknown>).id as string, provider: (body.model as Record<string, unknown>).provider as string, model: (body.model as Record<string, unknown>).model as string }
        : null
      this.controlSession = {
        baseUrl: endpoint, token: body.token, tenantId: body.tenantId, role: body.role,
        model, ...(typeof body.modelGatewayUrl === 'string' ? { modelGatewayUrl: body.modelGatewayUrl } : {}),
      }
      this.tenant.controlPlaneUrl = this.controlSession.baseUrl
      this.tenant.controlPlaneToken = this.controlSession.token
      this.tenant.model = model
      this.controlSessionError = undefined
    } catch (error) {
      // Record why the session is missing. This used to be swallowed entirely,
      // which is how a desktop could report "signed in" while every tenant
      // feature stayed empty.
      this.controlSessionError = error instanceof Error ? error.message : String(error)
      console.warn(`siriusx-account-sso: control-plane session unavailable (${this.controlSessionError})`)
      if (process.env.SIRIUSX_CONTROL_PLANE_REQUIRED === '1') throw error
    }
  }

  private async postExchange(endpoint: string, grant: StoredGrant): Promise<Response> {
    return await fetch(`${endpoint}/v1/sso/desktop/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idToken: grant.idToken }),
    })
  }

  /**
   * Trade the stored refresh credential for a fresh grant.
   *
   * Failure is reported by return value, not thrown: every caller has a
   * working fallback (the current access token, or a re-sign-in prompt), and
   * none of them is improved by propagating this.
   * @param grant - grant carrying the refresh credential.
   * @returns the persisted new grant, or `undefined` when refresh is impossible.
   */
  private async refreshGrant(grant: StoredGrant): Promise<StoredGrant | undefined> {
    if (grant.refreshToken === undefined || grant.refreshToken === '') return undefined
    try {
      const tokenUrl = new URL(process.env.SIRIUSX_SSO_TOKEN_PATH ?? '/oauth/token', grant.issuer)
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: grant.refreshToken,
          client_id: env('SIRIUSX_SSO_CLIENT_ID'),
        }),
      })
      if (!response.ok) throw new Error(`refresh failed: HTTP ${response.status}`)
      const token = await response.json() as { id_token?: unknown; access_token?: unknown; refresh_token?: unknown }
      if (typeof token.id_token !== 'string' || typeof token.access_token !== 'string') throw new Error('refresh response lacks id_token/access_token')
      // A refresh response carries no nonce, so only issuer/audience/expiry are
      // verified here; the nonce binding was established at sign-in.
      const claims = await verifyIdToken(token.id_token)
      if (tenantOf(claims) === undefined) throw new Error(`refreshed token has no ${TENANT} claim`)
      const next: StoredGrant = {
        version: 1, issuer: grant.issuer, accessToken: token.access_token, idToken: token.id_token, claims,
        refreshToken: typeof token.refresh_token === 'string' && token.refresh_token !== '' ? token.refresh_token : grant.refreshToken,
      }
      await this.ctx.credentials.modifyRecord(KEY, async () => ({ kind: 'grant', payload: next }))
      this.tenant.update(claims)
      return next
    } catch (error) {
      console.warn(`siriusx-account-sso: token refresh failed (${error instanceof Error ? error.message : String(error)}); sign in again`)
      return undefined
    }
  }

  private setState(view: AccountView): void {
    this.state = view
    for (const watcher of this.watchers) watcher(view)
  }

  private async grant(): Promise<StoredGrant | undefined> {
    this.loaded ??= this.ctx.credentials.readRecord(KEY).then(async record => {
      if (record === undefined) return undefined
      if (record.kind !== 'grant') throw new Error('siriusx-account-sso: credential record is not a grant')
      let grant = record.payload as unknown as StoredGrant
      if (grant.version !== 1) throw new Error('siriusx-account-sso: unsupported grant')
      this.tenant.update(grant.claims)
      // A stored id_token outlives its own validity across restarts, so the
      // exchange below would fail on its first attempt every time. Refresh
      // first when the credential is already past (or near) expiry.
      const exp = grant.claims.exp
      if (idTokenExpiring(typeof exp === 'number' ? exp : undefined, Date.now())) {
        grant = await this.refreshGrant(grant) ?? grant
      }
      if (this.controlSession === undefined) void this.exchangeControlPlane(grant)
      return grant
    })
    return this.loaded
  }



  async getState(): Promise<AccountView> {
    const grant = await this.grant()
    return grant === undefined ? this.state : {
      status: 'credential-stored',
      links: this.state.links,
      attempt: this.state.attempt,
    }
  }

  async getProfile(_client: AccountClientMetadata): Promise<AccountDetails['profile'] | null> {
    const grant = await this.grant()
    if (grant === undefined) return null
    return {
      status: 'ready',
      value: {
        id: grant.claims.sub as AccountUserId,
        name: grant.claims.name ?? grant.claims.email ?? null,
        contact: grant.claims.email ?? null,
      },
    }
  }

  async getBalance(_client: AccountClientMetadata): Promise<AccountDetails['balance'] | null> { return null }
  async getUnnotifiedBonuses(_client: AccountClientMetadata): Promise<AccountBonusBatch | null> { return null }
  async ackBonusNotified(_accountId: AccountUserId, _orderId: AccountBonusOrderId, _client: AccountClientMetadata): Promise<boolean> { return false }

  async startSignIn(_client: AccountClientMetadata, callbackOrigin: string, _loginSource: 'web' | 'desktop'): Promise<AccountView> {
    const issuer = env('SIRIUSX_SSO_ISSUER')
    const clientId = env('SIRIUSX_SSO_CLIENT_ID')
    const redirectPath = process.env.SIRIUSX_SSO_REDIRECT_PATH ?? '/__siriusx/sso/callback'
    const callbackUri = new URL(redirectPath, callbackOrigin).href
    const state = randomBytes(24).toString('base64url')
    const nonce = randomBytes(24).toString('base64url')
    const verifier = randomBytes(48).toString('base64url')
    this.attempt = { state, nonce, verifier, callbackOrigin, callbackUri }
    const authorize = new URL(process.env.SIRIUSX_SSO_AUTHORIZE_PATH ?? '/oauth/authorize', issuer)
    authorize.search = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: callbackUri,
      // `offline_access` is what makes the issuer hand back a refresh token, and
      // the control-plane session is refreshed from it: without this scope every
      // exchange more than one id_token lifetime after sign-in fails.
      scope: process.env.SIRIUSX_SSO_SCOPE ?? 'openid profile email offline_access',
      state,
      nonce,
      code_challenge: s256(verifier),
      code_challenge_method: 'S256',
    }).toString()
    this.setState({
      status: 'signed-out',
      links: this.state.links,
      attempt: { id: ATTEMPT, phase: 'waiting-browser', authorizeUrl: authorize.href, expiresAt: Date.now() + 10 * 60 * 1000 },
    })
    return this.state
  }

  async cancelSignIn(_id: SignInAttemptId): Promise<AccountView> {
    this.attempt = undefined
    this.setState({ status: 'signed-out', links: this.state.links, attempt: null })
    return this.state
  }

  async signOut(_client: AccountClientMetadata): Promise<AccountView> {
    this.loaded = undefined
    this.attempt = undefined
    this.tenant.clear()
    this.controlSession = undefined
    await this.ctx.credentials.deleteRecord(KEY)
    this.setState({ status: 'signed-out', links: this.state.links, attempt: null })
    return this.state
  }

  async *watch(signal: AbortSignal): AsyncIterable<AccountView> {
    await this.grant()
    let wake: (() => void) | undefined
    let closed = false
    const watcher = (view: AccountView): void => { this.state = view; wake?.() }
    this.watchers.add(watcher)
    signal.addEventListener('abort', () => { closed = true; wake?.() }, { once: true })
    try {
      while (!closed) {
        yield await this.getState()
        await new Promise<void>(resolve => { wake = resolve })
        wake = undefined
      }
    } finally {
      this.watchers.delete(watcher)
    }
  }

  async resolveToken(url: string): Promise<string | undefined> {
    const allowed = process.env.SIRIUSX_MODEL_GATEWAY_URL
    if (allowed === undefined || allowed === '' || new URL(url).origin !== new URL(allowed).origin) return undefined
    return (await this.grant())?.accessToken
  }

  async rejectToken(_token: string): Promise<void> {}

  async getPlatformSession(): Promise<PlatformSession | null> { return null }

  async getDeviceIdentity(): Promise<{ deviceId?: string; userId?: AccountUserId; osVersion: string }> {
    const grant = await this.grant()
    return {
      ...(grant === undefined ? {} : { userId: grant.claims.sub as AccountUserId }),
      osVersion: `${process.platform} ${process.arch}`,
    }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    siriusxTenant: SiriusXTenantContext
  }
}

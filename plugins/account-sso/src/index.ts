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
          const token = await tokenResponse.json() as { id_token?: unknown; access_token?: unknown }
          if (typeof token.id_token !== 'string' || typeof token.access_token !== 'string') throw new Error('OIDC token response lacks id_token/access_token')
          const claims = await verifyIdToken(token.id_token)
          if (claims.nonce !== attempt.nonce) throw new Error('OIDC nonce mismatch')
          if (tenantOf(claims) === undefined) throw new Error(`OIDC token has no ${TENANT} claim`)
          const grant: StoredGrant = { version: 1, issuer, accessToken: token.access_token, idToken: token.id_token, claims }
          await this.ctx.credentials.modifyRecord(KEY, async () => ({ kind: 'grant', payload: grant }))
          this.tenant.update(claims)
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
          roles: this.tenant.roles,
        }))
      },
    }), 'siriusx-account-sso: tenant probe')
  }

  private setState(view: AccountView): void {
    this.state = view
    for (const watcher of this.watchers) watcher(view)
  }

  private async grant(): Promise<StoredGrant | undefined> {
    this.loaded ??= this.ctx.credentials.readRecord(KEY).then(record => {
      if (record === undefined) return undefined
      if (record.kind !== 'grant') throw new Error('siriusx-account-sso: credential record is not a grant')
      const grant = record.payload as unknown as StoredGrant
      if (grant.version !== 1) throw new Error('siriusx-account-sso: unsupported grant')
      this.tenant.update(grant.claims)
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
      scope: process.env.SIRIUSX_SSO_SCOPE ?? 'openid profile email',
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

/**
 * S0 spike: replace the upstream `deepseek-account` Cordis row with a fake
 * enterprise SSO provider, and expose a process-wide tenant context service.
 *
 * This is deliberately not a production identity provider. It proves two
 * seams:
 *  - `deepseekAccount` is replaceable by a Host plugin (the welcome/login UI
 *    consumes it through `account-controller`);
 *  - a Host plugin can publish the tenant/subject context derived at sign-in
 *    to other Host extensions (the Executor) without changing `client-connection`.
 */
import { Context, Service } from '@deepseek-ai/cordis'
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
} from '@deepseek-ai/dsh-deepseek-account'
import type {} from '@deepseek-ai/dsh-host-webserver'

const TENANT = process.env.SIRIUSX_TENANT_ID ?? 'tenant-spike'
const SUBJECT = process.env.SIRIUSX_SUBJECT_ID ?? 'subject-spike'

const idleView: AccountView = {
  status: 'signed-out',
  links: {
    usageUrl: 'https://siriusx.example/usage',
    topUpUrl: 'https://siriusx.example/top-up',
  },
  attempt: null,
}

/** Process-wide tenant context consumed by enterprise Host extensions. */
export class SiriusXTenantContext extends Service {
  tenantId = TENANT
  subjectId = SUBJECT
  readonly source = 'sso-spike'

  constructor(ctx: Context) {
    super(ctx, 'siriusxTenant')
  }

  update(tenantId: string, subjectId: string): void {
    this.tenantId = tenantId
    this.subjectId = subjectId
  }
}

/** Minimal replacement for `@deepseek-ai/dsh-deepseek-account-platform`. */
export default class SiriusXSsoAccount extends DeepSeekAccount {
  static inject = ['webServer']

  private state: AccountView = idleView
  private readonly watchers = new Set<(view: AccountView) => void>()
  private readonly tenant: SiriusXTenantContext

  constructor(ctx: Context) {
    super(ctx)
    this.tenant = new SiriusXTenantContext(ctx)
    // The service is constructed eagerly so route callbacks and other Host
    // extensions can read the current tenant during the same activation.
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: '/__siriusx/tenant',
      handler: (request, response) => {
        if (request.method !== 'GET') {
          response.writeHead(405).end()
          return
        }
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        response.end(JSON.stringify({
          tenantId: this.tenant.tenantId,
          subjectId: this.tenant.subjectId,
          source: this.tenant.source,
        }))
      },
    }), 'siriusx-sso-spike: tenant probe route')

    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: '/__siriusx/sso/callback',
      handler: (request, response) => {
        const url = new URL(request.url ?? '/', 'http://siriusx.invalid')
        if (request.method !== 'GET' || url.searchParams.get('state') !== 'sso-spike-attempt') {
          response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('bad SSO callback')
          return
        }
        this.tenant.update(url.searchParams.get('tenant') ?? 'tenant-from-sso',
          url.searchParams.get('subject') ?? 'subject-from-sso')
        this.setState({
          status: 'credential-stored',
          links: idleView.links,
          attempt: { id: 'sso-spike-attempt' as SignInAttemptId, phase: 'succeeded' },
        })
        response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }).end('signed in')
      },
    }), 'siriusx-sso-spike: SSO callback route')
  }

  private setState(view: AccountView): void {
    this.state = view
    for (const watcher of this.watchers) watcher(view)
  }

  async getState(): Promise<AccountView> {
    return this.state
  }

  async getProfile(_client: AccountClientMetadata): Promise<AccountDetails['profile'] | null> {
    return {
      status: 'ready',
      value: { id: SUBJECT as AccountUserId, name: 'SSO Spike User', contact: null },
    }
  }

  async getBalance(_client: AccountClientMetadata): Promise<AccountDetails['balance'] | null> {
    return { status: 'ready', value: [], bonusWallets: [] }
  }

  async getUnnotifiedBonuses(_client: AccountClientMetadata): Promise<AccountBonusBatch | null> {
    return null
  }

  async ackBonusNotified(_accountId: AccountUserId, _orderId: AccountBonusOrderId, _client: AccountClientMetadata): Promise<boolean> {
    return false
  }

  async startSignIn(_client: AccountClientMetadata, callbackOrigin: string, _loginSource: 'web' | 'desktop'): Promise<AccountView> {
    const callback = new URL('/__siriusx/sso/callback?state=sso-spike-attempt', callbackOrigin)
    this.setState({
      ...idleView,
      attempt: {
        id: 'sso-spike-attempt' as SignInAttemptId,
        phase: 'waiting-browser',
        authorizeUrl: callback.href,
      },
    })
    return this.state
  }

  async cancelSignIn(_id: SignInAttemptId): Promise<AccountView> {
    this.setState(idleView)
    return this.state
  }

  async signOut(_client: AccountClientMetadata): Promise<AccountView> {
    this.setState(idleView)
    return this.state
  }

  async *watch(signal: AbortSignal): AsyncIterable<AccountView> {
    let wake: (() => void) | undefined
    let closed = false
    const watcher = (view: AccountView): void => {
      this.state = view
      wake?.()
    }
    this.watchers.add(watcher)
    signal.addEventListener('abort', () => { closed = true; wake?.() }, { once: true })
    try {
      while (!closed) {
        yield this.state
        await new Promise<void>((resolve) => { wake = resolve })
        wake = undefined
      }
    } finally {
      this.watchers.delete(watcher)
    }
  }

  async resolveToken(_url: string): Promise<string | undefined> {
    return undefined
  }

  async rejectToken(_token: string): Promise<void> {}

  async getPlatformSession(): Promise<PlatformSession | null> {
    return null
  }

  async getDeviceIdentity(): Promise<{ deviceId?: string; userId?: AccountUserId; osVersion: string }> {
    return { userId: SUBJECT as AccountUserId, osVersion: 'linux-spike' }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    siriusxTenant: SiriusXTenantContext
  }
}

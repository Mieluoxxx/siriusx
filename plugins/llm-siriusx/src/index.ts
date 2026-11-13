/**
 * The `siriusx` LLM route: Messages protocol through the tenant Model Gateway.
 *
 * The Gateway speaks Anthropic Messages, so the whole Messages transport is
 * reused from `@deepseek-ai/dsh-llm-deepseek`; only two things differ from the
 * official routes:
 *
 * - the endpoint is the tenant Model Gateway, which the enterprise config
 *   names, not the public API; and
 * - the credential is the short-lived **control-plane session token** that
 *   `@siriusx/dsh-account-sso` already holds, not a Keycloak access token. The
 *   Gateway verifies the control-plane HMAC session, so a Keycloak token is
 *   rejected there with `UNAUTHORIZED`.
 *
 * Requests are authenticated per call, never from ambient state: the account
 * provider is the single owner of the session and refreshes it, so this route
 * only reads what that provider currently exposes.
 */
import type { Context } from '@deepseek-ai/cordis'
import { LlmError } from '@deepseek-ai/dsh-llm'
import type { LlmModelInfo } from '@deepseek-ai/dsh-llm'
import {
  catalogModelInfo,
  registerDeepSeekProvider,
  resolveAdapterOptions,
} from '@deepseek-ai/dsh-llm-deepseek'
import type { DeepSeekCatalogModel, DeepSeekConnectionOptions } from '@deepseek-ai/dsh-llm-deepseek'

export const name = 'llm-siriusx'
export const inject = ['llm', 'siriusxTenant']

/** The route key `enterpriseModelProvider` names in `enterprise.json`. */
export const PROVIDER = 'siriusx'

/** Console tag of route diagnostics; product profiles mount no console exporter for `ctx.logger`. */
const LOG_TAG = '[llm-siriusx]'

/** No credential reaches the Gateway, so there is nothing to configure per route. */
export type Options = Record<string, never>

/**
 * The tenant facts this route reads from the account provider. Structurally
 * typed rather than imported so this package stays buildable against a Host
 * that has not loaded `@siriusx/dsh-account-sso`.
 */
interface TenantRoute {
  /** Control-plane bearer token for this tenant; `undefined` before the SSO exchange succeeds. */
  readonly controlPlaneToken?: string | undefined
  /** Resolved Model Gateway origin the enterprise config named. */
  readonly modelGatewayUrl?: string | undefined
  /** Tenant binding the Gateway enforces on every request. */
  readonly tenantId?: string | undefined
}

export function gatewayOf(env: NodeJS.ProcessEnv): string | undefined {
  const configured = env.SIRIUSX_MODEL_GATEWAY_URL?.trim()
  return configured === undefined || configured === '' ? undefined : configured
}

/**
 * Describe one catalog entry the Gateway advertises. The Gateway reports the
 * tenant's bound models; they are all text-and-image capable to this route
 * because the Gateway, not this client, owns the upstream's real capability.
 * @param provider - registered route id.
 * @param model - model id bound to the tenant.
 * @returns selector metadata.
 */
export function listedModel(provider: string, model: string): LlmModelInfo {
  return { provider, id: model, name: model, inputModalities: ['text', 'image'] }
}

export function catalogOf(modelIds: readonly string[]): DeepSeekCatalogModel[] {
  return modelIds.map(id => ({ id, name: id, inputModalities: ['text', 'image'] }))
}

export function apply(ctx: Context): void {
  const tenant = (): TenantRoute => (ctx.get('siriusxTenant') ?? {}) as TenantRoute

  /**
   * The Model Gateway origin for this process. An enterprise build always has
   * it; a developer build without enterprise mode must not silently talk to a
   * public endpoint, so the route reports the missing fact instead.
   */
  const baseURL = (): string => {
    const configured = gatewayOf(process.env)
    if (configured === undefined) {
      throw new LlmError(
        `llm-siriusx: route "${PROVIDER}" has no Model Gateway; set SIRIUSX_MODEL_GATEWAY_URL`
        + ' in enterprise.json or the launch environment',
        'MISSING_ENDPOINT',
      )
    }
    return configured
  }

  /**
   * The control-plane session token the Gateway verifies. This is deliberately
   * a hard failure rather than a fallback: sending a Keycloak token would be
   * rejected upstream with a less actionable `UNAUTHORIZED`.
   */
  const sessionToken = (): string => {
    const facts = tenant()
    const token = facts.controlPlaneToken
    if (token === undefined || token === '') {
      throw new LlmError(
        `llm-siriusx: route "${PROVIDER}" has no control-plane session for tenant`
        + ` "${facts.tenantId ?? 'unknown'}"; sign in again so the enterprise SSO exchange can mint one`
        + ' (POST /v1/sso/desktop/exchange)',
        'NO_CONTROL_PLANE_SESSION',
      )
    }
    return token
  }

  /**
   * Current connection facts. The model catalog is resolved per operation from
   * the tenant's own binding, so a server-side model change needs no restart:
   * the Gateway decides which ids exist, and this client never invents one.
   */
  const options = (): DeepSeekConnectionOptions => {
    const configured = resolveAdapterOptions({ baseURL: baseURL() })
    const modelIds = (tenant() as { model?: { id?: string } }).model?.id
    if (modelIds === undefined || modelIds === '') return configured
    return { ...configured, models: catalogOf([modelIds]) }
  }

  // Validate the endpoint once at load so a misconfigured enterprise build
  // fails at composition instead of on the first prompt.
  options()

  ctx.llm.registerConfigurableProviders([
    {
      provider: PROVIDER,
      displayName: 'SiriusX',
      // This route has no user-editable settings, so the plugin name is the
      // whole namespace; `settingsPath: []` registers no editable fields.
      settingsNs: name,
      settingsPath: [],
    },
  ])

  const tenantService = ctx.get('siriusxTenant') as { onChange?: (listener: () => void) => () => void } | undefined
  if (tenantService?.onChange !== undefined) {
    ctx.effect(() => tenantService.onChange!(() => {
      ctx.emit('llm/models-updated', PROVIDER)
    }), 'llm-siriusx: tenant-models-sync')
  }

  registerDeepSeekProvider(ctx, PROVIDER, {
    providerName: 'SiriusX',
    options,
    resolveAuth: async () => ({ headers: { authorization: `Bearer ${sessionToken()}` } }),
    /**
     * The Gateway's `/v1/models` is a tenant-scoped listing of bound models.
     * Advertising them lets the model picker show the real tenant catalog
     * rather than a single hard-coded default.
     */
    discoverModels: async () => {
      const ids = await boundModelIds()
      if (ids !== undefined) return ids.map(id => listedModel(PROVIDER, id))
      const facts = tenant() as { controlPlaneToken?: string; model?: { id?: string } | null }
      if (facts.controlPlaneToken !== undefined && facts.controlPlaneToken !== '') {
        const fallbackId = facts.model?.id
        if (fallbackId !== undefined && fallbackId !== '') return [listedModel(PROVIDER, fallbackId)]
      }
      return []
    },
  })

  /**
   * Read the tenant's bound model ids from the Gateway.
   *
   * A failure here degrades discovery only: the picker falls back to the
   * tenant default the SSO exchange already delivered, and the request path
   * reports its own, more specific failure. It must never throw, because
   * discovery runs on model-picker refreshes.
   * @returns bound model ids, or `undefined` when the listing is unavailable.
   */
  async function boundModelIds(): Promise<string[] | undefined> {
    let endpoint: string
    let token: string
    try {
      endpoint = baseURL()
      token = sessionToken()
    } catch {
      return undefined
    }
    let response: Response
    try {
      response = await fetch(`${endpoint.replace(/\/+$/u, '')}/v1/models`, {
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      })
    } catch (error) {
      console.warn(LOG_TAG, `model listing failed: ${error instanceof Error ? error.message : String(error)}`)
      return undefined
    }
    if (!response.ok) {
      console.warn(LOG_TAG, `model listing failed: HTTP ${response.status}`)
      return undefined
    }
    let body: unknown
    try { body = await response.json() } catch { return undefined }
    // The Gateway answers `{object:'list', tenantId, data:[{id,...}]}`; the
    // OpenAI-shaped `data` array is the part this route needs.
    if (typeof body !== 'object' || body === null) return undefined
    const data = (body as { data?: unknown }).data
    if (!Array.isArray(data)) return undefined
    const ids = data
      .map(entry => (typeof entry === 'object' && entry !== null ? (entry as { id?: unknown }).id : undefined))
      .filter((id): id is string => typeof id === 'string' && id !== '')
    return ids.length === 0 ? undefined : ids
  }
}
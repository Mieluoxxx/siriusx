/**
 * Reader of the enterprise sign-in plugin's loopback probe. The probe also
 * reports `subjectId`; it is not parsed here, so the id of the signed-in person
 * cannot reach a card even by accident.
 */

/** Path of the probe on the Host's web server. */
export const TENANT_PATH = '/__siriusx/tenant'

/** Upper bound on one probe request; the card shows "unavailable" instead of waiting on a stuck Host. */
const PROBE_TIMEOUT_MS = 5000

/** The model the control plane bound to the tenant. */
export interface TenantModel {
  readonly id: string
  readonly provider: string
  readonly model: string
}

/** The probe fields the cards show. */
export interface TenantStatus {
  readonly authenticated: boolean
  readonly tenantId: string | undefined
  readonly roles: readonly string[]
  readonly model: TenantModel | undefined
  readonly controlPlaneUrl: string | undefined
  readonly hasControlPlaneSession: boolean
  readonly controlPlaneError: string | undefined
}

/** The outcome of one probe request. */
export type StatusLoad =
  | { readonly kind: 'ready'; readonly status: TenantStatus }
  | { readonly kind: 'unavailable'; readonly reason: string }

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function parseModel(value: unknown): TenantModel | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { id, provider, model } = value as Record<string, unknown>
  return typeof id === 'string' && typeof provider === 'string' && typeof model === 'string'
    ? { id, provider, model }
    : undefined
}

/**
 * Validate one probe response body.
 * @param body - parsed JSON of the probe response.
 * @returns the status, or `undefined` when the body is not the probe's answer (a Host that serves
 * its page for unknown paths answers 200 with HTML, which never gets this far). A malformed `model`
 * only drops the model: the sign-in facts stay usable.
 */
export function parseTenantStatus(body: unknown): TenantStatus | undefined {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined
  const fields = body as Record<string, unknown>
  const { authenticated, hasControlPlaneSession, role, tenantId, controlPlaneUrl, controlPlaneError } = fields
  if (typeof authenticated !== 'boolean' || typeof hasControlPlaneSession !== 'boolean') return undefined
  if (!Array.isArray(role) || !role.every((entry): entry is string => typeof entry === 'string')) return undefined
  if (!isNullableString(tenantId) || !isNullableString(controlPlaneUrl) || !isNullableString(controlPlaneError)) {
    return undefined
  }
  return {
    authenticated,
    tenantId: tenantId ?? undefined,
    roles: role,
    model: parseModel(fields['model']),
    controlPlaneUrl: controlPlaneUrl ?? undefined,
    hasControlPlaneSession,
    controlPlaneError: controlPlaneError ?? undefined,
  }
}

/**
 * Ask the Host's probe for the tenant status.
 * @param fetchImpl - the `fetch` to use.
 * @param signal - cancels the request; a cancelled load rejects so the caller can drop its result.
 * @returns `ready` with the parsed status, or `unavailable` with a technical reason shown verbatim.
 */
export async function loadTenantStatus(fetchImpl: typeof fetch, signal?: AbortSignal): Promise<StatusLoad> {
  const timeout = AbortSignal.timeout(PROBE_TIMEOUT_MS)
  const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
  const unavailable = (reason: string): StatusLoad => ({ kind: 'unavailable', reason })
  try {
    const response = await fetchImpl(TENANT_PATH, { cache: 'no-store', signal: combined })
    if (!response.ok) return unavailable(`HTTP ${response.status}`)
    let body: unknown
    try {
      body = await response.json()
    } catch (error) {
      if (signal?.aborted === true || timeout.aborted) throw error
      return unavailable('not JSON')
    }
    const status = parseTenantStatus(body)
    return status === undefined ? unavailable('unexpected response') : { kind: 'ready', status }
  } catch (error) {
    if (signal?.aborted === true) throw error
    return unavailable(timeout.aborted ? 'timeout' : error instanceof Error ? error.message : String(error))
  }
}

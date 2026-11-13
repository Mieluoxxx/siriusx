/**
 * The `siriusx` route's pure pieces: the provider id `enterpriseModelProvider`
 * names, the gateway origin, the session token, and the catalog shapes the
 * discovery path builds from the Gateway's `/v1/models` answer.
 *
 * These are unit tests over the exported helpers. End-to-end coverage belongs
 * to the Host boot and the server, where the real adapter is composed.
 */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PROVIDER, apply, catalogOf, gatewayOf, listedModel } from '../src/index.ts'

describe('the siriusx route id', () => {
  it('is the literal enterpriseModelProvider names in enterprise.json', () => {
    // @siriusx/dsh-executor-local selects `{ provider: enterpriseModelProvider }`;
    // a rename here would silently fall back to the local default model.
    expect(PROVIDER).toBe('siriusx')
  })
})

describe('gatewayOf', () => {
  it('reads the enterprise gateway origin', () => {
    expect(gatewayOf({ SIRIUSX_MODEL_GATEWAY_URL: 'https://models.example' })).toBe('https://models.example')
  })

  it('treats an unset or blank value as absent', () => {
    expect(gatewayOf({})).toBeUndefined()
    expect(gatewayOf({ SIRIUSX_MODEL_GATEWAY_URL: '' })).toBeUndefined()
    expect(gatewayOf({ SIRIUSX_MODEL_GATEWAY_URL: '   ' })).toBeUndefined()
  })

  it('never falls back to a public endpoint', () => {
    // A personal build has no gateway at all; inventing one would send tenant
    // traffic somewhere the enterprise config never named.
    expect(gatewayOf({})).toBeUndefined()
  })
})

describe('catalogOf', () => {
  it('advertises the tenant-bound model id unchanged', () => {
    // The Gateway keys on the tenant's own model id; rewriting it here would
    // turn every request into MODEL_NOT_BOUND.
    expect(catalogOf(['acme-default'])).toEqual([
      { id: 'acme-default', name: 'acme-default', inputModalities: ['text', 'image'] },
    ])
  })

  it('keeps every bound model in order', () => {
    expect(catalogOf(['a', 'b']).map(model => model.id)).toEqual(['a', 'b'])
  })

  it('produces no entries for no models', () => {
    expect(catalogOf([])).toEqual([])
  })
})

describe('listedModel', () => {
  it('builds selector metadata for one bound model', () => {
    expect(listedModel('siriusx', 'acme-default')).toEqual({
      provider: 'siriusx',
      id: 'acme-default',
      name: 'acme-default',
      inputModalities: ['text', 'image'],
    })
  })
})

describe('tenant model catalog sync and fallback', () => {
  const originalGateway = process.env.SIRIUSX_MODEL_GATEWAY_URL

  afterEach(() => {
    vi.restoreAllMocks()
    if (originalGateway === undefined) delete process.env.SIRIUSX_MODEL_GATEWAY_URL
    else process.env.SIRIUSX_MODEL_GATEWAY_URL = originalGateway
  })

  it('emits llm/models-updated when siriusxTenant notifies and falls back to SSO model when /v1/models fails', async () => {
    process.env.SIRIUSX_MODEL_GATEWAY_URL = 'http://gateway.test:4321'
    const listeners = new Set<() => void>()
    const tenantState: { controlPlaneToken?: string; model?: { id: string } | null } = {}
    let registeredAdapter: { listModels: (provider: string) => Promise<unknown[]> } | undefined
    const emitted: string[] = []

    const ctx = new Context()
    ctx.provide('llm', {
      registerConfigurableProviders: () => ({ replace: () => {} }),
      registerAdapter: (_providers: string[], adapter: { listModels: (provider: string) => Promise<unknown[]> }) => {
        registeredAdapter = adapter
        return { replace: () => {} }
      },
    } as never)
    ctx.provide('siriusxTenant', Object.assign(tenantState, {
      onChange: (fn: () => void) => {
        listeners.add(fn)
        return () => { listeners.delete(fn) }
      },
    }) as never)
    ctx.on('llm/models-updated', (provider) => { emitted.push(provider) })

    apply(ctx)
    expect(registeredAdapter).toBeDefined()

    // Before control-plane session arrives: empty catalog.
    expect(await registeredAdapter!.listModels(PROVIDER)).toEqual([])

    // After sign-in completes and notifies, llm/models-updated triggers and /v1/models lists bound models.
    tenantState.controlPlaneToken = 'session-tok'
    tenantState.model = { id: 'deepseek-flash' }
    for (const fn of listeners) fn()
    expect(emitted).toEqual([PROVIDER])

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      object: 'list',
      data: [{ id: 'deepseek-flash' }, { id: 'deepseek-pro' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })))
    expect(await registeredAdapter!.listModels(PROVIDER)).toEqual([
      listedModel(PROVIDER, 'deepseek-flash'),
      listedModel(PROVIDER, 'deepseek-pro'),
    ])

    // If /v1/models transiently fails while signed in, fall back to the SSO default model.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unavailable', { status: 503 })))
    expect(await registeredAdapter!.listModels(PROVIDER)).toEqual([
      listedModel(PROVIDER, 'deepseek-flash'),
    ])

    await ctx.fiber.dispose()
  })
})
/**
 * The `siriusx` route's pure pieces: the provider id `enterpriseModelProvider`
 * names, the gateway origin, the session token, and the catalog shapes the
 * discovery path builds from the Gateway's `/v1/models` answer.
 *
 * These are unit tests over the exported helpers. End-to-end coverage belongs
 * to the Host boot and the server, where the real adapter is composed.
 */
import { describe, expect, it } from 'vitest'
import { PROVIDER, catalogOf, gatewayOf, listedModel } from '../src/index.ts'

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
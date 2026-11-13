/**
 * The probe reader: what it accepts, what it refuses, and how a failed request
 * becomes an `unavailable` load instead of an exception. The probe body is the
 * one `@siriusx/dsh-account-sso` writes for `/__siriusx/tenant`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TENANT_PATH, loadTenantStatus, parseTenantStatus } from '../src/client/status.ts'

const SIGNED_IN = {
  authenticated: true,
  tenantId: 'tenant-acme',
  subjectId: 'user-subject-1234',
  role: ['admin'],
  model: { id: 'acme-default', provider: 'anthropic', model: 'claude-x' },
  controlPlaneUrl: 'http://control.example:4320',
  hasControlPlaneSession: true,
  controlPlaneError: null,
}

const SIGNED_OUT = {
  authenticated: false,
  tenantId: null,
  subjectId: null,
  role: [],
  model: null,
  controlPlaneUrl: null,
  hasControlPlaneSession: false,
  controlPlaneError: null,
}

/** A `fetch` that answers every request with one handler. */
function fetchOf(handler: (url: string, init: RequestInit | undefined) => Promise<Response>): typeof fetch {
  return ((url: string, init?: RequestInit) => handler(url, init)) as typeof fetch
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

afterEach(() => { vi.restoreAllMocks() })

describe('parseTenantStatus', () => {
  it('reads a signed-in probe', () => {
    expect(parseTenantStatus(SIGNED_IN)).toEqual({
      authenticated: true,
      tenantId: 'tenant-acme',
      roles: ['admin'],
      model: { id: 'acme-default', provider: 'anthropic', model: 'claude-x' },
      controlPlaneUrl: 'http://control.example:4320',
      hasControlPlaneSession: true,
      controlPlaneError: undefined,
    })
  })

  it('reads a signed-out probe, turning null into absent', () => {
    expect(parseTenantStatus(SIGNED_OUT)).toEqual({
      authenticated: false,
      tenantId: undefined,
      roles: [],
      model: undefined,
      controlPlaneUrl: undefined,
      hasControlPlaneSession: false,
      controlPlaneError: undefined,
    })
  })

  it('never carries the subject id the probe reports', () => {
    const parsed = parseTenantStatus(SIGNED_IN)
    expect(parsed).toBeDefined()
    expect(Object.keys(parsed ?? {})).not.toContain('subjectId')
    expect(JSON.stringify(parsed)).not.toContain('user-subject-1234')
  })

  it('keeps the sign-in facts when only the model is malformed', () => {
    const parsed = parseTenantStatus({ ...SIGNED_IN, model: { id: 7 } })
    expect(parsed?.authenticated).toBe(true)
    expect(parsed?.tenantId).toBe('tenant-acme')
    expect(parsed?.model).toBeUndefined()
  })

  it.each([
    ['a string', 'not an object'],
    ['null', null],
    ['an array', [SIGNED_IN]],
    ['a missing authenticated flag', { ...SIGNED_IN, authenticated: undefined }],
    ['a non-boolean session flag', { ...SIGNED_IN, hasControlPlaneSession: 'yes' }],
    ['roles that are not strings', { ...SIGNED_IN, role: ['admin', 3] }],
    ['a missing role list', { ...SIGNED_IN, role: undefined }],
    ['a numeric tenant id', { ...SIGNED_IN, tenantId: 42 }],
    ['an object error', { ...SIGNED_IN, controlPlaneError: { message: 'x' } }],
  ])('refuses %s', (_name, body) => {
    expect(parseTenantStatus(body)).toBeUndefined()
  })
})

describe('loadTenantStatus', () => {
  it('asks the probe path without caching', async () => {
    const seen: Array<{ url: string; cache: RequestCache | undefined }> = []
    const load = await loadTenantStatus(fetchOf(async (url, init) => {
      seen.push({ url, cache: init?.cache })
      return jsonResponse(SIGNED_IN)
    }))
    expect(seen).toEqual([{ url: TENANT_PATH, cache: 'no-store' }])
    expect(load.kind).toBe('ready')
  })

  it('returns the parsed status', async () => {
    const load = await loadTenantStatus(fetchOf(async () => jsonResponse(SIGNED_IN)))
    expect(load).toMatchObject({ kind: 'ready', status: { authenticated: true, tenantId: 'tenant-acme' } })
  })

  it('reports the HTTP status of a refusal', async () => {
    const load = await loadTenantStatus(fetchOf(async () => new Response('', { status: 404 })))
    expect(load).toEqual({ kind: 'unavailable', reason: 'HTTP 404' })
  })

  it('reports a network failure with its message', async () => {
    const load = await loadTenantStatus(fetchOf(async () => { throw new TypeError('Failed to fetch') }))
    expect(load).toEqual({ kind: 'unavailable', reason: 'Failed to fetch' })
  })

  it('reports a page served in place of the probe', async () => {
    const load = await loadTenantStatus(fetchOf(async () => new Response('<!doctype html><title>app</title>', { status: 200 })))
    expect(load).toEqual({ kind: 'unavailable', reason: 'not JSON' })
  })

  it('reports JSON that is not the probe answer', async () => {
    const load = await loadTenantStatus(fetchOf(async () => jsonResponse({ ok: true })))
    expect(load).toEqual({ kind: 'unavailable', reason: 'unexpected response' })
  })

  it('rejects a load the caller cancelled, so the caller can drop it', async () => {
    const controller = new AbortController()
    const pending = loadTenantStatus(fetchOf((_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { reject(init.signal?.reason) })
    })), controller.signal)
    controller.abort(new DOMException('cancelled', 'AbortError'))
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('gives up on a Host that never answers', async () => {
    const timeout = new AbortController()
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal)
    const pending = loadTenantStatus(fetchOf((_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { reject(init.signal?.reason) })
    })))
    timeout.abort(new DOMException('timed out', 'TimeoutError'))
    await expect(pending).resolves.toEqual({ kind: 'unavailable', reason: 'timeout' })
  })
})

/**
 * When a stored grant must be refreshed before its control-plane exchange.
 *
 * The failure this prevents: a 300-second id_token was replayed at
 * `/v1/sso/desktop/exchange` hours after it expired, the 401 was swallowed, and
 * the desktop reported "signed in" while every tenant feature stayed empty.
 */
import { describe, expect, it } from 'vitest'
import { idTokenExpiring } from '../src/index.ts'

describe('idTokenExpiring', () => {
  it('refreshes an already-expired credential', () => {
    const now = Date.UTC(2026, 10, 12, 6, 11, 0)
    // The observed grant: issued 02:10:50Z, valid 300 seconds.
    const issuedAt = Date.UTC(2026, 10, 12, 2, 10, 50)
    expect(idTokenExpiring(issuedAt / 1000 + 300, now)).toBe(true)
  })

  it('refreshes inside the headroom that absorbs clock skew', () => {
    const now = Date.UTC(2026, 10, 12, 12, 0, 0)
    expect(idTokenExpiring(now / 1000 + 30, now)).toBe(true)
  })

  it('leaves a credential with more than the headroom remaining alone', () => {
    const now = Date.UTC(2026, 10, 12, 12, 0, 0)
    expect(idTokenExpiring(now / 1000 + 300, now)).toBe(false)
  })

  it('treats a credential that declares no expiry as unusable', () => {
    expect(idTokenExpiring(undefined, Date.UTC(2026, 10, 12))).toBe(true)
  })

  it('does not treat the boundary as healthy', () => {
    const now = Date.UTC(2026, 10, 12, 12, 0, 0)
    // Exactly one minute left is the last instant the exchange is attempted
    // with the current token; anything at or below it must refresh.
    expect(idTokenExpiring(now / 1000 + 60, now)).toBe(false)
    expect(idTokenExpiring(now / 1000 + 59, now)).toBe(true)
  })
})
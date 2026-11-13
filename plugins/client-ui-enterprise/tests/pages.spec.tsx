/**
 * What each entry shows for each load: the card one-liners, and the page body
 * from the status the probe reports. Pages render with `react-dom/server`, so
 * effects never run and the hook-driven pages stay in their first (loading)
 * state; the views take a load directly to cover the rest.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  AccountSsoItem, AccountSsoView, ModelGatewayItem, ModelGatewayView, type EnterpriseItemProps,
} from '../src/client/EnterpriseItem.tsx'
import { en, zh } from '../src/client/locales.ts'
import { parseTenantStatus, type StatusLoad } from '../src/client/status.ts'

// The real primitives load stylesheets that Node cannot import; the entries only need their markup contract.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: ({ children, disabled, onClick }: { children?: string; disabled?: boolean; onClick?: () => void }) => (
    <button type="button" disabled={disabled} onClick={onClick}>{children}</button>
  ),
  Tag: ({ tone, children }: { tone?: string; children?: string }) => <span data-tone={tone}>{children}</span>,
}))

function translator(dictionary: Readonly<Record<string, string>>): EnterpriseItemProps['t'] {
  return (key: string, params?: Record<string, unknown>) => (dictionary[key] ?? key)
    .replace(/\{(\w+)\}/g, (match, name: string) => (params !== undefined && name in params ? String(params[name]) : match))
}

const tZh = translator(zh)
const tEn = translator(en)

const SIGNED_IN = {
  authenticated: true,
  tenantId: 'tenant-acme',
  subjectId: 'user-subject-1234',
  role: ['admin', 'member'],
  model: { id: 'acme-default', provider: 'anthropic', model: 'claude-x' },
  controlPlaneUrl: 'http://control.example:4320',
  hasControlPlaneSession: true,
  controlPlaneError: null,
}

function ready(body: Record<string, unknown>): StatusLoad {
  const status = parseTenantStatus(body)
  if (status === undefined) throw new Error('fixture is not a probe body')
  return { kind: 'ready', status }
}

const noop = (): void => {}

describe('card one-liners', () => {
  it('shows the sign-in summary in the active language', () => {
    expect(AccountSsoItem({ view: 'summary', t: tZh })).toBe(zh.accountSummary)
    expect(AccountSsoItem({ view: 'summary', t: tEn })).toBe(en.accountSummary)
  })

  it('shows the gateway summary in the active language', () => {
    expect(ModelGatewayItem({ view: 'summary', t: tZh })).toBe(zh.gatewaySummary)
    expect(ModelGatewayItem({ view: 'summary', t: tEn })).toBe(en.gatewaySummary)
  })
})

describe('opened pages', () => {
  it('start in the loading state, with refresh unavailable', () => {
    for (const page of [AccountSsoItem({ view: 'page', t: tZh }), ModelGatewayItem({ view: 'page', t: tZh })]) {
      const html = renderToStaticMarkup(<>{page}</>)
      expect(html).toContain(zh.loading)
      expect(html).toMatch(/<button[^>]*disabled/u)
    }
  })

  it('name the plugin package that provides them', () => {
    expect(renderToStaticMarkup(<AccountSsoView t={tZh} state={{ kind: 'loading' }} onReload={noop} />))
      .toContain('@siriusx/dsh-account-sso')
    expect(renderToStaticMarkup(<ModelGatewayView t={tZh} state={{ kind: 'loading' }} onReload={noop} />))
      .toContain('@siriusx/dsh-llm-siriusx')
  })
})

describe('enterprise sign-in page', () => {
  it('shows a signed-in tenant with its role and session', () => {
    const html = renderToStaticMarkup(<AccountSsoView t={tZh} state={ready(SIGNED_IN)} onReload={noop} />)
    expect(html).toContain(zh.signedIn)
    expect(html).toContain('tenant-acme')
    expect(html).toContain('admin, member')
    expect(html).toContain(zh.controlSessionReady)
    expect(html).toContain('http://control.example:4320')
    expect(html).toContain('data-tone="success"')
  })

  it('shows a signed-out install without tenant facts', () => {
    const html = renderToStaticMarkup(<AccountSsoView t={tEn} state={ready({
      ...SIGNED_IN, authenticated: false, tenantId: null, subjectId: null, role: [], model: null,
      controlPlaneUrl: null, hasControlPlaneSession: false,
    })} onReload={noop} />)
    expect(html).toContain(en.signedOut)
    expect(html).toContain(en.controlSessionMissing)
    expect(html).not.toContain('tenant-acme')
    expect(html).not.toContain('data-tone="success"')
    // Not `neutral`: a platform-gray capsule is invisible on the platform-gray panel.
    expect(html).not.toContain('data-tone="neutral"')
    expect(html.match(/data-tone="outline"/gu)).toHaveLength(2)
  })

  it('warns when a signed-in person has no control-plane session', () => {
    const html = renderToStaticMarkup(<AccountSsoView t={tEn} state={ready({ ...SIGNED_IN, hasControlPlaneSession: false })} onReload={noop} />)
    expect(html).toContain(en.controlSessionMissing)
    expect(html).toContain('data-tone="warning"')
  })

  it('shows why the last session exchange failed', () => {
    const html = renderToStaticMarkup(<AccountSsoView t={tEn} state={ready({
      ...SIGNED_IN, hasControlPlaneSession: false, controlPlaneError: 'exchange refused: HTTP 401',
    })} onReload={noop} />)
    expect(html).toContain('The last session exchange failed: exchange refused: HTTP 401')
  })

  it('never shows the subject id', () => {
    const html = renderToStaticMarkup(<AccountSsoView t={tZh} state={ready(SIGNED_IN)} onReload={noop} />)
    expect(html).not.toContain('user-subject-1234')
  })

  it('escapes text that came from the Host', () => {
    const html = renderToStaticMarkup(<AccountSsoView t={tEn} state={ready({
      ...SIGNED_IN, controlPlaneError: '<script>alert(1)</script>',
    })} onReload={noop} />)
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('says it could not read the status, with the reason', () => {
    const html = renderToStaticMarkup(<AccountSsoView t={tZh} state={{ kind: 'unavailable', reason: 'HTTP 404' }} onReload={noop} />)
    expect(html).toContain(zh.unavailable)
    expect(html).toContain('原因：HTTP 404')
    expect(html).not.toMatch(/<button[^>]*disabled/u)
  })
})

describe('model gateway page', () => {
  it('shows the tenant model and a ready authorization', () => {
    const html = renderToStaticMarkup(<ModelGatewayView t={tEn} state={ready(SIGNED_IN)} onReload={noop} />)
    expect(html).toContain('acme-default')
    expect(html).toContain(en.gatewayAuthReady)
    expect(html).toContain('tenant-acme')
    expect(html).not.toContain(en.gatewayAuthHint)
  })

  it('says no model is assigned yet', () => {
    const html = renderToStaticMarkup(<ModelGatewayView t={tEn} state={ready({ ...SIGNED_IN, model: null })} onReload={noop} />)
    expect(html).toContain(en.modelNone)
  })

  it('tells the person to sign in again when the session is missing', () => {
    const html = renderToStaticMarkup(<ModelGatewayView t={tZh} state={ready({ ...SIGNED_IN, hasControlPlaneSession: false })} onReload={noop} />)
    expect(html).toContain(zh.gatewayAuthMissing)
    expect(html).toContain(zh.gatewayAuthHint)
    expect(html).toContain('data-tone="warning"')
  })

  it('does not show the upstream provider behind the tenant model', () => {
    const html = renderToStaticMarkup(<ModelGatewayView t={tEn} state={ready(SIGNED_IN)} onReload={noop} />)
    expect(html).not.toContain('anthropic')
    expect(html).not.toContain('claude-x')
  })

  it('never shows the subject id', () => {
    const html = renderToStaticMarkup(<ModelGatewayView t={tZh} state={ready(SIGNED_IN)} onReload={noop} />)
    expect(html).not.toContain('user-subject-1234')
  })
})

/** SiriusX brand occupants, hero mark and privacy badge. */
import { useEffect, useState, type ReactNode } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SidebarBrandMarkOwnerProps, SidebarFooterActionOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'

export const inject = ['slots']

function apiBase(): string {
  try { return localStorage.getItem('siriusx.controlApi') ?? 'http://127.0.0.1:4320' } catch { return 'http://127.0.0.1:4320' }
}

function PrivacyBadge(): ReactNode {
  const [enabled, setEnabled] = useState(false)
  useEffect(() => {
    let cancelled = false
    try {
      const token = localStorage.getItem('siriusx.controlToken')
      if (token === null || token === '') return
      void fetch(`${apiBase()}/v1/settings`, { headers: { authorization: `Bearer ${token}` } })
        .then(response => response.json())
        .then((settings: { nativeConversationEnabled?: boolean }) => { if (!cancelled) setEnabled(settings.nativeConversationEnabled === true) })
        .catch(() => undefined)
    } catch { /* no persisted session */ }
    return () => { cancelled = true }
  }, [])
  if (!enabled) return null
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 0' }}>
      <span style={{ fontSize: 11, opacity: 0.72, border: '1px solid color-mix(in srgb, currentColor 18%, transparent)', borderRadius: 999, padding: '2px 8px' }}>
        个人 · 不审计
      </span>
    </div>
  )
}

export function apply(ctx: ClientContext): void {
  if (typeof document !== 'undefined') {
    document.title = 'SiriusX'
    const enforceTitle = (): void => { if (document.title !== 'SiriusX') document.title = 'SiriusX' }
    const observer = new MutationObserver(enforceTitle)
    observer.observe(document.head, { childList: true, subtree: true, characterData: true })
    ctx.effect(() => () => observer.disconnect(), 'siriusx-brand: title')
    setTimeout(enforceTitle, 0)
  }
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', function* () {
      yield ctx.slots.register({ name: 'sidebar.brand.mark' }, BrandMark)
      yield ctx.slots.register({ name: 'sidebar.brand.name' }, BrandName)
    }))
  ctx.slots.inject('conversation.hero.brand.mark', () => ctx.slots.register({ name: 'conversation.hero.brand.mark' }, HeroMark))
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({ name: 'conversation.input.dock', id: 'siriusx-privacy' }, PrivacyBadge))
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: 'siriusx-privacy', order: 100 }, FooterPrivacy))
}

function Mark({ size }: { size: number }): ReactNode {
  return (
    <span style={{
      width: size, height: size, display: 'inline-grid', placeItems: 'center',
      borderRadius: size * 0.24, background: 'linear-gradient(135deg, #0f172a, #1e3a5f)',
      color: '#f8fafc', fontSize: size * 0.42, fontWeight: 800, letterSpacing: '-0.04em',
    }} aria-hidden="true">SX</span>
  )
}

function FooterPrivacy({ wide }: SidebarFooterActionOwnerProps): ReactNode { return wide ? <PrivacyBadge /> : null }

function BrandMark({ size }: SidebarBrandMarkOwnerProps): ReactNode { return <Mark size={size} /> }
function HeroMark({ size }: HeroBrandMarkOwnerProps): ReactNode { return <Mark size={size} /> }
function BrandName(): ReactNode { return <span style={{ fontWeight: 750, letterSpacing: '-0.02em' }}>SiriusX</span> }

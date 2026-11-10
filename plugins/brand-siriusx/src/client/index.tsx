/** SiriusX sidebar brand occupants and document title. */
import type { ReactNode } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'

export const inject = ['slots']

export function apply(ctx: ClientContext): void {
  if (typeof document !== 'undefined') {
    document.title = 'SiriusX'
    // The shell can set its release title after client plugins activate.
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
}

function BrandMark({ size }: SidebarBrandMarkOwnerProps): ReactNode {
  return (
    <span style={{
      width: size, height: size, display: 'inline-grid', placeItems: 'center',
      borderRadius: size * 0.24, background: 'linear-gradient(135deg, #0f172a, #1e3a5f)',
      color: '#f8fafc', fontSize: size * 0.42, fontWeight: 800, letterSpacing: '-0.04em',
    }} aria-hidden="true">SX</span>
  )
}

function BrandName(): ReactNode {
  return <span style={{ fontWeight: 750, letterSpacing: '-0.02em' }}>SiriusX</span>
}

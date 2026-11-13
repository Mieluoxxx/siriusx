/**
 * The registration wiring against a recording context: which slot receives
 * which entry, in what order, and that everything it installs is removable.
 * Rendering the entries inside the real Plugins page is covered by running the
 * web client, not here.
 */
import { describe, expect, it, vi } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { apply, inject } from '../src/client/index.tsx'
import { AccountSsoItem, ModelGatewayItem } from '../src/client/EnterpriseItem.tsx'
import { NS, en, zh } from '../src/client/locales.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({ Button: () => null, Tag: () => null }))

interface Registration {
  readonly options: { readonly name: string; readonly id: string; readonly order: number; readonly label: () => string; readonly locale: string }
  readonly component: unknown
}

/**
 * A context that records what `apply` installs, runs every effect and injection immediately, and keeps
 * their disposers the way the plugin's fiber would, so a test can tear the plugin down.
 */
function recordingContext() {
  const injected: string[] = []
  const registered: Registration[] = []
  const dictionaries: Array<{ ns: string; locale: string; dictionary: unknown }> = []
  const removed: string[] = []
  const fiberDisposers: Array<() => void> = []
  const ctx = {
    effect: (setup: () => (() => void) | void) => {
      const dispose = setup()
      if (dispose !== undefined) fiberDisposers.push(dispose)
      return dispose
    },
    locale: {
      bind: (ns: string) => (key: string) => `${ns}:${key}`,
      register: (ns: string, locale: string, dictionary: unknown) => {
        dictionaries.push({ ns, locale, dictionary })
        return () => { removed.push(`dictionary ${locale}`) }
      },
    },
    slots: {
      inject: (name: string, install: () => () => void) => {
        injected.push(name)
        const dispose = install()
        fiberDisposers.push(dispose)
        return dispose
      },
      register: (options: Registration['options'], component: unknown) => {
        registered.push({ options, component })
        return () => { removed.push(`entry ${options.id}`) }
      },
    },
  }
  const dispose = (): void => { for (const undo of fiberDisposers.splice(0).reverse()) undo() }
  return { ctx: ctx as unknown as ClientContext, injected, registered, dictionaries, removed, dispose }
}

describe('client entry', () => {
  it('waits for the slots and locale services', () => {
    expect(inject).toEqual(['slots', 'locale'])
  })

  it('registers one card per plugin into the Plugins page', () => {
    const { ctx, injected, registered } = recordingContext()
    apply(ctx)
    expect(injected).toEqual(['plugins.item', 'plugins.item'])
    expect(registered.map(entry => [entry.options.name, entry.options.id, entry.component])).toEqual([
      ['plugins.item', 'siriusx-account-sso', AccountSsoItem],
      ['plugins.item', 'siriusx-model-gateway', ModelGatewayItem],
    ])
  })

  it('places the cards after the official entries and keeps their order', () => {
    const { ctx, registered } = recordingContext()
    apply(ctx)
    const [account, gateway] = registered
    expect(account?.options.order).toBeGreaterThanOrEqual(100)
    expect(gateway?.options.order).toBeGreaterThan(account?.options.order ?? Infinity)
  })

  it('titles the cards from the locale dictionary', () => {
    const { ctx, registered } = recordingContext()
    apply(ctx)
    expect(registered.map(entry => entry.options.label())).toEqual([`${NS}:accountTitle`, `${NS}:gatewayTitle`])
    expect(registered.every(entry => entry.options.locale === NS)).toBe(true)
  })

  it('registers the Chinese and English dictionaries under its own namespace', () => {
    const { ctx, dictionaries } = recordingContext()
    apply(ctx)
    expect(dictionaries).toEqual([
      { ns: NS, locale: 'zh', dictionary: zh },
      { ns: NS, locale: 'en', dictionary: en },
    ])
  })

  it('leaves nothing registered once the plugin is disposed', () => {
    const { ctx, removed, dispose } = recordingContext()
    apply(ctx)
    expect(removed).toEqual([])
    dispose()
    expect([...removed].sort()).toEqual([
      'dictionary en', 'dictionary zh', 'entry siriusx-account-sso', 'entry siriusx-model-gateway',
    ])
  })
})

/**
 * SiriusX entries in the Plugins page, browser half: a card for the enterprise
 * sign-in plugin and one for the model gateway plugin, registered into the
 * page's `plugins.item` slot so they sit in the same group as the official
 * plugins. The entries are read-only; both plugins are configured by the
 * enterprise config baked into the installation.
 */

// Type-only: the ctx.locale Context merge.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the Plugins page's SlotMap merge (the 'plugins.item' entry).
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
// Type-only: the ctx.slots Context merge.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { AccountSsoItem, ModelGatewayItem } from './EnterpriseItem.tsx'
import { NS, en, zh } from './locales.ts'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale']

/**
 * Register both entries and their dictionaries.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => {
    const disposers = [ctx.locale.register(NS, 'zh', zh), ctx.locale.register(NS, 'en', en)]
    return () => { for (const dispose of disposers) dispose() }
  }, 'client-ui-enterprise: dictionaries')
  // Ordered after the official entries, so the SiriusX cards close the group instead of displacing them.
  ctx.slots.inject('plugins.item', () => ctx.slots.register({
    name: 'plugins.item', id: 'siriusx-account-sso', order: 100, label: () => t('accountTitle'), locale: NS,
  }, AccountSsoItem))
  ctx.slots.inject('plugins.item', () => ctx.slots.register({
    name: 'plugins.item', id: 'siriusx-model-gateway', order: 110, label: () => t('gatewayTitle'), locale: NS,
  }, ModelGatewayItem))
}

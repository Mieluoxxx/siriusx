/**
 * The two SiriusX entries of the Plugins page. A card shows the `summary` view
 * as its one-liner; opening it renders the `page` view, which reads what the
 * Host holds for the signed-in tenant. Inline styles use the shell's `--dsw-*`
 * aliases because this bundle ships no stylesheet.
 */

import { useEffect, useId, useState, type CSSProperties, type ReactNode } from 'react'
import { Button, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { NS } from './locales.ts'
import { loadTenantStatus, type StatusLoad, type TenantStatus } from './status.ts'

/** Props the renderer binds for both entries. */
export type EnterpriseItemProps = Pick<PropsRuntime<'plugins.item'>, 'view'> & PropsLocale<typeof NS>

type Translate = EnterpriseItemProps['t']

type LoadState = { readonly kind: 'loading' } | StatusLoad

interface StatusRow {
  readonly label: string
  readonly value: ReactNode
}

const styles = {
  section: { display: 'flex', flexDirection: 'column', gap: 12 },
  title: { margin: 0, fontSize: 14, fontWeight: 500, lineHeight: '20px', color: 'var(--dsw-alias-label-primary)' },
  panel: {
    display: 'flex', flexDirection: 'column', margin: 0, padding: '0 16px',
    borderRadius: 'var(--dsw-radius-md)', background: 'var(--dsw-alias-bg-module-platform)',
  },
  row: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
    padding: '12px 0', fontSize: 13, lineHeight: '20px',
  },
  divider: { borderTop: '0.5px solid var(--dsw-alias-border-l4)' },
  label: { flex: 'none', color: 'var(--dsw-alias-label-tertiary)' },
  value: { margin: 0, minWidth: 0, textAlign: 'end', overflowWrap: 'anywhere', color: 'var(--dsw-alias-label-primary)' },
  hint: { margin: 0, fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)', overflowWrap: 'anywhere' },
  failure: { margin: 0, fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-state-error-primary)', overflowWrap: 'anywhere' },
  footer: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  code: { fontFamily: 'var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)' },
} satisfies Record<string, CSSProperties>

/**
 * Load the tenant status when the page opens, and again on request.
 * @returns the current load and the command that starts a new one.
 */
function useTenantStatus(): readonly [LoadState, () => void] {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    loadTenantStatus(fetch, controller.signal).then(
      next => { if (!controller.signal.aborted) setState(next) },
      // loadTenantStatus rejects only after this effect aborted it, so a newer attempt or the unmount owns the state.
      () => {},
    )
    return () => { controller.abort() }
  }, [attempt])
  const reload = (): void => {
    setState({ kind: 'loading' })
    setAttempt(previous => previous + 1)
  }
  return [state, reload]
}

function Mono({ children }: { readonly children: string }): ReactNode {
  return <code style={styles.code}>{children}</code>
}

/**
 * One entry's page: its status rows, an optional notice under them, and the package that provides it.
 * @param props.rows - the rows to show once the status is read.
 * @param props.notice - a note about the read status, shown under the rows.
 */
function StatusPage({ t, packageName, state, onReload, rows, notice }: {
  readonly t: Translate
  readonly packageName: string
  readonly state: LoadState
  readonly onReload: () => void
  readonly rows: (status: TenantStatus) => readonly StatusRow[]
  readonly notice?: (status: TenantStatus) => ReactNode
}): ReactNode {
  const headingId = useId()
  return (
    <section style={styles.section} aria-labelledby={headingId}>
      <h4 id={headingId} style={styles.title}>{t('statusSection')}</h4>
      {state.kind === 'loading' ? <p role="status" style={styles.hint}>{t('loading')}</p> : null}
      {state.kind === 'unavailable' ? (
        <div role="alert" style={styles.section}>
          <p style={styles.failure}>{t('unavailable')}</p>
          <p style={styles.hint}>{t('unavailableReason', { reason: state.reason })}</p>
        </div>
      ) : null}
      {state.kind === 'ready' ? (
        <>
          <dl style={styles.panel}>
            {rows(state.status).map((row, index) => (
              <div key={row.label} style={index === 0 ? styles.row : { ...styles.row, ...styles.divider }}>
                <dt style={styles.label}>{row.label}</dt>
                <dd style={styles.value}>{row.value}</dd>
              </div>
            ))}
          </dl>
          {notice?.(state.status)}
        </>
      ) : null}
      <div style={styles.footer}>
        <p style={styles.hint}>{t('packageName')} <Mono>{packageName}</Mono></p>
        <Button variant="outline" size="sm" disabled={state.kind === 'loading'} onClick={onReload}>{t('refresh')}</Button>
      </div>
    </section>
  )
}

function accountRows(t: Translate, status: TenantStatus): readonly StatusRow[] {
  // `outline`, not `neutral`: the panel is platform gray, so a platform-gray capsule would vanish into it.
  const sessionTone = status.hasControlPlaneSession ? 'success' : status.authenticated ? 'warning' : 'outline'
  return [
    {
      label: t('loginState'),
      value: <Tag tone={status.authenticated ? 'success' : 'outline'}>{t(status.authenticated ? 'signedIn' : 'signedOut')}</Tag>,
    },
    { label: t('tenant'), value: status.tenantId === undefined ? t('empty') : <Mono>{status.tenantId}</Mono> },
    { label: t('roles'), value: status.roles.length === 0 ? t('empty') : status.roles.join(', ') },
    {
      label: t('controlSession'),
      value: <Tag tone={sessionTone}>{t(status.hasControlPlaneSession ? 'controlSessionReady' : 'controlSessionMissing')}</Tag>,
    },
    { label: t('controlPlane'), value: status.controlPlaneUrl === undefined ? t('empty') : <Mono>{status.controlPlaneUrl}</Mono> },
  ]
}

function gatewayRows(t: Translate, status: TenantStatus): readonly StatusRow[] {
  return [
    { label: t('model'), value: status.model === undefined ? t('modelNone') : <Mono>{status.model.id}</Mono> },
    {
      label: t('gatewayAuth'),
      value: <Tag tone={status.hasControlPlaneSession ? 'success' : 'warning'}>{t(status.hasControlPlaneSession ? 'gatewayAuthReady' : 'gatewayAuthMissing')}</Tag>,
    },
    { label: t('tenant'), value: status.tenantId === undefined ? t('empty') : <Mono>{status.tenantId}</Mono> },
  ]
}

interface ViewProps {
  readonly t: Translate
  readonly state: LoadState
  readonly onReload: () => void
}

/**
 * The enterprise sign-in page for a given load.
 * @param props.state - the status load to show.
 * @param props.onReload - starts a new load.
 */
export function AccountSsoView({ t, state, onReload }: ViewProps): ReactNode {
  return (
    <StatusPage
      t={t}
      packageName="@siriusx/dsh-account-sso"
      state={state}
      onReload={onReload}
      rows={status => accountRows(t, status)}
      notice={status => status.controlPlaneError === undefined
        ? null
        : <p role="alert" style={styles.failure}>{t('controlSessionFailed', { message: status.controlPlaneError })}</p>}
    />
  )
}

/**
 * The model gateway page for a given load.
 * @param props.state - the status load to show.
 * @param props.onReload - starts a new load.
 */
export function ModelGatewayView({ t, state, onReload }: ViewProps): ReactNode {
  return (
    <StatusPage
      t={t}
      packageName="@siriusx/dsh-llm-siriusx"
      state={state}
      onReload={onReload}
      rows={status => gatewayRows(t, status)}
      notice={status => status.hasControlPlaneSession ? null : <p style={styles.hint}>{t('gatewayAuthHint')}</p>}
    />
  )
}

function AccountSsoPage({ t }: { readonly t: Translate }): ReactNode {
  const [state, reload] = useTenantStatus()
  return <AccountSsoView t={t} state={state} onReload={reload} />
}

function ModelGatewayPage({ t }: { readonly t: Translate }): ReactNode {
  const [state, reload] = useTenantStatus()
  return <ModelGatewayView t={t} state={state} onReload={reload} />
}

/**
 * The enterprise sign-in entry.
 * @param props.view - `summary` is the card's one-liner, `page` the detail body.
 * @param props.t - the entry's locale reader.
 */
export function AccountSsoItem({ view, t }: EnterpriseItemProps): ReactNode {
  return view === 'summary' ? t('accountSummary') : <AccountSsoPage t={t} />
}

/**
 * The model gateway entry.
 * @param props.view - `summary` is the card's one-liner, `page` the detail body.
 * @param props.t - the entry's locale reader.
 */
export function ModelGatewayItem({ view, t }: EnterpriseItemProps): ReactNode {
  return view === 'summary' ? t('gatewaySummary') : <ModelGatewayPage t={t} />
}

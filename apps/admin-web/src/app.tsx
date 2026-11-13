/** SiriusX platform admin SPA: React surface composed from Base UI primitives. */
import * as React from 'react'
import {
  Activity,
  BarChart3,
  CircleHelp,
  Cpu,
  KeyRound,
  LayoutGrid,
  Link2,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  ShieldCheck,
  Sun,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { Collapsible } from '@base-ui-components/react/collapsible'
import { Tabs } from '@base-ui-components/react/tabs'
import { Toast } from '@base-ui-components/react/toast'
import {
  AddTenantUserForm,
  AddUpstreamForm,
  AuditFilters,
  AuthForm,
  CreateBindingForm,
  CreateModelForm,
  CreateTenantForm,
  ImportUpstreamModelsForm,
  PlatformUpstreamForm,
  RequestSupportForm,
  TenantBillingForm,
  TenantFilters,
  TenantProfileForm,
  TenantQuotaForm,
  type AuditFilterValue,
  type FetchedUpstreamModel,
  type TenantInitialValues,
} from './forms'
import {
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  DialogShell,
  PageHeader,
  QuotaProgress,
  SectionHeading,
  SelectField,
  StatusPill,
  ToastHost,
  cx,
  errorText,
  numberValue,
  valueOf,
  type SelectOption,
} from './ui'

type Json = Record<string, unknown>
type TenantStatus = 'active' | 'suspended'
type View = 'overview' | 'analytics' | 'tenants' | 'tenant' | 'models' | 'sources' | 'support' | 'audit'
interface Route { view: View; tenantId?: string }

interface Tenant {
  id: string
  name: string
  idpIssuer: string
  createdAt: number
  status: TenantStatus
  usage: { users: number; devices: number; deviceTickets: number; cloudTickets: number }
}
interface PlatformUpstream { id: string; name: string; protocol: string; baseUrl: string; enabled: boolean; hasApiKey: boolean; modelCount: number }
interface Model { id: string; name: string; provider: string; model: string; enabled: boolean; upstreamId: string | null; upstreamName: string | null }
interface Binding { id: string; provider: string; externalId: string; tenantId: string; botId: string | null; repoUrl: string | null; baseRef: string | null; autoDispatch: boolean }
interface SupportRequest { id: string; tenantId: string; requestedBy: string; reason: string; status: string }
interface Audit { id: number; actor: string; action: string; target: string; detail: string | null; createdAt: number }
interface Upstream { id: string; modelId: string; name: string; protocol: string; baseUrl: string; upstreamModel: string; priority: number; enabled: boolean; hasApiKey: boolean }
interface User { userId: string; email: string; role: string }
interface Quota { maxUsers: number; maxDevices: number; maxCloudTicketsPerDay: number; maxDeviceTicketsPerDay: number }
interface Billing { currency: string; cloudTicketCents: number; deviceTicketCents: number; monthlyBudgetCents: number | null }
interface TenantModel { id: string; name: string; provider: string; model: string; isDefault: boolean; upstreamId: string | null; upstreamName: string | null }
interface ServiceProbe { configured: boolean; ok: boolean; latencyMs: number | null; approvalsPending?: number; audits?: number; auditChainValid?: boolean; detail?: string }
interface PlatformAnalytics {
  days: number
  totals: {
    tenants: number
    activeTenants: number
    users: number
    devices: number
    activeDevices: number
    cloudTicketsTotal: number
    deviceTicketsTotal: number
    cloudTicketsToday: number
    deviceTicketsToday: number
    models: number
    upstreams: number
    sourceEvents: number
    modelRequests: number
    modelErrors: number
  }
  daily: Array<{ date: string; cloudTickets: number; deviceTickets: number }>
  tenants: Array<{
    id: string
    name: string
    status: TenantStatus
    users: number
    maxUsers: number
    devices: number
    maxDevices: number
    cloudTicketsToday: number
    maxCloudTicketsPerDay: number
    deviceTicketsToday: number
    maxDeviceTicketsPerDay: number
    periodCloudTickets: number
    periodDeviceTickets: number
    estimatedCents: number
    currency: string
    monthlyBudgetCents: number | null
    maxUtilizationPct: number
  }>
  models: Array<{
    id: string
    name: string
    upstreamName: string | null
    tenantCount: number
    defaultCount: number
    requests: number
    errors: number
    avgLatencyMs: number | null
  }>
  recentSourceEvents: Array<{
    id: string
    provider: string
    tenantId: string | null
    eventType: string
    status: string
    ticketId: string | null
    receivedAt: number
  }>
  services: {
    controlPlane: ServiceProbe
    toolGateway: ServiceProbe
    modelRouter: ServiceProbe
  }
}
interface AllData { tenants: Tenant[]; upstreams: PlatformUpstream[]; models: Model[]; bindings: Binding[]; supportRequests: SupportRequest[]; audit: Audit[] }
interface TenantDetailData {
  users: User[]
  quota: Quota
  usageDaily: Array<{ date: string; cloudTickets: number; deviceTickets: number }>
  billing: Billing
  estimate: { estimatedCents: number; currency: string }
  models: TenantModel[]
  auditSummary: { total: number; decisions: Record<string, number> }
}
interface EditorState { title: string; content: React.ReactNode; size: 'sm' | 'md' | 'lg' }
interface ConfirmState { title: string; message: string; confirmLabel: string; resolve: (value: boolean) => void }

interface AdminActions {
  token: string
  navigate: (view: View, tenantId?: string) => void
  openEditor: (title: string, content: React.ReactNode, size?: 'sm' | 'md' | 'lg') => void
  closeEditor: () => void
  refresh: () => Promise<void>
  notify: (message: string) => void
  confirmAction: (title: string, message: string, confirmLabel?: string) => Promise<boolean>
}

class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

async function api<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-siriusx-platform-token': token,
      ...(init.headers ?? {}),
    },
  })
  const text = await response.text()
  let value: unknown
  try { value = text === '' ? undefined : JSON.parse(text) } catch { value = text }
  if (!response.ok) throw new ApiError(response.status, typeof value === 'object' && value !== null && 'error' in value ? String((value as Json).error) : `HTTP ${response.status}`)
  return value as T
}

const VIEW_LABELS: Record<View, string> = { overview: 'Overview', analytics: 'Analytics', tenants: 'Tenants', tenant: 'Tenant detail', models: 'Models & upstreams', sources: 'Sources', support: 'Support', audit: 'Audit' }
const VIEW_PATHS: Partial<Record<View, string>> = { overview: '/', analytics: '/analytics', tenants: '/tenants', models: '/models', sources: '/sources', support: '/support', audit: '/audit' }
const TENANT_TABS = ['overview', 'users', 'models', 'support', 'usage', 'audit'] as const
type TenantTab = typeof TENANT_TABS[number]

function routeFromLocation(): Route {
  const path = decodeURIComponent(location.pathname).replace(/\/+$/u, '') || '/'
  if (path === '/upstreams') return { view: 'models' }
  if (path.startsWith('/tenants/')) {
    const tenantId = path.slice('/tenants/'.length)
    return tenantId === '' ? { view: 'tenants' } : { view: 'tenant', tenantId }
  }
  for (const [view, routePath] of Object.entries(VIEW_PATHS) as Array<[View, string]>) if (routePath === path) return { view }
  return { view: 'overview' }
}

function pathFor(view: View, tenantId?: string): string {
  return view === 'tenant' && tenantId !== undefined ? `/tenants/${encodeURIComponent(tenantId)}` : VIEW_PATHS[view] ?? '/'
}

function tabFromLocation(): TenantTab {
  const value = new URLSearchParams(location.search).get('tab')
  return value !== null && (TENANT_TABS as readonly string[]).includes(value) ? value as TenantTab : 'overview'
}

const NAV_ITEMS: Array<{ view: Exclude<View, 'tenant'>; label: string; icon: LucideIcon; section: 'primary' | 'governance' }> = [
  { view: 'overview', label: 'Overview', section: 'primary', icon: LayoutGrid },
  { view: 'analytics', label: 'Analytics', section: 'primary', icon: BarChart3 },
  { view: 'tenants', label: 'Tenants', section: 'primary', icon: Users },
  { view: 'models', label: 'Models', section: 'primary', icon: Cpu },
  { view: 'sources', label: 'Sources', section: 'primary', icon: Link2 },
  { view: 'support', label: 'Support', section: 'governance', icon: CircleHelp },
  { view: 'audit', label: 'Audit', section: 'governance', icon: ShieldCheck },
]

type ColorSchemeOverride = 'light' | 'dark' | null

function readStoredScheme(): ColorSchemeOverride {
  try {
    const value = localStorage.getItem('siriusx.colorScheme')
    return value === 'light' || value === 'dark' ? value : null
  } catch {
    return null
  }
}

function useColorScheme(): { resolvedScheme: 'light' | 'dark'; toggleScheme: () => void } {
  const [stored, setStored] = React.useState<ColorSchemeOverride>(readStoredScheme)
  const [systemDark, setSystemDark] = React.useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  React.useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onMediaChange = (event: MediaQueryListEvent): void => setSystemDark(event.matches)
    const onStorage = (event: StorageEvent): void => {
      if (event.key === 'siriusx.colorScheme') setStored(readStoredScheme())
    }
    media.addEventListener('change', onMediaChange)
    window.addEventListener('storage', onStorage)
    return () => {
      media.removeEventListener('change', onMediaChange)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  React.useEffect(() => {
    const meta = document.querySelector('meta[name="color-scheme"]')
    if (meta !== null) meta.setAttribute('content', stored ?? 'light dark')
  }, [stored])

  const resolvedScheme: 'light' | 'dark' = stored ?? (systemDark ? 'dark' : 'light')
  const toggleScheme = React.useCallback((): void => {
    const target: 'light' | 'dark' = resolvedScheme === 'dark' ? 'light' : 'dark'
    const systemScheme: 'light' | 'dark' = systemDark ? 'dark' : 'light'
    const next: ColorSchemeOverride = target === systemScheme ? null : target
    try {
      if (next === null) localStorage.removeItem('siriusx.colorScheme')
      else localStorage.setItem('siriusx.colorScheme', next)
    } catch { /* ignore storage restrictions */ }
    setStored(next)
  }, [resolvedScheme, systemDark])

  return { resolvedScheme, toggleScheme }
}

const AUDIT_ACTION_LABELS: Record<string, string> = {
  'upstream.upsert': 'Upstream saved',
  'upstream.delete': 'Upstream deleted',
  'model.create': 'Model created',
  'model.import': 'Models imported',
  'model.delete': 'Model deleted',
  'model.bind': 'Model enabled',
  'model.unbind': 'Model disabled',
  'model.upstream': 'Tenant override added',
  'model.upstream.delete': 'Tenant override deleted',
  'quota.update': 'Quota updated',
  'tenant.status': 'Tenant status changed',
  'tenant.create': 'Tenant created',
  'tenant.update': 'Tenant updated',
  'source.binding.create': 'Source binding added',
  'support.request': 'Support requested',
}

function auditActionLabel(action: string): string { return AUDIT_ACTION_LABELS[action] ?? action.replaceAll('.', ' ') }

function auditDetailSummary(detail: string | null): string {
  if (detail === null || detail === '') return '—'
  try {
    const value: unknown = JSON.parse(detail)
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const row = value as Record<string, unknown>
      if ('maxUsers' in row || 'maxDevices' in row) {
        return `Quota: ${String(row.maxUsers ?? '?')} users / ${String(row.maxDevices ?? '?')} devices / ${String(row.maxCloudTicketsPerDay ?? '?')} cloud/day / ${String(row.maxDeviceTicketsPerDay ?? '?')} device/day`
      }
      return Object.entries(row).map(([key, item]) => `${key}: ${String(item)}`).join(' · ')
    }
  } catch { /* plain text detail */ }
  return detail.length > 120 ? `${detail.slice(0, 120)}…` : detail
}

async function loadAllData(token: string): Promise<AllData> {
  const [tenantResult, upstreamResult, modelResult, bindingResult, supportResult, auditResult] = await Promise.all([
    api<{ tenants: Tenant[] }>(token, '/v1/admin/tenants'),
    api<{ upstreams: PlatformUpstream[] }>(token, '/v1/admin/upstreams'),
    api<{ models: Model[] }>(token, '/v1/admin/models'),
    api<{ bindings: Binding[] }>(token, '/v1/admin/source-bindings'),
    api<{ requests: SupportRequest[] }>(token, '/v1/admin/support-requests'),
    api<{ audit: Audit[] }>(token, '/v1/admin/audit'),
  ])
  return { tenants: tenantResult.tenants, upstreams: upstreamResult.upstreams, models: modelResult.models, bindings: bindingResult.bindings, supportRequests: supportResult.requests, audit: auditResult.audit }
}

export function App(): React.ReactElement {
  return (
    <Toast.Provider>
      <ToastHost />
      <AppInner />
    </Toast.Provider>
  )
}

function AppInner(): React.ReactElement {
  const toast = Toast.useToastManager()
  const [token, setToken] = React.useState(() => sessionStorage.getItem('siriusx.platformToken') ?? '')
  const [data, setData] = React.useState<AllData | null>(null)
  const [error, setError] = React.useState('')
  const [route, setRoute] = React.useState<Route>(routeFromLocation)
  const [revision, setRevision] = React.useState(0)
  const [editor, setEditor] = React.useState<EditorState>()
  const [confirmState, setConfirmState] = React.useState<ConfirmState>()
  const [accessOpen, setAccessOpen] = React.useState(false)

  const notify = React.useCallback((message: string) => { toast.add({ title: message }) }, [toast])
  const closeEditor = React.useCallback(() => setEditor(undefined), [])
  const openEditor = React.useCallback((title: string, content: React.ReactNode, size: 'sm' | 'md' | 'lg' = 'md') => { setEditor({ title, content, size }) }, [])

  const loadAll = React.useCallback(async (): Promise<void> => {
    if (token === '') return
    setError('')
    try { setData(await loadAllData(token)) } catch (reason) { setError(errorText(reason)) }
  }, [token])

  React.useEffect(() => { void loadAll() }, [loadAll])

  React.useEffect(() => {
    const popstate = (): void => setRoute(routeFromLocation())
    window.addEventListener('popstate', popstate)
    return () => window.removeEventListener('popstate', popstate)
  }, [])

  const navigate = React.useCallback((view: View, tenantId?: string): void => {
    const path = pathFor(view, tenantId)
    if (location.pathname + location.search !== path) history.pushState({}, '', path)
    setRoute(tenantId === undefined ? { view } : { view, tenantId })
  }, [])

  const refresh = React.useCallback(async (): Promise<void> => {
    await loadAll()
    setRevision(value => value + 1)
  }, [loadAll])

  const confirmAction = React.useCallback((title: string, message: string, confirmLabel = 'Delete'): Promise<boolean> => {
    return new Promise<boolean>(resolve => setConfirmState({ title, message, confirmLabel, resolve }))
  }, [])

  const connect = React.useCallback(async (value: string): Promise<void> => {
    await api<{ tenants: Tenant[] }>(value, '/v1/admin/tenants')
    sessionStorage.setItem('siriusx.platformToken', value)
    setToken(value)
    setData(null)
    setAccessOpen(false)
  }, [])

  const signOut = React.useCallback((): void => {
    sessionStorage.removeItem('siriusx.platformToken')
    setToken('')
    setData(null)
    setError('')
    setAccessOpen(false)
  }, [])

  const actions: AdminActions = { token, navigate, openEditor, closeEditor, refresh, notify, confirmAction }

  if (token === '') return <AuthScreen onConnect={connect} />

  if (data === null) {
    return (
      <div className="auth-page">
        <Card className="auth-card">
          <h1 className="auth-title">SiriusX Platform</h1>
          {error === '' ? <p className="muted">Loading…</p> : <><p className="form-error" role="alert">{error}</p><div className="form-actions"><Button variant="primary" onClick={() => { void loadAll() }}>Retry</Button><Button variant="ghost" onClick={signOut}>Sign out</Button></div></>}
        </Card>
      </div>
    )
  }

  const currentTenant = route.view === 'tenant' && route.tenantId !== undefined ? data.tenants.find(tenant => tenant.id === route.tenantId) : undefined
  const page = (() => {
    switch (route.view) {
      case 'overview': return <OverviewPage data={data} navigate={navigate} />
      case 'analytics': return <AnalyticsPage actions={actions} revision={revision} />
      case 'tenants': return <TenantsPage data={data} actions={actions} />
      case 'models': return <UpstreamsPage data={data} actions={actions} />
      case 'sources': return <SourcesPage data={data} actions={actions} />
      case 'support': return <SupportPage data={data} />
      case 'audit': return <AuditPage data={data} actions={actions} />
      case 'tenant': return route.tenantId === undefined ? <PageHeader title="Tenant not found" /> : <TenantDetailPage tenantId={route.tenantId} tenant={currentTenant} data={data} revision={revision} actions={actions} />
    }
  })()

  return (
    <>
      <Shell route={route} tenant={currentTenant} pendingSupport={data.supportRequests.filter(request => request.status === 'pending')} error={error} onDismissError={() => setError('')} onAccess={() => setAccessOpen(true)} navigate={navigate}>
        {page}
      </Shell>
      <DialogShell open={editor !== undefined} title={editor?.title ?? ''} size={editor?.size ?? 'md'} onOpenChange={open => { if (!open) closeEditor() }}>
        {editor?.content}
      </DialogShell>
      <ConfirmDialog
        open={confirmState !== undefined}
        title={confirmState?.title ?? ''}
        message={confirmState?.message ?? ''}
        confirmLabel={confirmState?.confirmLabel ?? 'Delete'}
        onConfirm={() => { if (confirmState !== undefined) { confirmState.resolve(true); setConfirmState(undefined) } }}
        onCancel={() => { if (confirmState !== undefined) { confirmState.resolve(false); setConfirmState(undefined) } }}
      />
      <DialogShell open={accessOpen} title="Platform access" size="sm" onOpenChange={setAccessOpen}>
        <AuthForm initialToken={token} onConnect={connect} actions={<Button variant="danger-ghost" onClick={signOut}>Sign out</Button>} />
      </DialogShell>
    </>
  )
}

function AuthScreen({ onConnect }: { onConnect: (token: string) => Promise<void> }): React.ReactElement {
  return (
    <div className="auth-page">
      <Card className="auth-card">
        <p className="eyebrow">SiriusX</p>
        <h1 className="auth-title">Platform administration</h1>
        <p className="muted">Use the platform admin token to continue.</p>
        <AuthForm initialToken="" onConnect={onConnect} />
      </Card>
    </div>
  )
}

function Shell({ route, tenant, pendingSupport, error, onDismissError, onAccess, navigate, children }: {
  route: Route
  tenant: Tenant | undefined
  pendingSupport: SupportRequest[]
  error: string
  onDismissError: () => void
  onAccess: () => void
  navigate: (view: View, tenantId?: string) => void
  children: React.ReactNode
}): React.ReactElement {
  const { resolvedScheme, toggleScheme } = useColorScheme()
  const [collapsed, setCollapsed] = React.useState(() => {
    try { return localStorage.getItem('siriusx.sidebarCollapsed') === '1' } catch { return false }
  })
  const [mobileOpen, setMobileOpen] = React.useState(false)

  React.useEffect(() => {
    if (!mobileOpen) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMobileOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mobileOpen])

  const toggleCollapsed = (): void => {
    setCollapsed(value => {
      const next = !value
      try { localStorage.setItem('siriusx.sidebarCollapsed', next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }

  const go = (view: View, tenantId?: string): void => {
    setMobileOpen(false)
    navigate(view, tenantId)
  }

  const primaryItems = NAV_ITEMS.filter(item => item.section === 'primary')
  const governanceItems = NAV_ITEMS.filter(item => item.section === 'governance')
  const breadcrumb = route.view === 'tenant' ? ['Platform', 'Tenants', tenant?.name ?? route.tenantId ?? 'Tenant'] : ['Platform', VIEW_LABELS[route.view]]
  const renderNavItem = (item: typeof NAV_ITEMS[number]): React.ReactElement => {
    const active = (route.view === 'tenant' ? 'tenants' : route.view) === item.view
    const badgeCount = item.view === 'support' ? pendingSupport.length : 0
    const Icon = item.icon
    return (
      <Button
        key={item.view}
        variant="nav"
        aria-label={item.label}
        title={collapsed ? item.label : undefined}
        aria-current={active ? 'page' : undefined}
        onClick={() => go(item.view)}
      >
        <Icon className="nav-icon" size={16} strokeWidth={1.8} aria-hidden="true" />
        <span className="nav-label">{item.label}</span>
        {badgeCount > 0 ? <span className="nav-badge" aria-label={`${badgeCount} pending`}>{badgeCount}</span> : null}
      </Button>
    )
  }

  return (
    <div className={cx('app-shell', collapsed && 'sidebar-collapsed', mobileOpen && 'mobile-nav-open')}>
      {mobileOpen ? <button type="button" className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setMobileOpen(false)} /> : null}
      <aside className="sidebar">
        <div className="sidebar-head">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">S</span>
            <div className="brand-text"><strong>SiriusX</strong><span>Platform</span></div>
          </div>
          <Button
            variant="nav"
            className="sidebar-toggle"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={toggleCollapsed}
          >
            {collapsed ? <PanelLeftOpen className="nav-icon" size={16} strokeWidth={1.8} aria-hidden="true" /> : <PanelLeftClose className="nav-icon" size={16} strokeWidth={1.8} aria-hidden="true" />}
          </Button>
        </div>
        <nav className="nav" aria-label="Platform administration">
          <div className="nav-group">{primaryItems.map(renderNavItem)}</div>
          <div className="nav-divider" role="separator" />
          <div className="nav-group">{governanceItems.map(renderNavItem)}</div>
        </nav>
        <div className="sidebar-footer">
          <Button
            variant="nav"
            aria-label={resolvedScheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            title={resolvedScheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            onClick={toggleScheme}
          >
            {resolvedScheme === 'dark' ? <Moon className="nav-icon" size={16} strokeWidth={1.8} aria-hidden="true" /> : <Sun className="nav-icon" size={16} strokeWidth={1.8} aria-hidden="true" />}
            <span className="nav-label">{resolvedScheme === 'dark' ? 'Dark' : 'Light'}</span>
          </Button>
          <Button variant="nav" aria-label="Access" title={collapsed ? 'Access' : undefined} onClick={() => { setMobileOpen(false); onAccess() }}>
            <KeyRound className="nav-icon" size={16} strokeWidth={1.8} aria-hidden="true" />
            <span className="nav-label">Access</span>
          </Button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="app-header">
          <div className="header-left">
            <Button variant="ghost" className="mobile-menu-btn" aria-label="Menu" aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)}>
              <Menu size={16} strokeWidth={1.8} aria-hidden="true" />
            </Button>
            <div className="breadcrumb" aria-label="Breadcrumb">{breadcrumb.map((item, index) => <React.Fragment key={`${item}-${index}`}>{index > 0 ? <span className="breadcrumb-sep">/</span> : null}<span>{item}</span></React.Fragment>)}</div>
          </div>
        </header>
        <main className="content">
          {error === '' ? null : <div className="alert" role="alert"><span>{error}</span><Button variant="ghost" onClick={onDismissError}>Dismiss</Button></div>}
          {children}
        </main>
      </div>
    </div>
  )
}

function MetricCard({ value, label, detail, accent = false }: { value: string; label: string; detail: string; accent?: boolean }): React.ReactElement {
  return <div className={cx('metric-card', accent && 'metric-accent')}><strong>{value}</strong><span>{label}</span><small>{detail}</small></div>
}

function OverviewPage({ data, navigate }: { data: AllData; navigate: (view: View, tenantId?: string) => void }): React.ReactElement {
  const active = data.tenants.filter(tenant => tenant.status === 'active').length
  const totalUsers = data.tenants.reduce((total, tenant) => total + tenant.usage.users, 0)
  const totalDevices = data.tenants.reduce((total, tenant) => total + tenant.usage.devices, 0)
  const pendingSupport = data.supportRequests.filter(request => request.status === 'pending').length
  return (
    <>
      <PageHeader
        title="Overview"
        actions={
          <>
            <Button variant="default" onClick={() => navigate('analytics')}>Analytics</Button>
            <Button variant="primary" onClick={() => navigate('tenants')}>Manage tenants</Button>
          </>
        }
      />
      <div className="metric-grid">
        <MetricCard value={String(data.tenants.length)} label="tenants" detail={`${active} active`} accent />
        <MetricCard value={String(totalUsers)} label="users" detail="across tenants" />
        <MetricCard value={String(totalDevices)} label="devices" detail="paired" />
        <MetricCard value={String(data.models.length)} label="models" detail={`${data.upstreams.length} upstreams`} />
        <MetricCard value={String(pendingSupport)} label="pending support" detail={`${data.audit.length} audit events`} />
      </div>
      <Card>
        <SectionHeading title="Recent tenants" actions={<Button variant="ghost" onClick={() => navigate('tenants')}>View all</Button>} />
        <DataTable headers={['Name', 'Tenant', 'Status', 'Users']} empty="No tenants yet." rows={data.tenants.slice(0, 5).map(tenant => [tenant.name, <span className="mono" key="id">{tenant.id}</span>, <StatusPill key="status" status={tenant.status} />, String(tenant.usage.users)])} />
      </Card>
    </>
  )
}

function ServiceHealthItem({ name, probe, extra }: { name: string; probe: ServiceProbe; extra?: string }): React.ReactElement {
  const status = !probe.configured ? 'Unconfigured' : probe.ok ? 'Healthy' : 'Unreachable'
  const pillClass = !probe.configured ? 'pill' : probe.ok ? 'pill pill-active' : 'pill pill-suspended'
  return (
    <div className="service-card">
      <div className="service-card-top">
        <strong>{name}</strong>
        <span className={pillClass}>{status}</span>
      </div>
      <div className="service-card-meta">
        <span>{probe.latencyMs === null ? '—' : `${probe.latencyMs} ms`}</span>
        {extra === undefined ? null : <span>{extra}</span>}
      </div>
    </div>
  )
}

function UsageBarChart({ daily }: { daily: PlatformAnalytics['daily'] }): React.ReactElement {
  const totalCloud = daily.reduce((sum, item) => sum + item.cloudTickets, 0)
  const totalDevice = daily.reduce((sum, item) => sum + item.deviceTickets, 0)
  const hasActivity = totalCloud + totalDevice > 0
  const peak = Math.max(1, ...daily.map(item => item.cloudTickets + item.deviceTickets))
  const labelEvery = daily.length <= 7 ? 1 : daily.length <= 14 ? 2 : 5
  return (
    <figure className="chart-figure" aria-label={`Daily tickets chart: ${totalCloud} cloud tickets and ${totalDevice} device tickets over ${daily.length} days`}>
      <div className="chart-head">
        <div className="chart-legend">
          <span className="legend-item"><span className="legend-dot legend-cloud" aria-hidden="true" />Cloud tickets ({totalCloud})</span>
          <span className="legend-item"><span className="legend-dot legend-device" aria-hidden="true" />Device tickets ({totalDevice})</span>
        </div>
        <span className="muted">Peak: {hasActivity ? peak : 0}/day</span>
      </div>
      <div className={cx('bar-chart', !hasActivity && 'bar-chart-empty')} role="img" aria-label={`Ticket volume over the last ${daily.length} days`}>
        {hasActivity ? null : <span className="bar-empty-note">No ticket activity in this window</span>}
        {daily.map((day, index) => {
          const total = day.cloudTickets + day.deviceTickets
          const cloudPct = total === 0 ? 0 : Math.round((day.cloudTickets / peak) * 100)
          const devicePct = total === 0 ? 0 : Math.round((day.deviceTickets / peak) * 100)
          const showLabel = index % labelEvery === 0 || index === daily.length - 1
          return (
            <div className="bar-col" key={day.date} title={`${day.date}: ${day.cloudTickets} cloud, ${day.deviceTickets} device`}>
              <div className="bar-track">
                <div className="bar-stack" style={{ height: `${Math.max(total > 0 ? 6 : 0, cloudPct + devicePct)}%` }}>
                  {day.deviceTickets > 0 ? <span className="bar-seg bar-device" style={{ flexGrow: day.deviceTickets }} /> : null}
                  {day.cloudTickets > 0 ? <span className="bar-seg bar-cloud" style={{ flexGrow: day.cloudTickets }} /> : null}
                </div>
              </div>
              <span className="bar-label">{showLabel ? day.date.slice(5) : ''}</span>
            </div>
          )
        })}
      </div>
    </figure>
  )
}

function AnalyticsPage({ actions, revision }: { actions: AdminActions; revision: number }): React.ReactElement {
  const [days, setDays] = React.useState<7 | 14 | 30>(14)
  const [analytics, setAnalytics] = React.useState<PlatformAnalytics>()
  const [loading, setLoading] = React.useState(true)
  const [localError, setLocalError] = React.useState('')

  const loadAnalytics = React.useCallback(async (windowDays: number): Promise<void> => {
    setLoading(true)
    setLocalError('')
    try {
      setAnalytics(await api<PlatformAnalytics>(actions.token, `/v1/admin/analytics?days=${windowDays}`))
    } catch (reason) {
      setLocalError(errorText(reason))
    } finally {
      setLoading(false)
    }
  }, [actions.token])

  React.useEffect(() => { void loadAnalytics(days) }, [loadAnalytics, days, revision])

  const toolExtra = analytics?.services.toolGateway.configured
    ? analytics.services.toolGateway.auditChainValid === false
      ? 'Audit chain broken'
      : analytics.services.toolGateway.audits !== undefined
        ? `${analytics.services.toolGateway.audits} audits · ${analytics.services.toolGateway.approvalsPending ?? 0} pending`
        : undefined
    : undefined

  return (
    <>
      <PageHeader
        title="Analytics"
        actions={
          <div className="analytics-controls">
            <div className="segmented" role="group" aria-label="Time range">
              {([7, 14, 30] as const).map(option => (
                <button
                  key={option}
                  type="button"
                  className={cx('segmented-btn', days === option && 'is-active')}
                  onClick={() => setDays(option)}
                >
                  {option}d
                </button>
              ))}
            </div>
            <Button variant="default" disabled={loading} onClick={() => { void loadAnalytics(days) }}>
              <RefreshCw size={14} strokeWidth={2} aria-hidden="true" />
              <span>{loading ? 'Refreshing…' : 'Refresh'}</span>
            </Button>
          </div>
        }
      />
      {localError === '' ? null : <div className="alert" role="alert">{localError}</div>}
      {analytics === undefined ? (
        <Card><p className="muted">Loading platform telemetry…</p></Card>
      ) : (
        <>
          <div className="service-grid">
            <ServiceHealthItem name="Control Plane" probe={analytics.services.controlPlane} extra="SQLite / PG" />
            <ServiceHealthItem name="Tool Gateway" probe={analytics.services.toolGateway} {...(toolExtra === undefined ? {} : { extra: toolExtra })} />
            <ServiceHealthItem name="Model Router" probe={analytics.services.modelRouter} />
          </div>

          <div className="metric-grid">
            <MetricCard
              value={String(analytics.totals.cloudTicketsToday + analytics.totals.deviceTicketsToday)}
              label="tickets today"
              detail={`${analytics.totals.cloudTicketsToday} cloud · ${analytics.totals.deviceTicketsToday} device`}
              accent
            />
            <MetricCard
              value={String(analytics.totals.activeDevices)}
              label="active devices (15m)"
              detail={`${analytics.totals.devices} paired total`}
            />
            <MetricCard
              value={String(analytics.totals.modelRequests)}
              label="gateway requests"
              detail={`${analytics.totals.modelErrors} errors (since boot)`}
            />
            <MetricCard
              value={String(analytics.totals.sourceEvents)}
              label="source events"
              detail={`${analytics.totals.activeTenants}/${analytics.totals.tenants} tenants active`}
            />
          </div>

          <Card>
            <SectionHeading title={`Ticket activity (${analytics.days}d)`} />
            <UsageBarChart daily={analytics.daily} />
          </Card>

          <div className="analytics-grid">
            <Card>
              <SectionHeading title="Tenant quota pressure & 30d estimate" />
              <DataTable
                headers={['Tenant', 'Users', 'Today tickets', 'Peak quota', 'Est. 30d']}
                columnClasses={[undefined, 'col-num', 'col-num', undefined, 'col-num']}
                empty="No tenants yet."
                rows={analytics.tenants.map(tenant => [
                  <button key="name" type="button" className="table-link" onClick={() => actions.navigate('tenant', tenant.id)}>{tenant.name}</button>,
                  `${tenant.users}/${tenant.maxUsers}`,
                  `${tenant.cloudTicketsToday + tenant.deviceTicketsToday}/${tenant.maxCloudTicketsPerDay + tenant.maxDeviceTicketsPerDay}`,
                  <span key="util" className={cx('pill', tenant.maxUtilizationPct >= 80 ? 'pill-suspended' : tenant.maxUtilizationPct >= 50 ? '' : 'pill-active')}>{tenant.maxUtilizationPct}%</span>,
                  `${(tenant.estimatedCents / 100).toFixed(2)} ${tenant.currency}`,
                ])}
              />
            </Card>
            <Card>
              <SectionHeading title="Model adoption & gateway latency" />
              <DataTable
                headers={['Model', 'Tenants', 'Requests', 'Avg latency']}
                columnClasses={[undefined, 'col-num', 'col-num', 'col-num']}
                empty="No catalog models yet."
                rows={analytics.models.map(model => [
                  <div className="cell-identity" key="identity">
                    <strong>{model.name}</strong>
                    <span className="mono muted">{model.upstreamName ?? model.id}</span>
                  </div>,
                  `${model.tenantCount}${model.defaultCount > 0 ? ` (${model.defaultCount} def)` : ''}`,
                  `${model.requests}${model.errors > 0 ? ` (${model.errors} err)` : ''}`,
                  model.avgLatencyMs === null ? '—' : `${model.avgLatencyMs} ms`,
                ])}
              />
            </Card>
          </div>

          <Card>
            <SectionHeading title="Recent source webhook events" actions={<Activity size={15} className="muted" aria-hidden="true" />} />
            <DataTable
              headers={['Time', 'Provider', 'Tenant', 'Event', 'Status', 'Ticket']}
              empty="No source webhook events received yet."
              rows={analytics.recentSourceEvents.map(event => [
                new Date(event.receivedAt).toLocaleString(),
                event.provider,
                event.tenantId ?? '—',
                event.eventType,
                <StatusPill key="status" status={event.status === 'dispatched' ? 'active' : event.status} />,
                event.ticketId === null ? '—' : <span className="mono" key="ticket">{event.ticketId}</span>,
              ])}
            />
          </Card>
        </>
      )}
    </>
  )
}

function TenantsPage({ data, actions }: { data: AllData; actions: AdminActions }): React.ReactElement {
  const [query, setQuery] = React.useState('')
  const [status, setStatus] = React.useState('')
  const normalized = query.trim().toLowerCase()
  const filtered = data.tenants.filter(tenant => {
    const matchesQuery = normalized === '' || `${tenant.name} ${tenant.id} ${tenant.idpIssuer}`.toLowerCase().includes(normalized)
    return matchesQuery && (status === '' || tenant.status === status)
  })
  const createTenant = (): void => {
    actions.openEditor('Create tenant', <CreateTenantForm onSubmit={async values => {
      const tenantId = valueOf(values, 'tenantId').trim()
      await api(actions.token, '/v1/admin/tenants', { method: 'POST', body: JSON.stringify({ name: valueOf(values, 'name'), idpIssuer: valueOf(values, 'idpIssuer'), adminEmail: valueOf(values, 'adminEmail'), ...(tenantId === '' ? {} : { tenantId }) }) })
      actions.closeEditor()
      await actions.refresh()
      actions.notify('Tenant created')
    }} />)
  }
  const toggleTenantStatus = async (tenant: Tenant): Promise<void> => {
    const suspending = tenant.status === 'active'
    if (suspending && !await actions.confirmAction(
      `Suspend ${tenant.name}?`,
      `Active members and integrations for ${tenant.id} will be blocked until resumed.`,
      'Suspend',
    )) return
    await api(actions.token, `/v1/admin/tenants/${encodeURIComponent(tenant.id)}/status`, {
      method: 'POST',
      body: JSON.stringify({ status: suspending ? 'suspended' : 'active' }),
    })
    await actions.refresh()
    actions.notify(suspending ? 'Tenant suspended' : 'Tenant resumed')
  }
  return (
    <>
      <PageHeader title="Tenants" actions={<Button variant="primary" onClick={createTenant}>+ New tenant</Button>} />
      <Card className="table-card">
        <TenantFilters total={filtered.length} onChange={(nextQuery, nextStatus) => { setQuery(nextQuery); setStatus(nextStatus) }} />
        <DataTable
          headers={['Tenant', 'Status', 'Users', 'Actions']}
          columnClasses={[undefined, undefined, 'col-num', 'col-actions']}
          empty="No tenants match these filters."
          rows={filtered.map(tenant => [
            <div className="cell-identity" key="identity">
              <button type="button" className="table-link" onClick={() => actions.navigate('tenant', tenant.id)}>{tenant.name}</button>
              <span className="mono muted">{tenant.id}</span>
            </div>,
            <StatusPill key="status" status={tenant.status} />,
            String(tenant.usage.users),
            <div className="row-actions" key="actions">
              <Button variant="default" onClick={() => actions.navigate('tenant', tenant.id)}>Open</Button>
              <Button
                variant={tenant.status === 'active' ? 'danger-ghost' : 'default'}
                onClick={() => { void toggleTenantStatus(tenant).catch(reason => actions.notify(errorText(reason))) }}
              >
                {tenant.status === 'active' ? 'Suspend' : 'Resume'}
              </Button>
            </div>,
          ])}
        />
      </Card>
    </>
  )
}

function UpstreamsPage({ data, actions }: { data: AllData; actions: AdminActions }): React.ReactElement {
  const [tenantId, setTenantId] = React.useState(data.tenants[0]?.id ?? '')
  const [tenantUpstreams, setTenantUpstreams] = React.useState<Upstream[]>([])
  const [loadingOverrides, setLoadingOverrides] = React.useState(false)
  const [overrideError, setOverrideError] = React.useState('')
  const [fetchingId, setFetchingId] = React.useState<string>()

  const loadOverrides = React.useCallback(async (id: string): Promise<void> => {
    if (id === '') { setTenantUpstreams([]); return }
    setLoadingOverrides(true); setOverrideError('')
    try { setTenantUpstreams((await api<{ upstreams: Upstream[] }>(actions.token, `/v1/admin/tenants/${encodeURIComponent(id)}/model-upstreams`)).upstreams) }
    catch (reason) { setOverrideError(errorText(reason)) }
    finally { setLoadingOverrides(false) }
  }, [actions.token])

  React.useEffect(() => { void loadOverrides(tenantId) }, [loadOverrides, tenantId])

  const upstreamOptions: SelectOption[] = data.upstreams.map(upstream => ({ value: upstream.id, label: `${upstream.name} (${upstream.protocol})` }))
  const addPlatformUpstream = (): void => {
    actions.openEditor('Add upstream', <PlatformUpstreamForm onSubmit={async values => {
      const key = valueOf(values, 'apiKey').trim()
      await api(actions.token, '/v1/admin/upstreams', {
        method: 'POST',
        body: JSON.stringify({
          name: valueOf(values, 'name'),
          protocol: valueOf(values, 'protocol'),
          baseUrl: valueOf(values, 'baseUrl'),
          ...(key === '' ? {} : { apiKey: key }),
          enabled: values.enabled === true || values.enabled === 'on' || values.enabled === 'true',
        }),
      })
      actions.closeEditor()
      await actions.refresh()
      actions.notify('Upstream added')
    }} />)
  }

  const editPlatformUpstream = (upstream: PlatformUpstream): void => {
    actions.openEditor(`Edit ${upstream.name}`, <PlatformUpstreamForm
      initial={{ name: upstream.name, protocol: upstream.protocol, baseUrl: upstream.baseUrl, hasApiKey: upstream.hasApiKey, enabled: upstream.enabled }}
      onSubmit={async values => {
        const key = valueOf(values, 'apiKey').trim()
        await api(actions.token, `/v1/admin/upstreams/${encodeURIComponent(upstream.id)}`, {
          method: 'PUT',
          body: JSON.stringify({
            name: valueOf(values, 'name'),
            protocol: valueOf(values, 'protocol'),
            baseUrl: valueOf(values, 'baseUrl'),
            ...(key === '' ? {} : { apiKey: key }),
            enabled: values.enabled === true || values.enabled === 'on' || values.enabled === 'true',
          }),
        })
        actions.closeEditor()
        await actions.refresh()
        actions.notify('Upstream updated')
      }}
    />)
  }

  const removePlatformUpstream = async (upstream: PlatformUpstream): Promise<void> => {
    if (!await actions.confirmAction('Delete upstream?', `Delete ${upstream.name}? Models linked to it must be deleted first.`)) return
    await api(actions.token, `/v1/admin/upstreams/${encodeURIComponent(upstream.id)}`, { method: 'DELETE' })
    await actions.refresh()
    actions.notify('Upstream deleted')
  }

  const fetchUpstreamModels = async (upstream: PlatformUpstream): Promise<void> => {
    setFetchingId(upstream.id)
    try {
      const result = await api<{ models: FetchedUpstreamModel[] }>(actions.token, `/v1/admin/upstreams/${encodeURIComponent(upstream.id)}/fetch-models`, { method: 'POST' })
      if (result.models.length === 0) {
        actions.notify('No models returned by upstream')
        return
      }
      actions.openEditor(`Fetch models · ${upstream.name}`, <ImportUpstreamModelsForm
        models={result.models}
        onImport={async selected => {
          const imported = await api<{ added: string[] }>(actions.token, `/v1/admin/upstreams/${encodeURIComponent(upstream.id)}/models`, {
            method: 'POST',
            body: JSON.stringify({ models: selected.map(item => ({ model: item.model, name: item.name })) }),
          })
          actions.closeEditor()
          await actions.refresh()
          actions.notify(`Imported ${imported.added.length} model${imported.added.length === 1 ? '' : 's'}`)
        }}
      />, 'md')
    } finally {
      setFetchingId(undefined)
    }
  }

  const addModel = (): void => {
    actions.openEditor('Add model', <CreateModelForm upstreams={upstreamOptions} onSubmit={async values => {
      const id = valueOf(values, 'id').trim()
      const upstreamId = valueOf(values, 'upstreamId').trim()
      await api(actions.token, '/v1/admin/models', {
        method: 'POST',
        body: JSON.stringify({
          ...(id === '' ? {} : { id }),
          ...(upstreamId === '' ? {} : { upstreamId }),
          name: valueOf(values, 'name'),
          provider: valueOf(values, 'provider'),
          model: valueOf(values, 'model'),
        }),
      })
      actions.closeEditor()
      await actions.refresh()
      actions.notify('Model added')
    }} />)
  }

  const removeModel = async (model: Model): Promise<void> => {
    if (!await actions.confirmAction('Delete model?', `Delete ${model.name} (${model.id})? Tenants using it will lose access (protected if set as a tenant default).`)) return
    await api(actions.token, `/v1/admin/models/${encodeURIComponent(model.id)}`, { method: 'DELETE' })
    await actions.refresh()
    actions.notify('Model deleted')
  }

  const tenantOptions: SelectOption[] = data.tenants.map(tenant => ({ value: tenant.id, label: `${tenant.name} · ${tenant.id}` }))
  const addOverride = async (): Promise<void> => {
    if (tenantId === '') throw new Error('select a tenant first')
    const bound = await api<{ models: Array<{ id: string }> }>(actions.token, `/v1/admin/tenants/${encodeURIComponent(tenantId)}/models`)
    const modelIds = bound.models.map(model => model.id)
    if (modelIds.length === 0) throw new Error('enable a model for this tenant first')
    actions.openEditor('Add tenant upstream override', <AddUpstreamForm models={modelIds} onSubmit={async values => {
      const modelId = valueOf(values, 'modelId')
      if (modelId === '') throw new Error('enable a model for this tenant first')
      const key = valueOf(values, 'apiKey')
      await api(actions.token, `/v1/admin/tenants/${encodeURIComponent(tenantId)}/models/${encodeURIComponent(modelId)}/upstreams`, { method: 'POST', body: JSON.stringify({ name: valueOf(values, 'name'), protocol: valueOf(values, 'protocol'), baseUrl: valueOf(values, 'baseUrl'), upstreamModel: valueOf(values, 'upstreamModel'), ...(key === '' ? {} : { apiKey: key }), priority: numberValue(values, 'priority'), enabled: values.enabled === true || values.enabled === 'on' || values.enabled === 'true' }) })
      actions.closeEditor()
      await loadOverrides(tenantId)
      actions.notify('Tenant override added')
    }} />)
  }

  return (
    <>
      <PageHeader
        title="Upstreams & models"
        actions={
          <>
            <Button variant="default" onClick={addModel}>+ Add model</Button>
            <Button variant="primary" onClick={addPlatformUpstream}>+ Add upstream</Button>
          </>
        }
      />
      <Card>
        <SectionHeading title="Platform upstreams" />
        <DataTable
          headers={['Name', 'Protocol', 'Base URL', 'Key', 'Models', 'Status', 'Actions']}
          columnClasses={[undefined, undefined, undefined, undefined, 'col-num', undefined, 'col-actions']}
          empty="No platform upstreams yet. Add one and fetch its models."
          rows={data.upstreams.map(upstream => [
            upstream.name,
            upstream.protocol,
            <span className="mono" key="url">{upstream.baseUrl}</span>,
            upstream.hasApiKey ? 'configured' : '—',
            String(upstream.modelCount),
            <StatusPill key="status" status={upstream.enabled ? 'active' : 'suspended'} />,
            <div className="row-actions" key="actions">
              <Button variant="primary" disabled={fetchingId === upstream.id} onClick={() => { void fetchUpstreamModels(upstream).catch(reason => actions.notify(errorText(reason))) }}>
                {fetchingId === upstream.id ? 'Fetching…' : 'Fetch models'}
              </Button>
              <Button variant="default" onClick={() => editPlatformUpstream(upstream)}>Edit</Button>
              <Button variant="danger-ghost" onClick={() => { void removePlatformUpstream(upstream).catch(reason => actions.notify(errorText(reason))) }}>Delete</Button>
            </div>,
          ])}
        />
      </Card>
      <Card>
        <SectionHeading title="Catalog models" />
        <DataTable
          headers={['Model', 'Upstream', 'Upstream model', 'Actions']}
          columnClasses={[undefined, undefined, undefined, 'col-actions']}
          empty="No models yet. Fetch from an upstream or add one manually."
          rows={data.models.map(model => [
            <div className="cell-identity" key="identity">
              <strong>{model.name}</strong>
              <span className="mono muted">{model.id}</span>
            </div>,
            model.upstreamName ?? <span className="muted" key="none">—</span>,
            <span className="mono" key="model">{model.model}</span>,
            model.id === 'tenant-default'
              ? <span className="muted" key="builtin">Built-in</span>
              : <Button key="delete" variant="danger-ghost" onClick={() => { void removeModel(model).catch(reason => actions.notify(errorText(reason))) }}>Delete</Button>,
          ])}
        />
      </Card>
      <Card>
        <Collapsible.Root>
          <div className="section-heading">
            <h2>Tenant-specific overrides</h2>
            <Collapsible.Trigger className="btn btn-ghost">Toggle</Collapsible.Trigger>
          </div>
          <Collapsible.Panel className="collapsible-panel override-panel">
            <div className="toolbar filter-bar">
              <SelectField name="upstreamTenant" label="Tenant" options={tenantOptions} value={tenantId} onValueChange={setTenantId} className="filter-field filter-grow" />
              <Button variant="default" onClick={() => { void addOverride().catch(reason => actions.notify(errorText(reason))) }}>+ Add override</Button>
            </div>
            {overrideError === '' ? null : <div className="alert" role="alert">{overrideError}</div>}
            <DataTable
              headers={['Model', 'Name', 'Protocol', 'URL', 'Upstream model', 'Priority', 'Enabled', 'Key', '']}
              empty={loadingOverrides ? 'Loading…' : 'No tenant overrides configured.'}
              rows={tenantUpstreams.map(upstream => [
                <span className="mono" key="model">{upstream.modelId}</span>,
                upstream.name,
                upstream.protocol,
                upstream.baseUrl,
                upstream.upstreamModel,
                String(upstream.priority),
                String(upstream.enabled),
                upstream.hasApiKey ? 'configured' : '—',
                <Button key="delete" variant="danger-ghost" onClick={() => { void (async () => {
                  if (!await actions.confirmAction('Delete override?', `Delete ${upstream.name} from ${upstream.modelId}?`)) return
                  await api(actions.token, `/v1/admin/tenants/${encodeURIComponent(tenantId)}/models/${encodeURIComponent(upstream.modelId)}/upstreams/${encodeURIComponent(upstream.id)}`, { method: 'DELETE' })
                  await loadOverrides(tenantId)
                  actions.notify('Tenant override deleted')
                })().catch(reason => actions.notify(errorText(reason))) }}>Delete</Button>,
              ])}
            />
          </Collapsible.Panel>
        </Collapsible.Root>
      </Card>
    </>
  )
}

function SourcesPage({ data, actions }: { data: AllData; actions: AdminActions }): React.ReactElement {
  const addBinding = (): void => {
    actions.openEditor('Add source binding', <CreateBindingForm onSubmit={async values => {
      const repo = valueOf(values, 'repoUrl').trim()
      const base = valueOf(values, 'baseRef').trim()
      await api(actions.token, '/v1/admin/source-bindings', { method: 'POST', body: JSON.stringify({ provider: valueOf(values, 'provider'), externalId: valueOf(values, 'externalId'), tenantId: valueOf(values, 'tenantId'), ...(repo === '' ? {} : { repoUrl: repo }), ...(base === '' ? {} : { baseRef: base }), autoDispatch: values.autoDispatch === true || values.autoDispatch === 'on' }) })
      actions.closeEditor()
      await actions.refresh()
      actions.notify('Source binding added')
    }} />)
  }
  return (
    <>
      <PageHeader title="Sources" actions={<Button variant="primary" onClick={addBinding}>+ Add source binding</Button>} />
      <Card><DataTable headers={['ID', 'Provider', 'External', 'Tenant', 'Repo', 'Base', 'Auto']} empty="No source bindings yet." rows={data.bindings.map(binding => [<span className="mono" key="id">{binding.id}</span>, binding.provider, binding.externalId, binding.tenantId, binding.repoUrl ?? '', binding.baseRef ?? '', String(binding.autoDispatch)])} /></Card>
    </>
  )
}

function SupportPage({ data }: { data: AllData }): React.ReactElement {
  return (
    <>
      <PageHeader title="Support requests" />
      <Card><DataTable headers={['Tenant', 'Reason', 'Status', 'Requested by']} empty="No support requests." rows={data.supportRequests.map(request => [request.tenantId, request.reason, request.status, request.requestedBy])} /></Card>
    </>
  )
}

function AuditPage({ data, actions }: { data: AllData; actions: AdminActions }): React.ReactElement {
  const [filter, setFilter] = React.useState<AuditFilterValue>({ query: '', action: '', range: 'all' })
  const [page, setPage] = React.useState(1)
  const pageSize = 20
  const now = Date.now()
  const since = filter.range === '24h' ? now - 86_400_000 : filter.range === '7d' ? now - 7 * 86_400_000 : filter.range === '30d' ? now - 30 * 86_400_000 : 0
  const query = filter.query.trim().toLowerCase()
  const filtered = data.audit
    .filter(event => (filter.action === '' || event.action === filter.action) && event.createdAt >= since)
    .filter(event => query === '' || `${event.actor} ${event.action} ${event.target} ${event.detail ?? ''}`.toLowerCase().includes(query))
    .sort((left, right) => right.createdAt - left.createdAt)
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(Math.max(page, 1), pageCount)
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const rows = visible.map(event => {
    const detail = event.detail === null || event.detail === '' ? <span className="muted">—</span> : <div className="audit-detail"><span>{auditDetailSummary(event.detail)}</span>{auditDetailSummary(event.detail) === event.detail ? null : <Collapsible.Root><Collapsible.Trigger className="btn btn-ghost collapsible-trigger">Show JSON</Collapsible.Trigger><Collapsible.Panel className="collapsible-panel"><pre>{event.detail}</pre></Collapsible.Panel></Collapsible.Root>}</div>
    const tenantId = event.target.split('/')[0] ?? ''
    const target = tenantId.startsWith('tenant-') ? <Button variant="ghost" onClick={() => actions.navigate('tenant', tenantId)}>{event.target}</Button> : <span className="mono">{event.target}</span>
    return [new Date(event.createdAt).toLocaleString(), event.actor, auditActionLabel(event.action), target, detail]
  })
  const exportAudit = async (): Promise<void> => {
    const response = await fetch('/v1/admin/audit/export?format=csv', { headers: { 'x-siriusx-platform-token': actions.token } })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const link = document.createElement('a')
    link.href = URL.createObjectURL(await response.blob())
    link.download = 'siriusx-platform-audit.csv'
    link.click()
    URL.revokeObjectURL(link.href)
  }
  return (
    <>
      <PageHeader title="Platform audit" actions={<Button variant="ghost" onClick={() => { void exportAudit().catch(reason => actions.notify(errorText(reason))) }}>Export CSV</Button>} />
      <AuditFilters actions={[...new Set(data.audit.map(event => event.action))].sort()} onChange={value => { setFilter(value); setPage(1) }} />
      <Card>
        <DataTable headers={['Time', 'Actor', 'Action', 'Target', 'Detail']} empty="No audit events match these filters." rows={rows} />
        <div className="pagination">
          <span className="muted">Showing {filtered.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filtered.length)} of {filtered.length}</span>
          <div className="pagination-controls">
            <Button variant="ghost" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Previous</Button>
            {Array.from({ length: pageCount }, (_, index) => index + 1).map(item => <Button key={item} variant={item === currentPage ? 'primary' : 'ghost'} onClick={() => setPage(item)}>{item}</Button>)}
            <Button variant="ghost" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>Next</Button>
          </div>
        </div>
      </Card>
    </>
  )
}

function TenantDetailPage({ tenantId, tenant, data, revision, actions }: { tenantId: string; tenant: Tenant | undefined; data: AllData; revision: number; actions: AdminActions }): React.ReactElement {
  const [detail, setDetail] = React.useState<TenantDetailData>()
  const [detailError, setDetailError] = React.useState('')
  const [tab, setTab] = React.useState<TenantTab>(tabFromLocation)

  const loadDetail = React.useCallback(async (): Promise<void> => {
    setDetailError('')
    try {
      const [userResult, quotaResult, dailyResult, billingResult, tenantModelResult, auditResult] = await Promise.all([
        api<{ users: User[] }>(actions.token, `/v1/admin/tenants/${encodeURIComponent(tenantId)}/users`),
        api<{ quota: Quota }>(actions.token, `/v1/admin/tenants/${encodeURIComponent(tenantId)}/quota`),
        api<{ usage: Array<{ date: string; cloudTickets: number; deviceTickets: number }> }>(actions.token, `/v1/admin/tenants/${encodeURIComponent(tenantId)}/usage-daily?days=14`),
        api<{ billing: Billing; estimate: { estimatedCents: number; currency: string } }>(actions.token, `/v1/admin/tenants/${encodeURIComponent(tenantId)}/billing`),
        api<{ models: TenantModel[] }>(actions.token, `/v1/admin/tenants/${encodeURIComponent(tenantId)}/models`),
        api<{ total: number; decisions: Record<string, number> }>(actions.token, `/v1/admin/tenants/${encodeURIComponent(tenantId)}/audit-summary`).catch(() => ({ total: 0, decisions: {} })),
      ])
      setDetail({ users: userResult.users, quota: quotaResult.quota, usageDaily: dailyResult.usage, billing: billingResult.billing, estimate: billingResult.estimate, models: tenantModelResult.models, auditSummary: auditResult })
    } catch (reason) { setDetailError(errorText(reason)) }
  }, [actions.token, tenantId])

  React.useEffect(() => { void loadDetail() }, [loadDetail, revision])

  React.useEffect(() => {
    const url = new URL(location.href)
    if (tab === 'overview') url.searchParams.delete('tab')
    else url.searchParams.set('tab', tab)
    history.replaceState({}, '', `${url.pathname}${url.search}`)
  }, [tab])

  if (tenant === undefined) return <><PageHeader title="Tenant not found" /><Button variant="ghost" onClick={() => actions.navigate('tenants')}>Back to tenants</Button></>
  if (detail === undefined) return <><PageHeader title={tenant.name} /><Card>{detailError === '' ? <p className="muted">Loading…</p> : <><p className="form-error">{detailError}</p><Button variant="primary" onClick={() => { void loadDetail() }}>Retry</Button></>}</Card></>

  const visibleModels = detail.models.filter(model => model.id !== 'tenant-default')
  const defaultModel = detail.models.find(model => model.isDefault)
  const bound = new Map(visibleModels.map(model => [model.id, model]))
  const availableModels = data.models.filter(model => model.id !== 'tenant-default' && !bound.has(model.id))
  const initial: TenantInitialValues = { name: tenant.name, idpIssuer: tenant.idpIssuer, quota: detail.quota, billing: detail.billing, models: detail.models.map(model => model.id) }
  const refresh = async (message: string): Promise<void> => { await actions.refresh(); actions.notify(message) }
  const openProfile = (): void => { actions.openEditor('Edit tenant profile', <TenantProfileForm initial={initial} onSubmit={async values => { await api(actions.token, `/v1/admin/tenants/${encodeURIComponent(tenant.id)}`, { method: 'PUT', body: JSON.stringify({ name: valueOf(values, 'name'), idpIssuer: valueOf(values, 'idpIssuer') }) }); actions.closeEditor(); await refresh('Tenant updated') }} />) }
  const openQuota = (): void => { actions.openEditor('Edit tenant quota', <TenantQuotaForm initial={initial} onSubmit={async values => { await api(actions.token, `/v1/admin/tenants/${encodeURIComponent(tenant.id)}/quota`, { method: 'PUT', body: JSON.stringify({ maxUsers: numberValue(values, 'maxUsers'), maxDevices: numberValue(values, 'maxDevices'), maxCloudTicketsPerDay: numberValue(values, 'maxCloudTicketsPerDay'), maxDeviceTicketsPerDay: numberValue(values, 'maxDeviceTicketsPerDay') }) }); actions.closeEditor(); await refresh('Quota updated') }} />) }
  const openBilling = (): void => { actions.openEditor('Edit tenant billing', <TenantBillingForm initial={initial} onSubmit={async values => { const budget = valueOf(values, 'monthlyBudgetCents').trim(); await api(actions.token, `/v1/admin/tenants/${encodeURIComponent(tenant.id)}/billing`, { method: 'PUT', body: JSON.stringify({ currency: valueOf(values, 'currency'), cloudTicketCents: numberValue(values, 'cloudTicketCents'), deviceTicketCents: numberValue(values, 'deviceTicketCents'), monthlyBudgetCents: budget === '' ? null : numberValue(values, 'monthlyBudgetCents') }) }); actions.closeEditor(); await refresh('Billing updated') }} />) }
  const addUser = (): void => { actions.openEditor('Add tenant user', <AddTenantUserForm onSubmit={async values => { await api(actions.token, `/v1/admin/tenants/${encodeURIComponent(tenant.id)}/users`, { method: 'POST', body: JSON.stringify({ email: valueOf(values, 'email'), role: valueOf(values, 'role') }) }); actions.closeEditor(); await refresh('User added') }} />) }
  const requestSupport = (): void => { actions.openEditor('Request support access', <RequestSupportForm onSubmit={async values => { await api(actions.token, `/v1/admin/tenants/${encodeURIComponent(tenant.id)}/support-requests`, { method: 'POST', body: JSON.stringify({ reason: valueOf(values, 'reason') }) }); actions.closeEditor(); await refresh('Support request sent') }} />) }
  const setDefault = async (modelId: string): Promise<void> => { await api(actions.token, `/v1/admin/tenants/${encodeURIComponent(tenant.id)}/models/${encodeURIComponent(modelId)}`, { method: 'PUT', body: JSON.stringify({ isDefault: true }) }); await refresh('Default model updated') }
  const enableModel = async (modelId: string): Promise<void> => { await api(actions.token, `/v1/admin/tenants/${encodeURIComponent(tenant.id)}/models/${encodeURIComponent(modelId)}`, { method: 'PUT', body: JSON.stringify({ isDefault: defaultModel === undefined }) }); await refresh('Model enabled') }
  const disableModel = async (model: TenantModel): Promise<void> => { if (!await actions.confirmAction('Disable model?', `${model.name} will no longer be selectable by this tenant's members.`, 'Disable')) return; await api(actions.token, `/v1/admin/tenants/${encodeURIComponent(tenant.id)}/models/${encodeURIComponent(model.id)}`, { method: 'DELETE' }); await refresh('Model disabled') }
  const toggleStatus = async (): Promise<void> => { await api(actions.token, `/v1/admin/tenants/${encodeURIComponent(tenant.id)}/status`, { method: 'POST', body: JSON.stringify({ status: tenant.status === 'active' ? 'suspended' : 'active' }) }); await refresh(tenant.status === 'active' ? 'Tenant suspended' : 'Tenant resumed') }

  return (
    <div className="detail-layout">
      <aside className="detail-summary card">
        <div className="summary-identity"><div className="summary-avatar" aria-hidden="true">{tenant.name.slice(0, 1).toUpperCase()}</div><div><p className="eyebrow">Tenant</p><h1>{tenant.name}</h1><div className="summary-meta"><span className="mono">{tenant.id}</span><StatusPill status={tenant.status} /></div></div></div>
        <dl className="summary-list"><div><dt>IdP issuer</dt><dd>{tenant.idpIssuer}</dd></div><div><dt>Created</dt><dd>{new Date(tenant.createdAt).toLocaleString()}</dd></div></dl>
        <div className="summary-actions"><Button variant="primary" onClick={openProfile}>Edit profile</Button><Button variant={tenant.status === 'active' ? 'danger' : 'default'} onClick={() => { void toggleStatus().catch(reason => actions.notify(errorText(reason))) }}>{tenant.status === 'active' ? 'Suspend' : 'Resume'}</Button><Button variant="ghost" onClick={() => actions.navigate('tenants')}>Back to tenants</Button></div>
      </aside>
      <div className="detail-main">
        <div className="kpi-grid"><MetricCard value={String(tenant.usage.users)} label="Users" detail="members" /><MetricCard value={String(tenant.usage.devices)} label="Devices" detail="paired" /><MetricCard value={String(tenant.usage.cloudTickets)} label="Cloud tickets" detail="today" /><MetricCard value={String(tenant.usage.deviceTickets)} label="Device tickets" detail="today" /></div>
        <Tabs.Root value={tab} onValueChange={value => setTab(value as TenantTab)}>
          <Tabs.List className="tabs-list">
            {TENANT_TABS.map(item => <Tabs.Tab key={item} value={item} className="tab">{item === 'overview' ? 'Overview' : item === 'users' ? 'Users' : item === 'models' ? 'Models' : item === 'support' ? 'Support' : item === 'usage' ? 'Usage' : 'Audit'}</Tabs.Tab>)}
          </Tabs.List>
          <Tabs.Panel value="overview" className="tab-panel">
            <Card>
              <SectionHeading title="Quota" actions={<Button variant="ghost" onClick={openQuota}>Edit quota</Button>} />
              <div className="quota-grid">
                <QuotaProgress label="Users" used={tenant.usage.users} limit={detail.quota.maxUsers} />
                <QuotaProgress label="Devices" used={tenant.usage.devices} limit={detail.quota.maxDevices} />
                <QuotaProgress label="Cloud tickets" used={tenant.usage.cloudTickets} limit={detail.quota.maxCloudTicketsPerDay} />
                <QuotaProgress label="Device tickets" used={tenant.usage.deviceTickets} limit={detail.quota.maxDeviceTicketsPerDay} />
              </div>
            </Card>
            <Card>
              <SectionHeading title="Billing" actions={<Button variant="ghost" onClick={openBilling}>Edit billing</Button>} />
              <div className="billing-grid">
                <div><span>Currency</span><strong>{detail.billing.currency}</strong></div>
                <div><span>Cloud ticket</span><strong>{detail.billing.cloudTicketCents}</strong></div>
                <div><span>Device ticket</span><strong>{detail.billing.deviceTicketCents}</strong></div>
                <div><span>Monthly budget</span><strong>{detail.billing.monthlyBudgetCents === null ? 'No budget' : detail.billing.monthlyBudgetCents}</strong></div>
                <div><span>Current estimate</span><strong>{detail.estimate.estimatedCents} {detail.estimate.currency}</strong></div>
              </div>
            </Card>
          </Tabs.Panel>
          <Tabs.Panel value="users" className="tab-panel">
            <Card><SectionHeading title="Users" actions={<Button variant="ghost" onClick={addUser}>Add user</Button>} /><DataTable headers={['Email', 'Role', 'User ID']} empty="No users." rows={detail.users.map(user => [user.email, user.role, <span className="mono" key="id">{user.userId}</span>])} /></Card>
          </Tabs.Panel>
          <Tabs.Panel value="models" className="tab-panel">
            <Card>
              <SectionHeading title="Enabled models" />
              <DataTable
                headers={['Model', 'Upstream', 'Default', 'Actions']}
                columnClasses={[undefined, undefined, undefined, 'col-actions']}
                empty="No models enabled yet."
                rows={visibleModels.map(model => [
                  <div className="cell-identity" key="identity">
                    <strong>{model.name}</strong>
                    <span className="mono muted">{model.id}</span>
                  </div>,
                  model.upstreamName ?? model.provider,
                  model.isDefault ? <span className="pill pill-active" key="default">Default</span> : <span className="muted" key="default">—</span>,
                  <div className="row-actions" key="actions">
                    {model.isDefault
                      ? <Button variant="ghost" onClick={() => { void setDefault('tenant-default').catch(reason => actions.notify(errorText(reason))) }}>Clear default</Button>
                      : <Button variant="default" onClick={() => { void setDefault(model.id).catch(reason => actions.notify(errorText(reason))) }}>Set default</Button>}
                    <Button variant="danger-ghost" disabled={model.isDefault} title={model.isDefault ? 'Clear default first' : undefined} onClick={() => { void disableModel(model).catch(reason => actions.notify(errorText(reason))) }}>Disable</Button>
                  </div>,
                ])}
              />
              <SectionHeading title="Available models" />
              <DataTable
                headers={['Model', 'Upstream', 'Upstream model', 'Actions']}
                columnClasses={[undefined, undefined, undefined, 'col-actions']}
                empty="All platform models are enabled for this tenant."
                rows={availableModels.map(model => [
                  <div className="cell-identity" key="identity">
                    <strong>{model.name}</strong>
                    <span className="mono muted">{model.id}</span>
                  </div>,
                  model.upstreamName ?? model.provider,
                  <span className="mono" key="model">{model.model}</span>,
                  <Button key="enable" variant="primary" onClick={() => { void enableModel(model.id).catch(reason => actions.notify(errorText(reason))) }}>Enable</Button>,
                ])}
              />
            </Card>
          </Tabs.Panel>
          <Tabs.Panel value="support" className="tab-panel">
            <Card><SectionHeading title="Support access" actions={<Button variant="ghost" onClick={requestSupport}>Request support</Button>} /><DataTable headers={['Reason', 'Status', 'Requested by']} empty="No support requests for this tenant." rows={data.supportRequests.filter(request => request.tenantId === tenant.id).map(request => [request.reason, request.status, request.requestedBy])} /></Card>
          </Tabs.Panel>
          <Tabs.Panel value="usage" className="tab-panel">
            <Card><SectionHeading title="Usage (14d)" /><DataTable headers={['Date', 'Cloud tickets', 'Device tickets']} empty="No usage yet." rows={detail.usageDaily.map(day => [day.date, String(day.cloudTickets), String(day.deviceTickets)])} /></Card>
          </Tabs.Panel>
          <Tabs.Panel value="audit" className="tab-panel">
            <Card><SectionHeading title="Audit summary" /><pre className="pre">{JSON.stringify(detail.auditSummary, undefined, 2)}</pre></Card>
          </Tabs.Panel>
        </Tabs.Root>
      </div>
    </div>
  )
}

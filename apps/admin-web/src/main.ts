/** Standalone SiriusX platform administration SPA. */
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { AddTenantUserForm, AddUpstreamForm, AuditFilters, AuditFilterValue, AuthForm, CreateBindingForm, CreateModelForm, CreateTenantForm, RequestSupportForm, TenantBillingForm, TenantFilters, TenantInitialValues, TenantProfileForm, TenantQuotaForm, numberValue, valueOf } from './forms'

type Json = Record<string, unknown>

class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}
type Tenant = { id: string; name: string; idpIssuer: string; createdAt: number; status: 'active' | 'suspended'; usage: { users: number; devices: number; deviceTickets: number; cloudTickets: number } }
type Model = { id: string; name: string; provider: string; model: string; enabled: boolean }
type Binding = { id: string; provider: string; externalId: string; tenantId: string; botId: string | null; repoUrl: string | null; baseRef: string | null; autoDispatch: boolean }
type SupportRequest = { id: string; tenantId: string; requestedBy: string; reason: string; status: string }
type Audit = { id: number; actor: string; action: string; target: string; detail: string | null; createdAt: number }
type Upstream = { id: string; modelId: string; name: string; protocol: string; baseUrl: string; upstreamModel: string; priority: number; enabled: boolean; hasApiKey: boolean }
type User = { userId: string; email: string; role: string }
type Quota = { maxUsers: number; maxDevices: number; maxCloudTicketsPerDay: number; maxDeviceTicketsPerDay: number }
type Billing = { currency: string; cloudTicketCents: number; deviceTicketCents: number; monthlyBudgetCents: number | null }

const app = document.getElementById('app')!
const errorBox = document.getElementById('error')!
const shellFormRoots: Root[] = []
let tenantEditRoot: Root | undefined
let auditFilterRoot: Root | undefined
let auditEvents: Audit[] = []
let auditFilter: AuditFilterValue = { query: '', action: '', range: 'all' }
let auditPage = 1
let auditPageSize = 20
let selectedTenant: string | undefined
let tenantQuery = ''
let tenantStatus = ''
let toastSerial = 0

function showError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  errorBox.replaceChildren(node('span', message))
  const close = node('button', 'Dismiss', 'button small')
  close.type = 'button'
  close.addEventListener('click', clearError)
  errorBox.append(close)
  errorBox.classList.add('visible')
}

function clearError(): void { errorBox.replaceChildren(); errorBox.classList.remove('visible') }

function mountShellForm(id: string, element: ReturnType<typeof createElement>): void {
  const host = document.getElementById(id)
  if (host === null) return
  const root = createRoot(host)
  root.render(element)
  shellFormRoots.push(root)
}

function unmountShellForms(): void { while (shellFormRoots.length > 0) shellFormRoots.pop()?.unmount() }


function notify(message: string, action?: { label: string; run: () => void | Promise<void> }): void {
  const id = `siriusx-toast-${++toastSerial}`
  const toast = node('div', undefined, 'toast')
  toast.id = id
  toast.setAttribute('popover', 'manual')
  toast.setAttribute('role', 'status')
  toast.append(node('span', '✓', 'toast-icon'), node('span', message, 'toast-text'))
  if (action !== undefined) {
    const actionButton = node('button', action.label, 'toast-action')
    actionButton.type = 'button'
    actionButton.addEventListener('click', () => {
      toast.hidePopover()
      void Promise.resolve(action.run()).catch(showError)
    })
    toast.append(actionButton)
  }
  const close = node('button', 'Close', 'toast-close')
  close.type = 'button'
  close.setAttribute('popovertarget', id)
  close.setAttribute('popovertargetaction', 'hide')
  close.setAttribute('aria-label', 'Dismiss notification')
  toast.append(close)
  const region = document.getElementById('toast-region')!
  region.append(toast)
  toast.showPopover()
  ;(document as Document & { ariaNotify?: (text: string) => void }).ariaNotify?.(message)
  let timer: number | undefined
  let remaining = action === undefined ? 4000 : 6000
  let started = Date.now()
  const hide = (): void => { if (toast.matches(':popover-open')) toast.hidePopover(); toast.remove() }
  const schedule = (): void => { started = Date.now(); timer = window.setTimeout(hide, remaining) }
  schedule()
  const pause = (): void => { if (timer !== undefined) { window.clearTimeout(timer); timer = undefined; remaining -= Date.now() - started } }
  const resume = (): void => { if (!toast.matches(':popover-open')) return; schedule() }
  toast.addEventListener('pointerenter', pause)
  toast.addEventListener('pointerleave', resume)
  toast.addEventListener('focusin', pause)
  toast.addEventListener('focusout', resume)
  toast.addEventListener('toggle', event => { if ((event as ToggleEvent).newState === 'closed') toast.remove() })
}

function renderNotifications(requests: SupportRequest[]): void {
  const pending = requests.filter(request => request.status === 'pending')
  const count = document.getElementById('notification-count')!
  count.textContent = String(pending.length)
  count.hidden = pending.length === 0
  document.getElementById('notification-button')!.hidden = pending.length === 0
  const list = document.getElementById('notification-list')!
  if (pending.length === 0) {
    list.replaceChildren(node('div', 'No pending notifications.', 'notification-empty'))
    return
  }
  list.replaceChildren(...pending.map(request => {
    const item = node('div', undefined, 'notification-item')
    item.append(node('strong', `Support request · ${request.tenantId}`), node('p', request.reason), node('p', `Requested by ${request.requestedBy}`))
    const open = node('button', 'View support', 'button small')
    open.type = 'button'
    open.addEventListener('click', () => { document.getElementById('notification-panel')?.hidePopover(); showView('support') })
    item.append(open)
    return item
  }))
}

function initHeader(): void {
  const button = document.getElementById('notification-button') as HTMLButtonElement
  const panel = document.getElementById('notification-panel')!
  panel.addEventListener('toggle', event => button.setAttribute('aria-expanded', String((event as ToggleEvent).newState === 'open')))
  document.getElementById('notification-view')!.addEventListener('click', () => { panel.hidePopover(); showView('support') })
  document.getElementById('notification-list')!.replaceChildren(node('div', 'No pending notifications.', 'notification-empty'))
}

function token(): string { return sessionStorage.getItem('siriusx.platformToken') ?? '' }

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-siriusx-platform-token': token(),
      ...(init.headers ?? {}),
    },
  })
  const text = await response.text()
  let value: unknown = undefined
  try { value = text === '' ? undefined : JSON.parse(text) } catch { value = text }
  if (!response.ok) throw new ApiError(response.status, typeof value === 'object' && value !== null && 'error' in value ? String((value as Json).error) : `HTTP ${response.status}`)
  return value as T
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  if (text !== undefined) element.textContent = text
  if (className !== undefined) element.className = className
  return element
}

function button(label: string, onClick: () => void | Promise<void>, className = ''): HTMLButtonElement {
  const element = node('button', label, className)
  element.type = 'button'
  element.addEventListener('click', () => { clearError(); void Promise.resolve(onClick()).catch(showError) })
  return element
}

function table(headers: readonly string[], rows: ReadonlyArray<ReadonlyArray<string | Node>>, caption?: string): HTMLElement {
  const wrapper = node('div', undefined, 'table-wrap')
  wrapper.tabIndex = 0
  wrapper.setAttribute('role', 'region')
  wrapper.setAttribute('aria-label', caption ?? 'Data table')
  const element = node('table')
  if (caption !== undefined) element.append(node('caption', caption))
  const head = node('tr')
  for (const header of headers) head.append(node('th', header))
  const thead = node('thead'); thead.append(head); element.append(thead)
  const body = node('tbody')
  for (const values of rows) {
    const tr = node('tr')
    values.forEach((value, index) => {
      const td = node('td')
      td.dataset.label = headers[index] ?? ''
      if (value instanceof Node) td.append(value)
      else td.textContent = value
      tr.append(td)
    })
    body.append(tr)
  }
  element.append(body)
  wrapper.append(element)
  return wrapper
}

function pill(status: string, className?: string): HTMLElement {
  return node('span', status, `pill ${className ?? (status === 'active' ? 'active' : status === 'suspended' ? 'suspended' : '')}`.trim())
}

function navIcon(path: string): string {
  return `<span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path}</svg></span>`
}

function renderShell(): void {
  unmountShellForms()
  auditFilterRoot?.unmount()
  auditFilterRoot = undefined
  auditEvents = []
  app.innerHTML = `
    <div class="workspace">
      <aside class="sidenav">
        <div class="sidebar-brand"><span class="brand-mark" aria-hidden="true">S</span><div><strong>SiriusX</strong><span>Platform</span></div></div>
        <div class="sidebar-context">
          <span class="status-dot"></span>
          <div><strong>Local LAN</strong><span>192.168.14.39</span></div>
        </div>
        <nav aria-label="Platform administration" id="admin-nav">
          <span class="nav-indicator" aria-hidden="true"></span>
          <div class="nav-group-label">Workspace</div>
          <button class="nav-button" type="button" data-view="overview" aria-current="page">${navIcon('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>')}<span class="nav-text">Overview</span></button>
          <button class="nav-button" type="button" data-view="tenants">${navIcon('<path d="M4 20v-1a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v1"/><circle cx="10" cy="7" r="3"/><path d="M17 20v-1a3 3 0 0 0-2-2.8"/><path d="M16 4.2a3 3 0 0 1 0 5.6"/>')}<span class="nav-text">Tenants</span></button>
          <div class="nav-group-label">Operations</div>
          <button class="nav-button" type="button" data-view="models">${navIcon('<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4.8 7.6 7.2 4 7.2-4M12 11.6V21"/>')}<span class="nav-text">Models</span></button>
          <button class="nav-button" type="button" data-view="sources">${navIcon('<path d="M9 7H7a5 5 0 0 0 0 10h2M15 7h2a5 5 0 0 1 0 10h-2M8 12h8"/>')}<span class="nav-text">Sources</span></button>
          <div class="nav-group-label">Governance</div>
          <button class="nav-button" type="button" data-view="support">${navIcon('<circle cx="12" cy="12" r="9"/><path d="M9.2 9a3 3 0 0 1 5.7 1c0 2-2.9 2.2-2.9 4"/><circle cx="12" cy="17" r=".6" fill="currentColor" stroke="none"/>')}<span class="nav-text">Support</span></button>
          <button class="nav-button" type="button" data-view="audit">${navIcon('<path d="M12 3 20 6v5.5c0 5-3.4 8-8 9.5-4.6-1.5-8-4.5-8-9.5V6l8-3Z"/><path d="m8.8 12 2.1 2.1 4.4-4.4"/>')}<span class="nav-text">Audit</span></button>
        </nav>
        <div class="sidebar-status"><span class="status-dot"></span><div><strong>Control Plane</strong><span>Connected</span></div></div>
        <div class="sidebar-version">SiriusX Admin · v0.1.0</div>
      </aside>
      <div class="content">
        <div class="mobile-tools"><button class="button" type="button" popovertarget="admin-nav" aria-controls="admin-nav">Menu</button><button class="button" type="button" id="density-toggle">Density</button></div>
        <section class="view active" data-view="overview" id="view-overview">
          <div class="page-head"><div><h1>Overview</h1></div><button class="button primary" type="button" data-go="tenants">Manage tenants</button></div>
          <div class="metric-grid" id="metrics"></div>
          <div class="card"><div class="card-head"><h2>Recent tenants</h2><button class="button small" type="button" data-go="tenants">View all</button></div><div id="overview-tenants"></div></div>
        </section>
        <section class="view" data-view="tenants" id="view-tenants">
          <div class="page-head"><div><h1>Tenants</h1></div><button id="open-create-tenant" class="button primary" type="button">+ New tenant</button></div>
          <div id="tenant-filter-root" class="toolbar"></div>
          <div id="tenants"></div>
        </section>
        <section class="view" data-view="models" id="view-models">
          <div class="page-head"><div><h1>Models</h1></div><button id="open-create-model" class="button primary" type="button">+ Add model</button></div>
          <div id="models"></div>
        </section>
        <section class="view" data-view="sources" id="view-sources">
          <div class="page-head"><div><h1>Sources</h1></div><button id="open-create-binding" class="button primary" type="button">+ Add source binding</button></div>
          <div id="bindings"></div>
        </section>
        <section class="view" data-view="support" id="view-support">
          <div class="page-head"><div><h1>Support requests</h1></div></div>
          <div id="support"></div>
        </section>
        <section class="view" data-view="audit" id="view-audit">
          <div class="page-head"><div><h1>Platform audit</h1></div><button id="export-audit" class="button" type="button">Export CSV</button></div>
          <div id="audit-filter-root" class="toolbar"></div>
          <div id="audit"></div>
        </section>
        <section class="view" data-view="tenant" id="view-tenant"><div id="tenant-page"></div></section>
      </div>
    </div>
    <dialog id="tenant-edit-dialog" aria-labelledby="tenant-edit-title"><div class="dialog-head"><h2 id="tenant-edit-title"></h2><button id="tenant-edit-close" class="button" type="button">Close</button></div><div class="dialog-body" id="tenant-edit-form-root"></div></dialog>`
  addHandlers()
  mountShellForms()
  requestAnimationFrame(moveNavIndicator)
}

function mountShellForms(): void {
  mountShellForm('tenant-filter-root', createElement(TenantFilters, {
    total: tenants.length,
    onChange: (query, status) => { tenantQuery = query; tenantStatus = status; renderTenants(true) },
  }))
}

function mountAuditFilters(): void {
  const host = document.getElementById('audit-filter-root')
  if (host === null) return
  auditFilterRoot?.unmount()
  auditFilterRoot = createRoot(host)
  auditFilterRoot.render(createElement(AuditFilters, {
    actions: [...new Set(auditEvents.map(event => event.action))].sort(),
    onChange: value => { auditFilter = value; auditPage = 1; renderAudit() },
  }))
}

function moveNavIndicator(): void {
  const nav = document.getElementById('admin-nav')
  const active = nav?.querySelector<HTMLButtonElement>('.nav-button[aria-current="page"]')
  const indicator = nav?.querySelector<HTMLElement>('.nav-indicator')
  if (nav === null || nav === undefined || active === null || active === undefined || indicator === null || indicator === undefined) return
  indicator.style.width = `${active.offsetWidth}px`
  indicator.style.height = `${active.offsetHeight}px`
  indicator.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`
}

const VIEW_LABELS: Record<string, string> = { overview: 'Overview', tenants: 'Tenants', models: 'Models', sources: 'Sources', support: 'Support', audit: 'Audit', tenant: 'Tenant detail' }
const VIEW_PATHS: Record<string, string> = { overview: '/', tenants: '/tenants', models: '/models', sources: '/sources', support: '/support', audit: '/audit' }
type HistoryMode = 'push' | 'replace' | 'none'

interface AppRoute { view: string; tenantId?: string }

function routeFromLocation(): AppRoute {
  const path = decodeURIComponent(location.pathname).replace(/\/+$/u, '') || '/'
  if (path.startsWith('/tenants/')) {
    const tenantId = path.slice('/tenants/'.length)
    return tenantId === '' ? { view: 'tenants' } : { view: 'tenant', tenantId }
  }
  for (const [view, routePath] of Object.entries(VIEW_PATHS)) if (routePath === path) return { view }
  return { view: 'overview' }
}

function writeRoute(view: string, mode: HistoryMode, tenantId?: string): void {
  if (mode === 'none') return
  const target = view === 'tenant' && tenantId !== undefined ? `/tenants/${encodeURIComponent(tenantId)}` : (VIEW_PATHS[view] ?? '/')
  if (location.pathname === target) return
  if (mode === 'replace') history.replaceState({}, '', target)
  else history.pushState({}, '', target)
}

function showView(view: string, mode: HistoryMode = 'push'): void {
  if (view !== 'tenant') selectedTenant = undefined
  const navView = view === 'tenant' ? 'tenants' : view
  const breadcrumb = document.getElementById('breadcrumb')
  if (breadcrumb !== null) {
    breadcrumb.hidden = view !== 'tenant'
    if (view === 'tenant') breadcrumb.replaceChildren('Platform', ' / ', VIEW_LABELS[view] ?? 'Tenant detail')
  }
  for (const element of document.querySelectorAll<HTMLElement>('.view')) element.classList.toggle('active', element.dataset.view === view)
  for (const element of document.querySelectorAll<HTMLButtonElement>('.nav-button')) element.setAttribute('aria-current', element.dataset.view === navView ? 'page' : 'false')
  const nav = document.getElementById('admin-nav')
  if (nav?.matches(':popover-open')) nav.hidePopover()
  window.scrollTo({ top: 0, behavior: 'auto' })
  requestAnimationFrame(moveNavIndicator)
  writeRoute(view, mode)
}

async function applyRoute(): Promise<void> {
  const route = routeFromLocation()
  if (route.view !== 'tenant') { showView(route.view, 'none'); return }
  if (route.tenantId === undefined || !tenants.some(tenant => tenant.id === route.tenantId)) {
    showView('tenants', 'replace')
    return
  }
  selectedTenant = route.tenantId
  await openTenant(route.tenantId)
}

async function bootApp(): Promise<void> {
  renderShell()
  await loadAll()
  await applyRoute()
}

let tenants: Tenant[] = []
let models: Model[] = []
let bindings: Binding[] = []

function addHandlers(): void {
  document.getElementById('export-audit')!.addEventListener('click', () => { void exportPlatformAudit().catch(showError) })
  document.getElementById('tenant-edit-close')!.addEventListener('click', closeTenantEditor)
  document.getElementById('open-create-tenant')!.addEventListener('click', () => openTenantEditor('Create tenant', createElement(CreateTenantForm, { onSubmit: async values => { await createTenant(values); closeTenantEditor() } })))
  document.getElementById('open-create-model')!.addEventListener('click', () => openTenantEditor('Add model', createElement(CreateModelForm, { onSubmit: async values => { await createModel(values); closeTenantEditor() } })))
  document.getElementById('open-create-binding')!.addEventListener('click', () => openTenantEditor('Add source binding', createElement(CreateBindingForm, { onSubmit: async values => { await createBinding(values); closeTenantEditor() } })))
  document.getElementById('tenant-edit-dialog')!.addEventListener('close', () => { tenantEditRoot?.unmount(); tenantEditRoot = undefined })
  for (const item of document.querySelectorAll<HTMLButtonElement>('.nav-button, [data-go]')) {
    item.addEventListener('click', () => showView(item.dataset.view ?? item.dataset.go ?? 'overview'))
  }
  const density = document.getElementById('density-toggle') as HTMLButtonElement
  const applyDensity = (value: string): void => {
    const normalized = value === 'compact' ? 'compact' : 'comfortable'
    document.documentElement.dataset.density = normalized
    density.textContent = normalized === 'compact' ? 'Comfortable density' : 'Compact density'
    localStorage.setItem('siriusx.adminDensity', normalized)
  }
  applyDensity(localStorage.getItem('siriusx.adminDensity') ?? 'compact')
  density.addEventListener('click', () => applyDensity(document.documentElement.dataset.density === 'compact' ? 'comfortable' : 'compact'))
  setupMobileNav()
}

function setupMobileNav(): void {
  const nav = document.getElementById('admin-nav')!
  const button = document.querySelector<HTMLButtonElement>('[popovertarget="admin-nav"]')
  const media = matchMedia('(max-width: 820px)')
  const sync = (): void => {
    if (media.matches) nav.setAttribute('popover', 'auto')
    else {
      if (nav.matches(':popover-open')) nav.hidePopover()
      nav.removeAttribute('popover')
    }
    button?.setAttribute('aria-expanded', 'false')
  }
  media.addEventListener('change', sync)
  nav.addEventListener('toggle', event => button?.setAttribute('aria-expanded', String((event as ToggleEvent).newState === 'open')))
  sync()
}

async function createTenant(values: Record<string, unknown>): Promise<void> {
  const tenantId = valueOf(values, 'tenantId').trim()
  await api('/v1/admin/tenants', { method: 'POST', body: JSON.stringify({
    name: valueOf(values, 'name'),
    idpIssuer: valueOf(values, 'idpIssuer'),
    adminEmail: valueOf(values, 'adminEmail'),
    ...(tenantId === '' ? {} : { tenantId }),
  }) })
  await loadAll()
  notify('Tenant created')
}

async function createModel(values: Record<string, unknown>): Promise<void> {
  const id = valueOf(values, 'id').trim()
  await api('/v1/admin/models', { method: 'POST', body: JSON.stringify({
    ...(id === '' ? {} : { id }),
    name: valueOf(values, 'name'),
    provider: valueOf(values, 'provider'),
    model: valueOf(values, 'model'),
  }) })
  await loadAll()
  notify('Model added')
}

async function createBinding(values: Record<string, unknown>): Promise<void> {
  const repo = valueOf(values, 'repoUrl').trim()
  const base = valueOf(values, 'baseRef').trim()
  await api('/v1/admin/source-bindings', { method: 'POST', body: JSON.stringify({
    provider: valueOf(values, 'provider'),
    externalId: valueOf(values, 'externalId'),
    tenantId: valueOf(values, 'tenantId'),
    ...(repo === '' ? {} : { repoUrl: repo }),
    ...(base === '' ? {} : { baseRef: base }),
    autoDispatch: values.autoDispatch === true || values.autoDispatch === 'on',
  }) })
  await loadAll()
  notify('Source binding added')
}

async function exportPlatformAudit(): Promise<void> {
  const response = await fetch('/v1/admin/audit/export?format=csv', { headers: { 'x-siriusx-platform-token': token() } })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const link = node('a')
  link.href = URL.createObjectURL(await response.blob())
  link.download = 'siriusx-platform-audit.csv'
  link.click()
  URL.revokeObjectURL(link.href)
}

type ViewTransitionLike = { finished: Promise<void>; skipTransition: () => void }
let activeTenantTransition: ViewTransitionLike | undefined

function renderTenants(animate = false): void {
  const doc = document as Document & { startViewTransition?: (callback: () => void) => ViewTransitionLike }
  if (!animate || doc.startViewTransition === undefined) { renderTenantsNow(); return }
  activeTenantTransition?.skipTransition()
  const transition = doc.startViewTransition(() => renderTenantsNow())
  activeTenantTransition = transition
  void transition.finished.finally(() => { if (activeTenantTransition === transition) activeTenantTransition = undefined })
}

function renderTenantsNow(): void {
  const host = document.getElementById('tenants')!
  const query = tenantQuery.trim().toLowerCase()
  const filtered = tenants.filter(tenant => {
    const matchesQuery = query === '' || `${tenant.name} ${tenant.id} ${tenant.idpIssuer}`.toLowerCase().includes(query)
    return matchesQuery && (tenantStatus === '' || tenant.status === tenantStatus)
  })
  const count = document.getElementById('tenant-count')
  if (count !== null) count.textContent = `${filtered.length} of ${tenants.length} tenants`
  if (filtered.length === 0) { host.replaceChildren(node('div', 'No tenants match these filters.', 'table-empty')); return }
  const rows = filtered.map(tenant => {
    const actions = node('div', undefined, 'row')
    actions.append(button(tenant.status === 'active' ? 'Suspend' : 'Resume', () => tenant.status === 'active' ? suspendTenant(tenant.id) : resumeTenant(tenant.id)))
    return [tenant.name, tenant.id, pill(tenant.status), String(tenant.usage.users), actions]
  })
  const rendered = table(['Name', 'Tenant', 'Status', 'Users', 'Actions'], rows)
  rendered.querySelectorAll<HTMLTableRowElement>('tbody tr').forEach((row, index) => {
    const tenantId = filtered[index]?.id ?? ''
    row.setAttribute('data-tenant-id', tenantId)
    row.style.viewTransitionName = `tenant-${tenantId.replace(/[^a-zA-Z0-9_-]/gu, '-')}`
    row.classList.add('clickable-row')
    row.tabIndex = 0
    row.addEventListener('click', event => {
      if ((event.target as HTMLElement).closest('button, a') !== null) return
      selectedTenant = tenantId; void openTenant(tenantId).catch(showError)
    })
    row.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault(); selectedTenant = tenantId; void openTenant(tenantId).catch(showError)
    })
  })
  host.replaceChildren(rendered)
}

function renderModels(): void {
  const host = document.getElementById('models')!
  if (models.length === 0) { host.replaceChildren(node('div', 'No models yet.', 'table-empty')); return }
  host.replaceChildren(table(['ID', 'Name', 'Provider', 'Model', 'Enabled'], models.map(model => [model.id, model.name, model.provider, model.model, String(model.enabled)])))
}

function renderBindings(): void {
  const host = document.getElementById('bindings')!
  if (bindings.length === 0) { host.replaceChildren(node('div', 'No source bindings yet.', 'table-empty')); return }
  host.replaceChildren(table(['ID', 'Provider', 'External', 'Tenant', 'Repo', 'Base', 'Auto'], bindings.map(binding => [binding.id, binding.provider, binding.externalId, binding.tenantId, binding.repoUrl ?? '', binding.baseRef ?? '', String(binding.autoDispatch)])))
}

const AUDIT_ACTION_LABELS: Record<string, string> = {
  'model.create': 'Model created',
  'model.bind': 'Model bound',
  'model.upstream': 'Upstream added',
  'quota.update': 'Quota updated',
  'tenant.status': 'Tenant status changed',
  'tenant.create': 'Tenant created',
  'tenant.update': 'Tenant updated',
  'source.binding.create': 'Source binding added',
  'support.request': 'Support requested',
}

function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action.replaceAll('.', ' ')
}

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

function auditTarget(target: string): HTMLElement {
  const tenantId = target.split('/')[0] ?? ''
  if (!tenantId.startsWith('tenant-')) return node('span', target)
  const link = node('a', target, 'audit-target')
  link.href = `/tenants/${encodeURIComponent(tenantId)}`
  link.addEventListener('click', event => { event.preventDefault(); selectedTenant = tenantId; void openTenant(tenantId).catch(showError) })
  return link
}

function renderAudit(): void {
  const host = document.getElementById('audit')
  if (host === null) return
  const now = Date.now()
  const since = auditFilter.range === '24h' ? now - 86_400_000 : auditFilter.range === '7d' ? now - 7 * 86_400_000 : auditFilter.range === '30d' ? now - 30 * 86_400_000 : 0
  const query = auditFilter.query.trim().toLowerCase()
  const filtered = auditEvents
    .filter(event => (auditFilter.action === '' || event.action === auditFilter.action) && event.createdAt >= since)
    .filter(event => query === '' || `${event.actor} ${event.action} ${event.target} ${event.detail ?? ''}`.toLowerCase().includes(query))
    .sort((left, right) => right.createdAt - left.createdAt)
  const pageCount = Math.max(1, Math.ceil(filtered.length / auditPageSize))
  const page = Math.min(Math.max(auditPage, 1), pageCount)
  auditPage = page
  const start = (page - 1) * auditPageSize
  const visible = filtered.slice(start, start + auditPageSize)
  if (visible.length === 0) { host.replaceChildren(node('div', 'No audit events match these filters.', 'table-empty')); return }
  const rows = visible.map(event => {
    const time = node('time', new Date(event.createdAt).toLocaleString(), 'audit-time')
    time.dateTime = new Date(event.createdAt).toISOString()
    const detail = node('div', undefined, 'audit-detail')
    const summary = node('span', auditDetailSummary(event.detail), 'audit-summary')
    detail.append(summary)
    if (event.detail !== null && event.detail !== '' && summary.textContent !== event.detail) {
      const disclosure = node('details')
      disclosure.append(node('summary', 'Show JSON'), node('pre', event.detail, 'audit-json'))
      detail.append(disclosure)
    }
    return [time, event.actor, auditActionLabel(event.action), auditTarget(event.target), detail]
  })
  const wrapper = table(['Time', 'Actor', 'Action', 'Target', 'Detail'], rows)
  wrapper.classList.add('audit-table-wrap')
  const pagination = node('nav', undefined, 'audit-pagination')
  pagination.setAttribute('aria-label', 'Audit pagination')
  pagination.append(node('span', `Showing ${start + 1}–${Math.min(start + auditPageSize, filtered.length)} of ${filtered.length}`, 'audit-page-info'))
  const controls = node('div', undefined, 'audit-page-controls')
  const prev = node('button', 'Previous', 'button audit-page-button')
  prev.type = 'button'; prev.disabled = page <= 1
  prev.addEventListener('click', () => { auditPage -= 1; renderAudit() })
  controls.append(prev)
  for (let item = 1; item <= pageCount; item += 1) {
    const pageButton = node('button', String(item), 'button audit-page-button')
    pageButton.type = 'button'
    if (item === page) pageButton.setAttribute('aria-current', 'page')
    pageButton.addEventListener('click', () => { auditPage = item; renderAudit() })
    controls.append(pageButton)
  }
  const next = node('button', 'Next', 'button audit-page-button')
  next.type = 'button'; next.disabled = page >= pageCount
  next.addEventListener('click', () => { auditPage += 1; renderAudit() })
  controls.append(next)
  const sizes = node('div', undefined, 'audit-page-sizes')
  sizes.setAttribute('role', 'group'); sizes.setAttribute('aria-label', 'Rows per page')
  for (const size of [10, 20, 50]) {
    const sizeButton = node('button', String(size), 'button audit-page-size')
    sizeButton.type = 'button'
    sizeButton.setAttribute('aria-pressed', String(size === auditPageSize))
    sizeButton.addEventListener('click', () => { auditPageSize = size; auditPage = 1; renderAudit() })
    sizes.append(sizeButton)
  }
  pagination.append(controls, sizes)
  host.replaceChildren(wrapper, pagination)
}

function renderMetrics(support: SupportRequest[], audit: Audit[]): void {
  const active = tenants.filter(tenant => tenant.status === 'active').length
  const totalUsers = tenants.reduce((total, tenant) => total + tenant.usage.users, 0)
  const totalDevices = tenants.reduce((total, tenant) => total + tenant.usage.devices, 0)
  const pendingSupport = support.filter(request => request.status === 'pending').length
  const metricsHost = document.getElementById('metrics')!
  metricsHost.replaceChildren(
    metricCard(String(tenants.length), 'tenants', `${active} active`, true),
    metricCard(String(totalUsers), 'users', 'across tenants'),
    metricCard(String(totalDevices), 'devices', 'paired'),
    metricCard(String(models.length), 'models', `${bindings.length} source bindings`),
    metricCard(String(pendingSupport), 'pending support', `${audit.length} audit events`),
  )
  const overview = document.getElementById('overview-tenants')!
  overview.replaceChildren(table(['Name', 'Tenant', 'Status', 'Users'], tenants.slice(0, 5).map(tenant => [tenant.name, tenant.id, pill(tenant.status), String(tenant.usage.users)])))
}

function metricCard(value: string, label: string, detail: string, accent = false): HTMLElement {
  const card = node('div', undefined, `card metric${accent ? ' accent' : ''}`)
  card.append(node('strong', value), node('span', label), node('span', detail, 'muted'))
  return card
}

async function loadAll(): Promise<void> {
  clearError()
  if (token() === '') throw new Error('platform token is required')
  const [tenantResult, modelResult, bindingResult, supportResult, auditResult] = await Promise.all([
    api<{ tenants: Tenant[] }>('/v1/admin/tenants'),
    api<{ models: Model[] }>('/v1/admin/models'),
    api<{ bindings: Binding[] }>('/v1/admin/source-bindings'),
    api<{ requests: SupportRequest[] }>('/v1/admin/support-requests'),
    api<{ audit: Audit[] }>('/v1/admin/audit'),
  ])
  tenants = tenantResult.tenants
  models = modelResult.models
  bindings = bindingResult.bindings
  if (document.getElementById('tenants') === null) renderShell()
  renderTenants()
  renderModels()
  renderBindings()
  const supportHost = document.getElementById('support')!
  if (supportResult.requests.length === 0) supportHost.replaceChildren(node('div', 'No support requests.', 'table-empty'))
  else supportHost.replaceChildren(table(['Tenant', 'Reason', 'Status', 'Requested by'], supportResult.requests.map(request => [request.tenantId, request.reason, request.status, request.requestedBy])))
  renderNotifications(supportResult.requests)
  auditEvents = auditResult.audit
  auditPage = 1
  renderAudit()
  mountAuditFilters()
  renderMetrics(supportResult.requests, auditResult.audit)
  if (selectedTenant !== undefined) await openTenant(selectedTenant)
}

async function suspendTenant(tenantId: string): Promise<void> {
  await api(`/v1/admin/tenants/${encodeURIComponent(tenantId)}/status`, { method: 'POST', body: JSON.stringify({ status: 'suspended' }) })
  await loadAll()
  notify('Tenant suspended', { label: 'Undo', run: async () => { await resumeTenant(tenantId); notify('Tenant restored') } })
}

async function resumeTenant(tenantId: string): Promise<void> {
  await api(`/v1/admin/tenants/${encodeURIComponent(tenantId)}/status`, { method: 'POST', body: JSON.stringify({ status: 'active' }) })
  await loadAll()
  notify('Tenant resumed')
}

function confirmAction(title: string, message: string, confirmLabel = 'Delete'): Promise<boolean> {
  return new Promise(resolve => {
    const dialog = node('dialog', undefined, 'confirm-dialog')
    dialog.setAttribute('aria-labelledby', 'confirm-title')
    const head = node('div', undefined, 'dialog-head')
    head.append(node('h2', title))
    const body = node('div', undefined, 'dialog-body')
    body.append(node('p', message, 'lede'))
    const actions = node('div', undefined, 'dialog-actions')
    const cancel = node('button', 'Cancel', 'button')
    const accept = node('button', confirmLabel, 'button danger')
    cancel.type = 'button'; accept.type = 'button'
    actions.append(cancel, accept); body.append(actions); dialog.append(head, body)
    let settled = false
    const finish = (value: boolean): void => { if (settled) return; settled = true; dialog.close(); dialog.remove(); resolve(value) }
    cancel.addEventListener('click', () => finish(false))
    accept.addEventListener('click', () => finish(true))
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false) })
    document.body.append(dialog)
    dialog.showModal()
    accept.focus()
  })
}


function openTenantEditor(title: string, element: ReturnType<typeof createElement>): void {
  const dialog = document.getElementById('tenant-edit-dialog') as HTMLDialogElement
  tenantEditRoot?.unmount()
  tenantEditRoot = createRoot(document.getElementById('tenant-edit-form-root')!)
  document.getElementById('tenant-edit-title')!.textContent = title
  tenantEditRoot.render(element)
  if (!dialog.open) {
    dialog.showModal()
    requestAnimationFrame(() => dialog.querySelector<HTMLElement>('input:not([type="hidden"]), select, textarea')?.focus())
  }
}

function closeTenantEditor(): void {
  const dialog = document.getElementById('tenant-edit-dialog') as HTMLDialogElement
  if (dialog.open) dialog.close()
  tenantEditRoot?.unmount()
  tenantEditRoot = undefined
}

function setQuotaUsage(key: string, used: number, limit: number): void {
  const text = document.getElementById(`detail-q-${key}`)
  if (text !== null) text.textContent = `${used} / ${limit}`
  const progress = document.getElementById(`progress-q-${key}`) as HTMLProgressElement | null
  if (progress !== null) {
    progress.max = Math.max(limit, 1)
    progress.value = Math.min(used, Math.max(limit, 1))
  }
}

function kpiItem(value: string, label: string): HTMLElement {
  const item = node('div', undefined, 'tenant-kpi')
  item.append(node('strong', value), node('span', label))
  return item
}

function setTenantTab(tab: string, updateUrl = true): void {
  const valid = new Set(['overview', 'users', 'models', 'upstreams', 'support', 'usage', 'audit'])
  const next = valid.has(tab) ? tab : 'overview'
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-tenant-tab]')) {
    const selected = button.dataset.tenantTab === next
    button.setAttribute('aria-selected', String(selected))
  }
  for (const panel of document.querySelectorAll<HTMLElement>('[data-tenant-panel]')) panel.classList.toggle('active', panel.dataset.tenantPanel === next)
  if (!updateUrl) return
  const url = new URL(location.href)
  if (next === 'overview') url.searchParams.delete('tab')
  else url.searchParams.set('tab', next)
  history.replaceState({}, '', `${url.pathname}${url.search}`)
}

async function openTenant(tenantId: string): Promise<void> {
  const tenant = tenants.find(item => item.id === tenantId)
  if (tenant === undefined) return
  const [userResult, quotaResult, dailyResult, billingResult, tenantModelResult, auditResult, supportResult, upstreamResult] = await Promise.all([
    api<{ users: User[] }>(`/v1/admin/tenants/${encodeURIComponent(tenantId)}/users`),
    api<{ quota: Quota; usage: Json }>(`/v1/admin/tenants/${encodeURIComponent(tenantId)}/quota`),
    api<{ days: number; usage: Array<{ date: string; cloudTickets: number; deviceTickets: number }> }>(`/v1/admin/tenants/${encodeURIComponent(tenantId)}/usage-daily?days=14`),
    api<{ billing: Billing; estimate: { estimatedCents: number; currency: string } }>(`/v1/admin/tenants/${encodeURIComponent(tenantId)}/billing`),
    api<{ models: Array<{ id: string; name: string; isDefault: boolean }> }>(`/v1/admin/tenants/${encodeURIComponent(tenantId)}/models`),
    api<{ total: number; decisions: Record<string, number> }>(`/v1/admin/tenants/${encodeURIComponent(tenantId)}/audit-summary`).catch(() => ({ total: 0, decisions: {} })),
    api<{ requests: SupportRequest[] }>('/v1/admin/support-requests'),
    api<{ upstreams: Upstream[] }>(`/v1/admin/tenants/${encodeURIComponent(tenantId)}/model-upstreams`).catch(() => ({ upstreams: [] })),
  ])
  const host = document.getElementById('tenant-page')!
  closeTenantEditor()
  host.innerHTML = `
    <div class="tenant-layout">
      <aside class="tenant-summary">
        <div class="summary-identity">
          <div class="summary-avatar" aria-hidden="true">${tenant.name.slice(0, 1).toUpperCase()}</div>
          <div><p class="eyebrow">Tenant</p><h1 id="detail-title"></h1><div class="tenant-meta"><span id="detail-id" class="mono"></span><span id="detail-status"></span></div></div>
        </div>
        <dl class="summary-list">
          <div><dt>IdP issuer</dt><dd id="detail-issuer"></dd></div>
          <div><dt>Created</dt><dd id="detail-created"></dd></div>
        </dl>
        <div class="summary-actions">
          <button id="edit-tenant" class="button primary" type="button">Edit profile</button>
          <button id="detail-status-button" class="button" type="button"></button>
          <button id="back-tenants" class="button" type="button">Back to tenants</button>
        </div>
      </aside>
      <div class="tenant-main">
        <div class="tenant-kpis" id="detail-metrics"></div>
        <nav class="tenant-tabs" role="tablist" aria-label="Tenant sections">
          <button class="tenant-tab" type="button" role="tab" data-tenant-tab="overview" aria-selected="true">Overview</button>
          <button class="tenant-tab" type="button" role="tab" data-tenant-tab="users" aria-selected="false">Users</button>
          <button class="tenant-tab" type="button" role="tab" data-tenant-tab="models" aria-selected="false">Models</button>
          <button class="tenant-tab" type="button" role="tab" data-tenant-tab="upstreams" aria-selected="false">Upstreams</button>
          <button class="tenant-tab" type="button" role="tab" data-tenant-tab="support" aria-selected="false">Support</button>
          <button class="tenant-tab" type="button" role="tab" data-tenant-tab="usage" aria-selected="false">Usage</button>
          <button class="tenant-tab" type="button" role="tab" data-tenant-tab="audit" aria-selected="false">Audit</button>
        </nav>
        <section class="tenant-panel active" data-tenant-panel="overview">
          <section class="detail-panel limits-panel">
            <div class="detail-panel-head">
              <div><h3>Limits &amp; billing</h3></div>
            </div>
            <div class="limits-section">
              <div class="limits-section-head"><h4>Quota</h4><button id="edit-quota" class="button small" type="button">Edit quota</button></div>
              <div class="quota-grid">
                <div class="quota-item"><div class="quota-meta"><span>Users</span><strong id="detail-q-users"></strong></div><progress id="progress-q-users" max="1" value="0" aria-label="Users quota usage"></progress></div>
                <div class="quota-item"><div class="quota-meta"><span>Devices</span><strong id="detail-q-devices"></strong></div><progress id="progress-q-devices" max="1" value="0" aria-label="Devices quota usage"></progress></div>
                <div class="quota-item"><div class="quota-meta"><span>Cloud tickets</span><strong id="detail-q-cloud"></strong></div><progress id="progress-q-cloud" max="1" value="0" aria-label="Cloud ticket quota usage"></progress></div>
                <div class="quota-item"><div class="quota-meta"><span>Device tickets</span><strong id="detail-q-device"></strong></div><progress id="progress-q-device" max="1" value="0" aria-label="Device ticket quota usage"></progress></div>
              </div>
            </div>
            <div class="limits-section">
              <div class="limits-section-head"><h4>Billing</h4><button id="edit-billing" class="button small" type="button">Edit billing</button></div>
              <div class="billing-grid">
                <div><span>Currency</span><strong id="detail-b-currency"></strong></div>
                <div><span>Cloud ticket</span><strong id="detail-b-cloud"></strong></div>
                <div><span>Device ticket</span><strong id="detail-b-device"></strong></div>
                <div><span>Monthly budget</span><strong id="detail-b-budget"></strong></div>
                <div><span>Current estimate</span><strong id="detail-estimate"></strong></div>
              </div>
            </div>
          </section>
        </section>
        <section class="tenant-panel" data-tenant-panel="users">
          <div class="section-heading"><h3>Users</h3><button id="add-user" class="button small" type="button">Add user</button></div>
          <div id="detail-users"></div>
        </section>
        <section class="tenant-panel" data-tenant-panel="models">
          <div class="section-heading"><h3>Models</h3></div>
          <div id="detail-models"></div>
        </section>
        <section class="tenant-panel" data-tenant-panel="upstreams">
          <div class="section-heading"><h3>Model upstreams</h3><button id="add-upstream" class="button small" type="button">Add upstream</button></div>
          <div id="detail-upstreams"></div>
        </section>
        <section class="tenant-panel" data-tenant-panel="support">
          <div class="section-heading"><h3>Support access</h3><button id="request-support" class="button small" type="button">Request support</button></div>
          <div id="detail-support"></div>
        </section>
        <section class="tenant-panel" data-tenant-panel="usage">
          <div class="section-heading"><h3>Usage (14d)</h3></div>
          <div id="detail-usage"></div>
        </section>
        <section class="tenant-panel" data-tenant-panel="audit">
          <div class="section-heading"><h3>Audit summary</h3></div>
          <div class="pre" id="detail-audit"></div>
        </section>
      </div>
    </div>`
  showView('tenant', 'none')
  const breadcrumb = document.getElementById('breadcrumb')
  if (breadcrumb !== null) { breadcrumb.hidden = false; breadcrumb.replaceChildren('Platform', ' / ', 'Tenants', ' / ', tenant.name) }
  writeRoute('tenant', 'push', tenant.id)
  document.getElementById('back-tenants')!.addEventListener('click', () => { showView('tenants'); void loadAll().catch(showError) })
  ;(document.getElementById('detail-title') as HTMLElement).textContent = tenant.name
  ;(document.getElementById('detail-id') as HTMLElement).textContent = tenant.id
  document.getElementById('detail-status')!.replaceChildren(pill(tenant.status))
  ;(document.getElementById('detail-issuer') as HTMLElement).textContent = tenant.idpIssuer
  ;(document.getElementById('detail-created') as HTMLElement).textContent = new Date(tenant.createdAt).toLocaleString()
  setQuotaUsage('users', tenant.usage.users, quotaResult.quota.maxUsers)
  setQuotaUsage('devices', tenant.usage.devices, quotaResult.quota.maxDevices)
  setQuotaUsage('cloud', tenant.usage.cloudTickets, quotaResult.quota.maxCloudTicketsPerDay)
  setQuotaUsage('device', tenant.usage.deviceTickets, quotaResult.quota.maxDeviceTicketsPerDay)
  ;(document.getElementById('detail-b-currency') as HTMLElement).textContent = billingResult.billing.currency
  ;(document.getElementById('detail-b-cloud') as HTMLElement).textContent = String(billingResult.billing.cloudTicketCents)
  ;(document.getElementById('detail-b-device') as HTMLElement).textContent = String(billingResult.billing.deviceTicketCents)
  ;(document.getElementById('detail-b-budget') as HTMLElement).textContent = billingResult.billing.monthlyBudgetCents === null ? 'No budget' : String(billingResult.billing.monthlyBudgetCents)
  ;(document.getElementById('detail-estimate') as HTMLElement).textContent = `${billingResult.estimate.estimatedCents} ${billingResult.estimate.currency}`
  ;(document.getElementById('detail-metrics') as HTMLElement).replaceChildren(
    kpiItem(String(tenant.usage.users), 'Users'),
    kpiItem(String(tenant.usage.devices), 'Devices'),
    kpiItem(String(tenant.usage.cloudTickets), 'Cloud tickets'),
    kpiItem(String(tenant.usage.deviceTickets), 'Device tickets'),
  )
  const statusButton = document.getElementById('detail-status-button') as HTMLButtonElement
  statusButton.textContent = tenant.status === 'active' ? 'Suspend' : 'Resume'
  statusButton.addEventListener('click', () => { void (tenant.status === 'active' ? suspendTenant(tenant.id) : resumeTenant(tenant.id)).catch(showError) })
  const initial: TenantInitialValues = { name: tenant.name, idpIssuer: tenant.idpIssuer, quota: quotaResult.quota, billing: billingResult.billing, models: tenantModelResult.models.map(model => model.id) }
  document.getElementById('edit-tenant')!.addEventListener('click', () => openTenantEditor('Edit tenant profile', createElement(TenantProfileForm, { initial, onSubmit: async values => { await saveTenant(tenant.id, values); closeTenantEditor() } })))
  document.getElementById('edit-quota')!.addEventListener('click', () => openTenantEditor('Edit tenant quota', createElement(TenantQuotaForm, { initial, onSubmit: async values => { await saveQuota(tenant.id, values); closeTenantEditor() } })))
  document.getElementById('edit-billing')!.addEventListener('click', () => openTenantEditor('Edit tenant billing', createElement(TenantBillingForm, { initial, onSubmit: async values => { await saveBilling(tenant.id, values); closeTenantEditor() } })))
  document.getElementById('add-user')!.addEventListener('click', () => openTenantEditor('Add tenant user', createElement(AddTenantUserForm, { onSubmit: async values => { await addUser(tenant.id, values); closeTenantEditor() } })))
  document.getElementById('add-upstream')!.addEventListener('click', () => openTenantEditor('Add model upstream', createElement(AddUpstreamForm, { models: initial.models, onSubmit: async values => { await addUpstream(tenant.id, values); closeTenantEditor() } })))
  document.getElementById('request-support')!.addEventListener('click', () => openTenantEditor('Request support access', createElement(RequestSupportForm, { onSubmit: async values => { await requestSupport(tenant.id, values); closeTenantEditor() } })))
  const initialTab = new URLSearchParams(location.search).get('tab') ?? 'overview'
  for (const tab of document.querySelectorAll<HTMLButtonElement>('[data-tenant-tab]')) tab.addEventListener('click', () => setTenantTab(tab.dataset.tenantTab ?? 'overview'))
  setTenantTab(initialTab, false)
  ;(document.getElementById('detail-users') as HTMLElement).replaceChildren(table(['Email', 'Role', 'User ID'], userResult.users.map(user => [user.email, user.role, user.userId])))
  const upstreamHost = document.getElementById('detail-upstreams')!
  upstreamHost.replaceChildren(table(['Model', 'Name', 'Protocol', 'URL', 'Upstream model', 'Priority', 'Enabled', 'Key', ''], upstreamResult.upstreams.map(upstream => {
    const remove = button('Delete', async () => {
      if (!await confirmAction('Delete upstream?', `Delete ${upstream.name} from ${upstream.modelId}? This cannot be undone.`)) return
      const row = remove.closest('tr')
      row?.classList.add('row-leaving')
      await new Promise(resolve => setTimeout(resolve, 180))
      await api(`/v1/admin/tenants/${encodeURIComponent(tenantId)}/models/${encodeURIComponent(upstream.modelId)}/upstreams/${encodeURIComponent(upstream.id)}`, { method: 'DELETE' })
      await openTenant(tenantId)
      notify('Upstream deleted')
    })
    return [upstream.modelId, upstream.name, upstream.protocol, upstream.baseUrl, upstream.upstreamModel, String(upstream.priority), String(upstream.enabled), upstream.hasApiKey ? 'configured' : '—', remove]
  })))
  const bound = new Map(tenantModelResult.models.map(model => [model.id, model]))
  ;(document.getElementById('detail-models') as HTMLElement).replaceChildren(table(['ID', 'Name', 'Default', ''], models.map(model => {
    const action = button(bound.has(model.id) ? 'Set default' : 'Bind', async () => {
      await api(`/v1/admin/tenants/${encodeURIComponent(tenantId)}/models/${encodeURIComponent(model.id)}`, { method: 'PUT', body: JSON.stringify({ isDefault: bound.get(model.id)?.isDefault === true }) })
      await openTenant(tenantId)
      notify('Model binding updated')
    })
    return [model.id, model.name, String(bound.get(model.id)?.isDefault === true), action]
  })))
  document.getElementById('detail-usage')!.replaceChildren(table(['Date', 'Cloud tickets', 'Device tickets'], dailyResult.usage.map(day => [day.date, String(day.cloudTickets), String(day.deviceTickets)])))
  document.getElementById('detail-audit')!.textContent = JSON.stringify(auditResult, undefined, 2)
  document.getElementById('detail-support')!.replaceChildren(table(['Reason', 'Status', 'Requested by'], supportResult.requests.filter(request => request.tenantId === tenantId).map(request => [request.reason, request.status, request.requestedBy])))
}

function checked(values: Record<string, unknown>, key: string): boolean {
  return values[key] === true || values[key] === 'on' || values[key] === 'true'
}

async function addUpstream(tenantId: string, values: Record<string, unknown>): Promise<void> {
  const modelId = valueOf(values, 'modelId')
  if (modelId === '') throw new Error('bind a model to the tenant first')
  const key = valueOf(values, 'apiKey')
  await api(`/v1/admin/tenants/${encodeURIComponent(tenantId)}/models/${encodeURIComponent(modelId)}/upstreams`, { method: 'POST', body: JSON.stringify({
    name: valueOf(values, 'name'),
    protocol: valueOf(values, 'protocol'),
    baseUrl: valueOf(values, 'baseUrl'),
    upstreamModel: valueOf(values, 'upstreamModel'),
    ...(key === '' ? {} : { apiKey: key }),
    priority: numberValue(values, 'priority'),
    enabled: checked(values, 'enabled'),
  }) })
  await openTenant(tenantId)
  notify('Upstream added')
}

async function saveTenant(tenantId: string, values: Record<string, unknown>): Promise<void> {
  await api(`/v1/admin/tenants/${encodeURIComponent(tenantId)}`, { method: 'PUT', body: JSON.stringify({
    name: valueOf(values, 'name'),
    idpIssuer: valueOf(values, 'idpIssuer'),
  }) })
  await loadAll(); await openTenant(tenantId)
  notify('Tenant updated')
}

async function saveQuota(tenantId: string, values: Record<string, unknown>): Promise<void> {
  await api(`/v1/admin/tenants/${encodeURIComponent(tenantId)}/quota`, { method: 'PUT', body: JSON.stringify({
    maxUsers: numberValue(values, 'maxUsers'),
    maxDevices: numberValue(values, 'maxDevices'),
    maxCloudTicketsPerDay: numberValue(values, 'maxCloudTicketsPerDay'),
    maxDeviceTicketsPerDay: numberValue(values, 'maxDeviceTicketsPerDay'),
  }) })
  await openTenant(tenantId)
  notify('Quota saved')
}

async function saveBilling(tenantId: string, values: Record<string, unknown>): Promise<void> {
  const budget = valueOf(values, 'monthlyBudgetCents').trim()
  await api(`/v1/admin/tenants/${encodeURIComponent(tenantId)}/billing`, { method: 'PUT', body: JSON.stringify({
    currency: valueOf(values, 'currency'),
    cloudTicketCents: numberValue(values, 'cloudTicketCents'),
    deviceTicketCents: numberValue(values, 'deviceTicketCents'),
    monthlyBudgetCents: budget === '' ? null : Number(budget),
  }) })
  await openTenant(tenantId)
  notify('Billing saved')
}

async function addUser(tenantId: string, values: Record<string, unknown>): Promise<void> {
  await api(`/v1/admin/tenants/${encodeURIComponent(tenantId)}/users`, { method: 'POST', body: JSON.stringify({ email: valueOf(values, 'email'), role: valueOf(values, 'role') }) })
  await openTenant(tenantId)
  notify('User added')
}

async function requestSupport(tenantId: string, values: Record<string, unknown>): Promise<void> {
  await api(`/v1/admin/tenants/${encodeURIComponent(tenantId)}/support-requests`, { method: 'POST', body: JSON.stringify({ reason: valueOf(values, 'reason') }) })
  await loadAll(); await openTenant(tenantId)
  notify('Support request sent')
}

initHeader()

const authHost = document.getElementById('auth-form-root')!
createRoot(authHost).render(createElement(AuthForm, {
  initialToken: token(),
  onConnect: async value => {
    sessionStorage.setItem('siriusx.platformToken', value)
    selectedTenant = undefined
    document.getElementById('token-panel')?.hidePopover()
    await bootApp()
  },
}))

if (token() === '') requestAnimationFrame(() => document.getElementById('token-panel')?.showPopover())
else void bootApp().catch(showError)

window.addEventListener('popstate', () => { if (token() !== '') void applyRoute().catch(showError) })

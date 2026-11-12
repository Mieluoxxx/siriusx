/** Standalone SiriusX platform administration SPA. */
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { AddTenantUserForm, AddUpstreamForm, AuthForm, CreateBindingForm, CreateModelForm, CreateTenantForm, RequestSupportForm, TenantBillingForm, TenantFilters, TenantInitialValues, TenantProfileForm, TenantQuotaForm, numberValue, valueOf } from './forms'

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
let selectedTenant: string | undefined
let tenantQuery = ''
let tenantStatus = ''
let toastSerial = 0
let tenantDialogSource: DOMRect | undefined

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
  app.innerHTML = `
    <div class="workspace">
      <aside class="sidenav">
        <div class="sidebar-brand"><span class="brand-mark" aria-hidden="true">S</span><div><strong>SiriusX</strong><span>Platform</span></div></div>
        <div class="sidebar-context">
          <span class="context-label">Environment</span>
          <strong>Local LAN</strong>
          <span>192.168.14.39 · Control Plane</span>
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
          <div class="page-head"><div><p class="eyebrow">Platform</p><h1>Overview</h1><p class="lede">Tenants, model routing, source integrations, and audit activity in one place.</p></div><button class="button primary" type="button" data-go="tenants">Manage tenants</button></div>
          <div class="metric-grid" id="metrics"></div>
          <div class="card"><div class="card-head"><h2>Recent tenants</h2><button class="button small" type="button" data-go="tenants">View all</button></div><div id="overview-tenants"></div></div>
        </section>
        <section class="view" data-view="tenants" id="view-tenants">
          <div class="page-head"><div><p class="eyebrow">Directory</p><h1>Tenants</h1><p class="lede">Provision tenants, manage status, and inspect usage.</p></div></div>
          <div id="tenant-filter-root" class="toolbar"></div>
          <section id="create-tenant" class="card form-card"><div class="form-card-head"><h2>Create tenant</h2><p>Provision a tenant and its first admin.</p></div><div id="create-tenant-form-root"></div></section>
          <div id="tenants"></div>
        </section>
        <section class="view" data-view="models" id="view-models">
          <div class="page-head"><div><p class="eyebrow">Routing</p><h1>Models</h1><p class="lede">Catalog models and connect each tenant to one or more upstream providers.</p></div></div>
          <section class="card form-card"><div class="form-card-head"><h2>Add model</h2><p>Create a catalog entry and client-facing alias.</p></div><div id="create-model-form-root"></div></section>
          <div id="models"></div>
        </section>
        <section class="view" data-view="sources" id="view-sources">
          <div class="page-head"><div><p class="eyebrow">Integrations</p><h1>Sources</h1><p class="lede">Map Git repositories and messaging channels to tenant workspaces.</p></div></div>
          <section class="card form-card"><div class="form-card-head"><h2>Add source binding</h2><p>Map a repository or channel to a tenant.</p></div><div id="create-binding-form-root"></div></section>
          <div id="bindings"></div>
        </section>
        <section class="view" data-view="support" id="view-support">
          <div class="page-head"><div><p class="eyebrow">Operations</p><h1>Support requests</h1><p class="lede">Tenant-approved emergency access requests.</p></div></div>
          <div id="support"></div>
        </section>
        <section class="view" data-view="audit" id="view-audit">
          <div class="page-head"><div><p class="eyebrow">Governance</p><h1>Platform audit</h1><p class="lede">Administrative changes across tenants, models, sources, and quotas.</p></div><button id="export-audit" class="button" type="button">Export CSV</button></div>
          <div id="audit"></div>
        </section>
      </div>
    </div>
    <dialog id="tenant-dialog" aria-labelledby="detail-title"><div id="tenant-detail"></div></dialog>
    <dialog id="tenant-edit-dialog" aria-labelledby="tenant-edit-title"><div class="dialog-head"><h2 id="tenant-edit-title"></h2><button id="tenant-edit-close" class="button" type="button">Close</button></div><div class="dialog-body" id="tenant-edit-form-root"></div></dialog>`
  addHandlers()
  mountShellForms()
  requestAnimationFrame(moveNavIndicator)
}

function mountShellForms(): void {
  mountShellForm('create-tenant-form-root', createElement(CreateTenantForm, { onSubmit: values => createTenant(values) }))
  mountShellForm('create-model-form-root', createElement(CreateModelForm, { onSubmit: values => createModel(values) }))
  mountShellForm('create-binding-form-root', createElement(CreateBindingForm, { onSubmit: values => createBinding(values) }))
  mountShellForm('tenant-filter-root', createElement(TenantFilters, {
    total: tenants.length,
    onChange: (query, status) => { tenantQuery = query; tenantStatus = status; renderTenants(true) },
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

const VIEW_LABELS: Record<string, string> = { overview: 'Overview', tenants: 'Tenants', models: 'Models', sources: 'Sources', support: 'Support', audit: 'Audit' }

function showView(view: string): void {
  const breadcrumb = document.getElementById('breadcrumb')
  if (breadcrumb !== null) breadcrumb.replaceChildren('Platform', ' / ', VIEW_LABELS[view] ?? 'Overview')
  for (const element of document.querySelectorAll<HTMLElement>('.view')) element.classList.toggle('active', element.dataset.view === view)
  for (const element of document.querySelectorAll<HTMLButtonElement>('.nav-button')) element.setAttribute('aria-current', element.dataset.view === view ? 'page' : 'false')
  const nav = document.getElementById('admin-nav')
  if (nav?.matches(':popover-open')) nav.hidePopover()
  document.querySelector<HTMLElement>('.content')?.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  requestAnimationFrame(moveNavIndicator)
}

let tenants: Tenant[] = []
let models: Model[] = []
let bindings: Binding[] = []

function addHandlers(): void {
  document.getElementById('export-audit')!.addEventListener('click', () => { void exportPlatformAudit().catch(showError) })
  document.getElementById('tenant-edit-close')!.addEventListener('click', closeTenantEditor)
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
    actions.append(button('Open', () => { selectedTenant = tenant.id; void openTenant(tenant.id).catch(showError) }))
    actions.append(button(tenant.status === 'active' ? 'Suspend' : 'Resume', () => tenant.status === 'active' ? suspendTenant(tenant.id) : resumeTenant(tenant.id)))
    return [tenant.name, tenant.id, tenant.idpIssuer, pill(tenant.status), String(tenant.usage.users), String(tenant.usage.devices), String(tenant.usage.deviceTickets), String(tenant.usage.cloudTickets), actions]
  })
  const rendered = table(['Name', 'Tenant', 'Issuer', 'Status', 'Users', 'Devices', 'Device tickets', 'Cloud tickets', ''], rows, 'Tenants')
  rendered.querySelectorAll<HTMLTableRowElement>('tbody tr').forEach((row, index) => { const tenantId = filtered[index]?.id ?? ''; row.setAttribute('data-tenant-id', tenantId); row.style.viewTransitionName = `tenant-${tenantId.replace(/[^a-zA-Z0-9_-]/gu, '-')}` })
  host.replaceChildren(rendered)
}

function renderModels(): void {
  const host = document.getElementById('models')!
  host.replaceChildren(table(['ID', 'Name', 'Provider', 'Model', 'Enabled'], models.map(model => [model.id, model.name, model.provider, model.model, String(model.enabled)]), 'Model catalog'))
}

function renderBindings(): void {
  const host = document.getElementById('bindings')!
  host.replaceChildren(table(['ID', 'Provider', 'External', 'Tenant', 'Repo', 'Base', 'Auto'], bindings.map(binding => [binding.id, binding.provider, binding.externalId, binding.tenantId, binding.repoUrl ?? '', binding.baseRef ?? '', String(binding.autoDispatch)]), 'Source bindings'))
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
  overview.replaceChildren(table(['Name', 'Tenant', 'Status', 'Users'], tenants.slice(0, 5).map(tenant => [tenant.name, tenant.id, pill(tenant.status), String(tenant.usage.users)]), 'Recent tenants'))
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
  supportHost.replaceChildren(table(['Tenant', 'Reason', 'Status', 'Requested by'], supportResult.requests.map(request => [request.tenantId, request.reason, request.status, request.requestedBy])))
  renderNotifications(supportResult.requests)
  const auditHost = document.getElementById('audit')!
  auditHost.replaceChildren(table(['Actor', 'Action', 'Target', 'Detail', 'At'], auditResult.audit.map(event => [event.actor, event.action, event.target, event.detail ?? '', new Date(event.createdAt).toLocaleString()]), 'Platform audit'))
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

function closeTenantDialog(dialog: HTMLDialogElement): void {
  closeTenantEditor()
  if (!dialog.open || dialog.dataset.closing === 'true') return
  const source = tenantDialogSource
  if (source === undefined || dialog.animate === undefined) { dialog.close(); return }
  dialog.dataset.closing = 'true'
  const target = dialog.getBoundingClientRect()
  const dx = source.left + source.width / 2 - (target.left + target.width / 2)
  const dy = source.top + source.height / 2 - (target.top + target.height / 2)
  const animation = dialog.animate([
    { transform: 'none', opacity: 1, clipPath: 'inset(0 round 18px)' },
    { transform: `translate(${dx}px, ${dy}px) scale(0.82)`, opacity: 0.3, clipPath: 'inset(0 round 16px)' },
  ], { duration: 320, easing: 'cubic-bezier(.4,0,1,1)' })
  void animation.finished.finally(() => { dialog.close(); dialog.dataset.closing = 'false' })
}

function openTenantEditor(title: string, element: ReturnType<typeof createElement>): void {
  const dialog = document.getElementById('tenant-edit-dialog') as HTMLDialogElement
  tenantEditRoot?.unmount()
  tenantEditRoot = createRoot(document.getElementById('tenant-edit-form-root')!)
  document.getElementById('tenant-edit-title')!.textContent = title
  tenantEditRoot.render(element)
  if (!dialog.open) dialog.showModal()
}

function closeTenantEditor(): void {
  const dialog = document.getElementById('tenant-edit-dialog') as HTMLDialogElement
  if (dialog.open) dialog.close()
  tenantEditRoot?.unmount()
  tenantEditRoot = undefined
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
  const host = document.getElementById('tenant-detail')!
  const dialog = document.getElementById('tenant-dialog') as HTMLDialogElement
  closeTenantEditor()
  host.innerHTML = `
    <div class="card detail">
      <div class="tenant-hero">
        <div>
          <p class="eyebrow">Tenant</p>
          <h2 id="detail-title"></h2>
          <div class="tenant-meta"><span id="detail-id" class="mono"></span><span id="detail-status"></span></div>
        </div>
        <div class="detail-actions">
          <button id="edit-tenant" class="button" type="button">Edit profile</button>
          <button id="detail-status-button" class="button" type="button"></button>
          <button id="close-detail" class="button" type="button">Close</button>
        </div>
      </div>
      <div class="metric-grid" id="detail-metrics"></div>
      <div class="detail-grid">
        <section class="detail-panel">
          <div class="detail-panel-head"><h3>Tenant profile</h3><button id="edit-tenant-panel" class="button small" type="button">Edit</button></div>
          <dl class="info-list">
            <div><dt>IdP issuer</dt><dd id="detail-issuer"></dd></div>
            <div><dt>Created</dt><dd id="detail-created"></dd></div>
          </dl>
        </section>
        <section class="detail-panel">
          <div class="detail-panel-head"><h3>Quota</h3><button id="edit-quota" class="button small" type="button">Edit</button></div>
          <dl class="info-list">
            <div><dt>Users</dt><dd id="detail-q-users"></dd></div>
            <div><dt>Devices</dt><dd id="detail-q-devices"></dd></div>
            <div><dt>Cloud tickets / day</dt><dd id="detail-q-cloud"></dd></div>
            <div><dt>Device tickets / day</dt><dd id="detail-q-device"></dd></div>
          </dl>
        </section>
        <section class="detail-panel">
          <div class="detail-panel-head"><h3>Billing</h3><button id="edit-billing" class="button small" type="button">Edit</button></div>
          <dl class="info-list">
            <div><dt>Currency</dt><dd id="detail-b-currency"></dd></div>
            <div><dt>Cloud ticket</dt><dd id="detail-b-cloud"></dd></div>
            <div><dt>Device ticket</dt><dd id="detail-b-device"></dd></div>
            <div><dt>Monthly budget</dt><dd id="detail-b-budget"></dd></div>
            <div><dt>Current estimate</dt><dd id="detail-estimate"></dd></div>
          </dl>
        </section>
      </div>
      <div class="section-heading"><h3>Users</h3><button id="add-user" class="button small" type="button">Add user</button></div><div id="detail-users"></div>
      <div class="section-heading"><h3>Models</h3></div><div id="detail-models"></div>
      <div class="section-heading"><h3>Model upstreams</h3><button id="add-upstream" class="button small" type="button">Add upstream</button></div><div id="detail-upstreams"></div>
      <div class="section-heading"><h3>Support access</h3><button id="request-support" class="button small" type="button">Request support</button></div><div id="detail-support"></div>
      <h3>Usage (14d)</h3><div id="detail-usage"></div>
      <h3>Audit summary</h3><div class="pre" id="detail-audit"></div>
    </div>`
  ;(document.getElementById('detail-title') as HTMLElement).textContent = `${tenant.name} · ${tenant.id}`
  document.getElementById('close-detail')!.addEventListener('click', () => { closeTenantDialog(dialog) })
  dialog.addEventListener('cancel', event => { if (dialog.dataset.closing !== 'true') { event.preventDefault(); closeTenantDialog(dialog) } })
  dialog.addEventListener('close', () => { closeTenantEditor(); selectedTenant = undefined; tenantDialogSource = undefined }, { once: true })
  if (!dialog.open) {
    const source = document.querySelector<HTMLElement>(`[data-tenant-id="${CSS.escape(tenantId)}"]`)
    const sourceRect = source?.getBoundingClientRect()
    tenantDialogSource = sourceRect
    dialog.showModal()
    if (sourceRect !== undefined && dialog.animate !== undefined) {
      const target = dialog.getBoundingClientRect()
      const dx = sourceRect.left + sourceRect.width / 2 - (target.left + target.width / 2)
      const dy = sourceRect.top + sourceRect.height / 2 - (target.top + target.height / 2)
      dialog.animate([
        { transform: `translate(${dx}px, ${dy}px) scale(0.82)`, opacity: 0.35, clipPath: 'inset(0 round 16px)' },
        { transform: 'none', opacity: 1, clipPath: 'inset(0 round 18px)' },
      ], { duration: 420, easing: 'cubic-bezier(.32,.72,0,1)' })
    }
  }
  ;(document.getElementById('detail-title') as HTMLElement).textContent = tenant.name
  ;(document.getElementById('detail-id') as HTMLElement).textContent = tenant.id
  document.getElementById('detail-status')!.replaceChildren(pill(tenant.status))
  ;(document.getElementById('detail-issuer') as HTMLElement).textContent = tenant.idpIssuer
  ;(document.getElementById('detail-created') as HTMLElement).textContent = new Date(tenant.createdAt).toLocaleString()
  ;(document.getElementById('detail-q-users') as HTMLElement).textContent = String(quotaResult.quota.maxUsers)
  ;(document.getElementById('detail-q-devices') as HTMLElement).textContent = String(quotaResult.quota.maxDevices)
  ;(document.getElementById('detail-q-cloud') as HTMLElement).textContent = String(quotaResult.quota.maxCloudTicketsPerDay)
  ;(document.getElementById('detail-q-device') as HTMLElement).textContent = String(quotaResult.quota.maxDeviceTicketsPerDay)
  ;(document.getElementById('detail-b-currency') as HTMLElement).textContent = billingResult.billing.currency
  ;(document.getElementById('detail-b-cloud') as HTMLElement).textContent = String(billingResult.billing.cloudTicketCents)
  ;(document.getElementById('detail-b-device') as HTMLElement).textContent = String(billingResult.billing.deviceTicketCents)
  ;(document.getElementById('detail-b-budget') as HTMLElement).textContent = billingResult.billing.monthlyBudgetCents === null ? 'No budget' : String(billingResult.billing.monthlyBudgetCents)
  ;(document.getElementById('detail-estimate') as HTMLElement).textContent = `${billingResult.estimate.estimatedCents} ${billingResult.estimate.currency}`
  ;(document.getElementById('detail-metrics') as HTMLElement).replaceChildren(
    metricCard(String(tenant.usage.users), 'users', 'in tenant'),
    metricCard(String(tenant.usage.devices), 'devices', 'paired'),
    metricCard(String(tenant.usage.cloudTickets), 'cloud tickets', 'this period'),
    metricCard(String(tenant.usage.deviceTickets), 'device tickets', 'this period'),
  )
  const statusButton = document.getElementById('detail-status-button') as HTMLButtonElement
  statusButton.textContent = tenant.status === 'active' ? 'Suspend' : 'Resume'
  statusButton.addEventListener('click', () => { void (tenant.status === 'active' ? suspendTenant(tenant.id) : resumeTenant(tenant.id)).catch(showError) })
  const initial: TenantInitialValues = {
    name: tenant.name,
    idpIssuer: tenant.idpIssuer,
    quota: quotaResult.quota,
    billing: billingResult.billing,
    models: tenantModelResult.models.map(model => model.id),
  }
  document.getElementById('edit-tenant')!.addEventListener('click', () => openTenantEditor('Edit tenant profile', createElement(TenantProfileForm, { initial, onSubmit: async values => { await saveTenant(tenant.id, values); closeTenantEditor() } })))
  document.getElementById('edit-tenant-panel')!.addEventListener('click', () => openTenantEditor('Edit tenant profile', createElement(TenantProfileForm, { initial, onSubmit: async values => { await saveTenant(tenant.id, values); closeTenantEditor() } })))
  document.getElementById('edit-quota')!.addEventListener('click', () => openTenantEditor('Edit tenant quota', createElement(TenantQuotaForm, { initial, onSubmit: async values => { await saveQuota(tenant.id, values); closeTenantEditor() } })))
  document.getElementById('edit-billing')!.addEventListener('click', () => openTenantEditor('Edit tenant billing', createElement(TenantBillingForm, { initial, onSubmit: async values => { await saveBilling(tenant.id, values); closeTenantEditor() } })))
  document.getElementById('add-user')!.addEventListener('click', () => openTenantEditor('Add tenant user', createElement(AddTenantUserForm, { onSubmit: async values => { await addUser(tenant.id, values); closeTenantEditor() } })))
  document.getElementById('add-upstream')!.addEventListener('click', () => openTenantEditor('Add model upstream', createElement(AddUpstreamForm, { models: initial.models, onSubmit: async values => { await addUpstream(tenant.id, values); closeTenantEditor() } })))
  document.getElementById('request-support')!.addEventListener('click', () => openTenantEditor('Request support access', createElement(RequestSupportForm, { onSubmit: async values => { await requestSupport(tenant.id, values); closeTenantEditor() } })))
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
    renderShell()
    await loadAll()
  },
}))

if (token() !== '') { renderShell(); void loadAll().catch(showError) }

/** Standalone SiriusX platform administration SPA. */

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
const tokenInput = document.getElementById('token') as HTMLInputElement
const loadButton = document.getElementById('load') as HTMLButtonElement
const errorBox = document.getElementById('error')!
let selectedTenant: string | undefined
let tenantQuery = ''
let tenantStatus = ''
let supportRequests: SupportRequest[] = []
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

function showAuthError(error: unknown): void {
  const box = document.getElementById('auth-error')!
  box.textContent = error instanceof Error ? error.message : String(error)
  box.hidden = false
}

function clearAuthError(): void { const box = document.getElementById('auth-error')!; box.textContent = ''; box.hidden = true }

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
  supportRequests = requests
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

function input(placeholder: string, value = ''): HTMLInputElement {
  const element = node('input')
  element.placeholder = placeholder
  element.setAttribute('aria-label', placeholder)
  element.value = value
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

function section(title: string): HTMLElement {
  const element = node('section')
  element.append(node('h2', title))
  return element
}

function pill(status: string, className?: string): HTMLElement {
  return node('span', status, `pill ${className ?? (status === 'active' ? 'active' : status === 'suspended' ? 'suspended' : '')}`.trim())
}

function renderShell(): void {
  app.innerHTML = `
    <div class="workspace">
      <aside class="sidenav">
        <div class="nav-label">Workspace</div>
        <nav aria-label="Platform administration" id="admin-nav">
          <span class="nav-indicator" aria-hidden="true"></span>
          <button class="nav-button" type="button" data-view="overview" aria-current="page"><span class="dot"></span>Overview</button>
          <button class="nav-button" type="button" data-view="tenants"><span class="dot"></span>Tenants</button>
          <button class="nav-button" type="button" data-view="models"><span class="dot"></span>Models</button>
          <button class="nav-button" type="button" data-view="sources"><span class="dot"></span>Sources</button>
          <button class="nav-button" type="button" data-view="support"><span class="dot"></span>Support</button>
          <button class="nav-button" type="button" data-view="audit"><span class="dot"></span>Audit</button>
        </nav>
        <div class="nav-foot">Connected to<br><strong>Control Plane</strong></div>
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
          <search class="toolbar" aria-label="Filter tenants">
            <form id="tenant-filters" class="form">
              <div class="form-field"><label for="tenant-filter">Search tenants</label><input id="tenant-filter" type="search" placeholder="Name, ID, or issuer" autocomplete="off"></div>
              <div class="form-field compact-field"><label for="tenant-status-filter">Status</label><select id="tenant-status-filter"><option value="">All</option><option value="active">Active</option><option value="suspended">Suspended</option></select></div>
              <output id="tenant-count" class="muted" for="tenant-filter tenant-status-filter"></output>
            </form>
          </search>
          <section id="create-tenant" class="card form-card"><div class="section-heading"><div><h2>Create tenant</h2><p class="muted">The tenant ID must match the IdP tenant claim.</p></div></div><div class="form">
            <div class="form-field"><label for="tenant-name">Name</label><input id="tenant-name" placeholder="Acme"></div>
            <div class="form-field"><label for="tenant-issuer">IdP issuer</label><input id="tenant-issuer" placeholder="https://idp.example/realms/siriusx"></div>
            <div class="form-field"><label for="tenant-email">Admin email</label><input id="tenant-email" type="email" placeholder="admin@example.com"></div>
            <div class="form-field"><label for="tenant-id">Tenant ID <span class="muted">(optional)</span></label><input id="tenant-id" placeholder="tenant-acme"></div>
            <div class="form-actions"><button id="create-tenant-button" class="button primary" type="button">Create tenant</button></div>
          </div></section>
          <div id="tenants"></div>
        </section>
        <section class="view" data-view="models" id="view-models">
          <div class="page-head"><div><p class="eyebrow">Routing</p><h1>Models</h1><p class="lede">Catalog models and connect each tenant to one or more upstream providers.</p></div></div>
          <section class="card form-card"><div class="section-heading"><div><h2>Add model</h2><p class="muted">Model IDs are the alias clients request.</p></div></div><div class="form">
            <div class="form-field"><label for="model-id">Model ID <span class="muted">(optional)</span></label><input id="model-id" placeholder="acme-default"></div>
            <div class="form-field"><label for="model-name">Display name</label><input id="model-name" placeholder="Acme default"></div>
            <div class="form-field"><label for="model-provider">Provider</label><input id="model-provider" placeholder="openai"></div>
            <div class="form-field"><label for="model-model">Provider model ID</label><input id="model-model" placeholder="gpt-4.1"></div>
            <div class="form-actions"><button id="create-model-button" class="button primary" type="button">Add model</button></div>
          </div></section>
          <div id="models"></div>
        </section>
        <section class="view" data-view="sources" id="view-sources">
          <div class="page-head"><div><p class="eyebrow">Integrations</p><h1>Sources</h1><p class="lede">Map Git repositories and messaging channels to tenant workspaces.</p></div></div>
          <section class="card form-card"><div class="section-heading"><div><h2>Add source binding</h2><p class="muted">Bind an external repository or channel to a tenant.</p></div></div><div class="form">
            <div class="form-field"><label for="source-provider">Provider</label><input id="source-provider" placeholder="gitlab"></div>
            <div class="form-field"><label for="source-external">External ID</label><input id="source-external" placeholder="group/project"></div>
            <div class="form-field"><label for="source-tenant">Tenant ID</label><input id="source-tenant" placeholder="tenant-acme"></div>
            <div class="form-field"><label for="source-repo">Repository URL <span class="muted">(optional)</span></label><input id="source-repo" type="url" placeholder="https://github.com/acme/repo.git"></div>
            <div class="form-field"><label for="source-base">Base ref <span class="muted">(optional)</span></label><input id="source-base" placeholder="main"></div>
            <label class="row"><input id="source-auto" type="checkbox"> Auto-dispatch incoming events</label>
            <div class="form-actions"><button id="create-source-button" class="button primary" type="button">Add binding</button></div>
          </div></section>
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
    <dialog id="tenant-dialog" aria-labelledby="detail-title"><div id="tenant-detail"></div></dialog>`
  addHandlers()
  requestAnimationFrame(moveNavIndicator)
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

function showView(view: string): void {
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
  document.getElementById('create-tenant-button')!.addEventListener('click', () => { void createTenant().catch(showError) })
  document.getElementById('create-model-button')!.addEventListener('click', () => { void createModel().catch(showError) })
  document.getElementById('create-source-button')!.addEventListener('click', () => { void createBinding().catch(showError) })
  document.getElementById('export-audit')!.addEventListener('click', () => { void exportPlatformAudit().catch(showError) })
  for (const item of document.querySelectorAll<HTMLButtonElement>('.nav-button, [data-go]')) {
    item.addEventListener('click', () => showView(item.dataset.view ?? item.dataset.go ?? 'overview'))
  }
  document.getElementById('tenant-filter')!.addEventListener('input', event => { tenantQuery = (event.target as HTMLInputElement).value; renderTenants(true) })
  document.getElementById('tenant-status-filter')!.addEventListener('change', event => { tenantStatus = (event.target as HTMLSelectElement).value; renderTenants(true) })
  document.getElementById('tenant-filters')!.addEventListener('submit', event => event.preventDefault())
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

async function createTenant(): Promise<void> {
  const tenantId = (document.getElementById('tenant-id') as HTMLInputElement).value.trim()
  await api('/v1/admin/tenants', { method: 'POST', body: JSON.stringify({
    name: (document.getElementById('tenant-name') as HTMLInputElement).value,
    idpIssuer: (document.getElementById('tenant-issuer') as HTMLInputElement).value,
    adminEmail: (document.getElementById('tenant-email') as HTMLInputElement).value,
    ...(tenantId === '' ? {} : { tenantId }),
  }) })
  await loadAll()
  notify('Tenant created')
}

async function createModel(): Promise<void> {
  const id = (document.getElementById('model-id') as HTMLInputElement).value.trim()
  await api('/v1/admin/models', { method: 'POST', body: JSON.stringify({
    ...(id === '' ? {} : { id }),
    name: (document.getElementById('model-name') as HTMLInputElement).value,
    provider: (document.getElementById('model-provider') as HTMLInputElement).value,
    model: (document.getElementById('model-model') as HTMLInputElement).value,
  }) })
  await loadAll()
  notify('Model added')
}

async function createBinding(): Promise<void> {
  const repo = (document.getElementById('source-repo') as HTMLInputElement).value.trim()
  const base = (document.getElementById('source-base') as HTMLInputElement).value.trim()
  await api('/v1/admin/source-bindings', { method: 'POST', body: JSON.stringify({
    provider: (document.getElementById('source-provider') as HTMLInputElement).value,
    externalId: (document.getElementById('source-external') as HTMLInputElement).value,
    tenantId: (document.getElementById('source-tenant') as HTMLInputElement).value,
    ...(repo === '' ? {} : { repoUrl: repo }),
    ...(base === '' ? {} : { baseRef: base }),
    autoDispatch: (document.getElementById('source-auto') as HTMLInputElement).checked,
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
  host.innerHTML = `
    <div class="card detail"><div class="row"><h2 id="detail-title"></h2><button id="close-detail" class="right">Close</button></div>
      <div class="grid">
        <div><h4>Tenant config</h4><div class="form"><input id="detail-name" placeholder="Tenant name"><input id="detail-issuer" placeholder="IdP issuer"><button id="save-tenant">Save</button></div></div>
        <div><h4>Quota</h4><div class="grid"><input id="q-users" placeholder="Max users"><input id="q-devices" placeholder="Max devices"><input id="q-cloud" placeholder="Max cloud/day"><input id="q-device-tickets" placeholder="Max device tickets/day"></div><button id="save-quota">Save quota</button></div>
        <div><h4>Billing</h4><div class="grid"><input id="b-currency" placeholder="Currency"><input id="b-cloud" placeholder="Cloud ticket cents"><input id="b-device" placeholder="Device ticket cents"><input id="b-budget" placeholder="Monthly budget (blank = none)"></div><button id="save-billing">Save billing</button><div class="muted" id="b-estimate"></div></div>
      </div>
      <h3>Users</h3><div class="form"><input id="new-user-email" placeholder="User email"><select id="new-user-role"><option value="member">member</option><option value="admin">admin</option></select><button id="add-user">Add user</button></div><div id="detail-users"></div>
      <h3>Models</h3><div id="detail-models"></div>
      <h3>Model upstreams</h3><div class="form"><select id="up-model"></select><input id="up-name" placeholder="Upstream name"><select id="up-protocol"><option value="chat">chat</option><option value="responses">responses</option><option value="claude">claude</option></select><input id="up-url" placeholder="https://upstream/v1 (base URL)"><input id="up-remote-model" placeholder="Upstream model"><input id="up-key" type="password" placeholder="API key (leave blank to keep)"><input id="up-priority" type="number" placeholder="Priority" value="0"><label><input id="up-enabled" type="checkbox" checked> enabled</label><button id="add-upstream" class="primary">Add upstream</button></div><div id="detail-upstreams"></div>
      <h3>Support access</h3><div class="form"><input id="support-reason" placeholder="Support reason"><button id="request-support">Request support</button></div><div id="detail-support"></div>
      <h3>Usage (14d)</h3><div id="detail-usage"></div>
      <h3>Audit summary</h3><div class="pre" id="detail-audit"></div>
    </div>`
  ;(document.getElementById('detail-title') as HTMLElement).textContent = `${tenant.name} · ${tenant.id}`
  document.getElementById('close-detail')!.addEventListener('click', () => { closeTenantDialog(dialog) })
  dialog.addEventListener('cancel', event => { if (dialog.dataset.closing !== 'true') { event.preventDefault(); closeTenantDialog(dialog) } })
  dialog.addEventListener('close', () => { selectedTenant = undefined; tenantDialogSource = undefined }, { once: true })
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
  ;(document.getElementById('detail-name') as HTMLInputElement).value = tenant.name
  ;(document.getElementById('detail-issuer') as HTMLInputElement).value = tenant.idpIssuer
  document.getElementById('save-tenant')!.addEventListener('click', () => { void saveTenant(tenantId).catch(showError) })
  ;(document.getElementById('q-users') as HTMLInputElement).value = String(quotaResult.quota.maxUsers)
  ;(document.getElementById('q-devices') as HTMLInputElement).value = String(quotaResult.quota.maxDevices)
  ;(document.getElementById('q-cloud') as HTMLInputElement).value = String(quotaResult.quota.maxCloudTicketsPerDay)
  ;(document.getElementById('q-device-tickets') as HTMLInputElement).value = String(quotaResult.quota.maxDeviceTicketsPerDay)
  document.getElementById('save-quota')!.addEventListener('click', () => { void saveQuota(tenantId).catch(showError) })
  ;(document.getElementById('b-currency') as HTMLInputElement).value = billingResult.billing.currency
  ;(document.getElementById('b-cloud') as HTMLInputElement).value = String(billingResult.billing.cloudTicketCents)
  ;(document.getElementById('b-device') as HTMLInputElement).value = String(billingResult.billing.deviceTicketCents)
  ;(document.getElementById('b-budget') as HTMLInputElement).value = billingResult.billing.monthlyBudgetCents === null ? '' : String(billingResult.billing.monthlyBudgetCents)
  document.getElementById('b-estimate')!.textContent = `Estimate: ${billingResult.estimate.estimatedCents} ${billingResult.estimate.currency}`
  document.getElementById('save-billing')!.addEventListener('click', () => { void saveBilling(tenantId).catch(showError) })
  document.getElementById('add-user')!.addEventListener('click', () => { void addUser(tenantId).catch(showError) })
  document.getElementById('request-support')!.addEventListener('click', () => { void requestSupport(tenantId).catch(showError) })
  ;(document.getElementById('detail-users') as HTMLElement).replaceChildren(table(['Email', 'Role', 'User ID'], userResult.users.map(user => [user.email, user.role, user.userId])))
  const upstreamSelect = document.getElementById('up-model') as HTMLSelectElement
  for (const model of tenantModelResult.models) upstreamSelect.append(new Option(model.id, model.id))
  document.getElementById('add-upstream')!.addEventListener('click', () => { void addUpstream(tenantId).catch(showError) })
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

async function addUpstream(tenantId: string): Promise<void> {
  const modelId = (document.getElementById('up-model') as HTMLSelectElement).value
  if (modelId === '') throw new Error('bind a model to the tenant first')
  const key = (document.getElementById('up-key') as HTMLInputElement).value
  await api(`/v1/admin/tenants/${encodeURIComponent(tenantId)}/models/${encodeURIComponent(modelId)}/upstreams`, { method: 'POST', body: JSON.stringify({
    name: (document.getElementById('up-name') as HTMLInputElement).value,
    protocol: (document.getElementById('up-protocol') as HTMLSelectElement).value,
    baseUrl: (document.getElementById('up-url') as HTMLInputElement).value,
    upstreamModel: (document.getElementById('up-remote-model') as HTMLInputElement).value,
    ...(key === '' ? {} : { apiKey: key }),
    priority: Number((document.getElementById('up-priority') as HTMLInputElement).value || '0'),
    enabled: (document.getElementById('up-enabled') as HTMLInputElement).checked,
  }) })
  await openTenant(tenantId)
  notify('Upstream added')
}

async function saveTenant(tenantId: string): Promise<void> {
  await api(`/v1/admin/tenants/${encodeURIComponent(tenantId)}`, { method: 'PUT', body: JSON.stringify({
    name: (document.getElementById('detail-name') as HTMLInputElement).value,
    idpIssuer: (document.getElementById('detail-issuer') as HTMLInputElement).value,
  }) })
  await loadAll(); await openTenant(tenantId)
  notify('Tenant updated')
}

async function saveQuota(tenantId: string): Promise<void> {
  await api(`/v1/admin/tenants/${encodeURIComponent(tenantId)}/quota`, { method: 'PUT', body: JSON.stringify({
    maxUsers: Number((document.getElementById('q-users') as HTMLInputElement).value),
    maxDevices: Number((document.getElementById('q-devices') as HTMLInputElement).value),
    maxCloudTicketsPerDay: Number((document.getElementById('q-cloud') as HTMLInputElement).value),
    maxDeviceTicketsPerDay: Number((document.getElementById('q-device-tickets') as HTMLInputElement).value),
  }) })
  await openTenant(tenantId)
  notify('Quota saved')
}

async function saveBilling(tenantId: string): Promise<void> {
  const budget = (document.getElementById('b-budget') as HTMLInputElement).value.trim()
  await api(`/v1/admin/tenants/${encodeURIComponent(tenantId)}/billing`, { method: 'PUT', body: JSON.stringify({
    currency: (document.getElementById('b-currency') as HTMLInputElement).value,
    cloudTicketCents: Number((document.getElementById('b-cloud') as HTMLInputElement).value),
    deviceTicketCents: Number((document.getElementById('b-device') as HTMLInputElement).value),
    monthlyBudgetCents: budget === '' ? null : Number(budget),
  }) })
  await openTenant(tenantId)
  notify('Billing saved')
}

async function addUser(tenantId: string): Promise<void> {
  const email = (document.getElementById('new-user-email') as HTMLInputElement).value
  const role = (document.getElementById('new-user-role') as HTMLSelectElement).value
  await api(`/v1/admin/tenants/${encodeURIComponent(tenantId)}/users`, { method: 'POST', body: JSON.stringify({ email, role }) })
  await openTenant(tenantId)
  notify('User added')
}

async function requestSupport(tenantId: string): Promise<void> {
  const reason = (document.getElementById('support-reason') as HTMLInputElement).value
  await api(`/v1/admin/tenants/${encodeURIComponent(tenantId)}/support-requests`, { method: 'POST', body: JSON.stringify({ reason }) })
  await loadAll(); await openTenant(tenantId)
  notify('Support request sent')
}

initHeader()

document.getElementById('auth-form')!.addEventListener('submit', event => {
  event.preventDefault()
  sessionStorage.setItem('siriusx.platformToken', tokenInput.value)
  selectedTenant = undefined
  clearAuthError()
  renderShell()
  void loadAll().catch(error => {
    if (error instanceof ApiError && error.status === 401) showAuthError(error)
    else showError(error)
  })
})

if (token() !== '') { tokenInput.value = token(); renderShell(); void loadAll().catch(error => { if (error instanceof ApiError && error.status === 401) showAuthError(error); else showError(error) }) }

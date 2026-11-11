/** Standalone SiriusX platform administration SPA. */

type Json = Record<string, unknown>
type Tenant = { id: string; name: string; idpIssuer: string; createdAt: number; status: 'active' | 'suspended'; usage: { users: number; devices: number; deviceTickets: number; cloudTickets: number } }
type Model = { id: string; name: string; provider: string; model: string; enabled: boolean }
type Binding = { id: string; provider: string; externalId: string; tenantId: string; botId: string | null; repoUrl: string | null; baseRef: string | null; autoDispatch: boolean }
type SupportRequest = { id: string; tenantId: string; requestedBy: string; reason: string; status: string }
type Audit = { id: number; actor: string; action: string; target: string; detail: string | null; createdAt: number }
type User = { userId: string; email: string; role: string }
type Quota = { maxUsers: number; maxDevices: number; maxCloudTicketsPerDay: number; maxDeviceTicketsPerDay: number }
type Billing = { currency: string; cloudTicketCents: number; deviceTicketCents: number; monthlyBudgetCents: number | null }

const app = document.getElementById('app')!
const tokenInput = document.getElementById('token') as HTMLInputElement
const loadButton = document.getElementById('load') as HTMLButtonElement
const errorBox = document.getElementById('error')!
let selectedTenant: string | undefined

function showError(error: unknown): void {
  errorBox.textContent = error instanceof Error ? error.message : String(error)
  errorBox.classList.add('visible')
}

function clearError(): void { errorBox.textContent = ''; errorBox.classList.remove('visible') }

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
  if (!response.ok) throw new Error(typeof value === 'object' && value !== null && 'error' in value ? String((value as Json).error) : `HTTP ${response.status}`)
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
  element.value = value
  return element
}

function table(headers: readonly string[], rows: ReadonlyArray<ReadonlyArray<string | Node>>): HTMLTableElement {
  const element = node('table')
  const head = node('tr')
  for (const header of headers) head.append(node('th', header))
  const thead = node('thead'); thead.append(head); element.append(thead)
  const body = node('tbody')
  for (const values of rows) {
    const tr = node('tr')
    for (const value of values) {
      const td = node('td')
      if (value instanceof Node) td.append(value)
      else td.textContent = value
      tr.append(td)
    }
    body.append(tr)
  }
  element.append(body)
  return element
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
    <section id="create-tenant"><h2>Tenants</h2><div class="form">
      <input id="tenant-name" placeholder="Name">
      <input id="tenant-issuer" placeholder="IdP issuer">
      <input id="tenant-email" placeholder="Admin email">
      <input id="tenant-id" placeholder="Tenant id (optional)">
      <button id="create-tenant-button" class="primary">Create tenant</button>
    </div><div id="tenants"></div></section>
    <section><h2>Model catalog</h2><div class="form">
      <input id="model-id" placeholder="Model id (optional)">
      <input id="model-name" placeholder="Display name">
      <input id="model-provider" placeholder="Provider">
      <input id="model-model" placeholder="Provider model id">
      <button id="create-model-button" class="primary">Add model</button>
    </div><div id="models"></div></section>
    <section><h2>Source bindings</h2><div class="form">
      <input id="source-provider" placeholder="provider">
      <input id="source-external" placeholder="external id">
      <input id="source-tenant" placeholder="tenant id">
      <input id="source-repo" placeholder="repo URL (optional)">
      <input id="source-base" placeholder="base ref (optional)">
      <label class="row"><input id="source-auto" type="checkbox"> auto dispatch</label>
      <button id="create-source-button" class="primary">Add binding</button>
    </div><div id="bindings"></div></section>
    <section><h2>Support requests</h2><div id="support"></div></section>
    <section><div class="row"><h2>Platform audit</h2><button id="export-audit" class="right">Export CSV</button></div><div id="audit"></div></section>
    <section id="tenant-detail"></section>`
  addHandlers()
}

let tenants: Tenant[] = []
let models: Model[] = []
let bindings: Binding[] = []

function addHandlers(): void {
  document.getElementById('create-tenant-button')!.addEventListener('click', () => { void createTenant().catch(showError) })
  document.getElementById('create-model-button')!.addEventListener('click', () => { void createModel().catch(showError) })
  document.getElementById('create-source-button')!.addEventListener('click', () => { void createBinding().catch(showError) })
  document.getElementById('export-audit')!.addEventListener('click', () => { void exportPlatformAudit().catch(showError) })
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

function renderTenants(): void {
  const host = document.getElementById('tenants')!
  const rows = tenants.map(tenant => {
    const actions = node('div', undefined, 'row')
    actions.append(button('Open', () => { selectedTenant = tenant.id; void openTenant(tenant.id).catch(showError) }))
    actions.append(button(tenant.status === 'active' ? 'Suspend' : 'Resume', async () => {
      await api(`/v1/admin/tenants/${encodeURIComponent(tenant.id)}/status`, { method: 'POST', body: JSON.stringify({ status: tenant.status === 'active' ? 'suspended' : 'active' }) })
      await loadAll()
    }))
    return [tenant.name, tenant.id, tenant.idpIssuer, pill(tenant.status), String(tenant.usage.users), String(tenant.usage.devices), String(tenant.usage.deviceTickets), String(tenant.usage.cloudTickets), actions]
  })
  host.replaceChildren(table(['Name', 'Tenant', 'Issuer', 'Status', 'Users', 'Devices', 'Device tickets', 'Cloud tickets', ''], rows))
}

function renderModels(): void {
  const host = document.getElementById('models')!
  host.replaceChildren(table(['ID', 'Name', 'Provider', 'Model', 'Enabled'], models.map(model => [model.id, model.name, model.provider, model.model, String(model.enabled)])))
}

function renderBindings(): void {
  const host = document.getElementById('bindings')!
  host.replaceChildren(table(['ID', 'Provider', 'External', 'Tenant', 'Repo', 'Base', 'Auto'], bindings.map(binding => [binding.id, binding.provider, binding.externalId, binding.tenantId, binding.repoUrl ?? '', binding.baseRef ?? '', String(binding.autoDispatch)])))
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
  const auditHost = document.getElementById('audit')!
  auditHost.replaceChildren(table(['Actor', 'Action', 'Target', 'Detail', 'At'], auditResult.audit.map(event => [event.actor, event.action, event.target, event.detail ?? '', new Date(event.createdAt).toLocaleString()])))
  if (selectedTenant !== undefined) await openTenant(selectedTenant)
}

async function openTenant(tenantId: string): Promise<void> {
  const tenant = tenants.find(item => item.id === tenantId)
  if (tenant === undefined) return
  const [userResult, quotaResult, dailyResult, billingResult, tenantModelResult, auditResult, supportResult] = await Promise.all([
    api<{ users: User[] }>(`/v1/admin/tenants/${encodeURIComponent(tenantId)}/users`),
    api<{ quota: Quota; usage: Json }>(`/v1/admin/tenants/${encodeURIComponent(tenantId)}/quota`),
    api<{ days: number; usage: Array<{ date: string; cloudTickets: number; deviceTickets: number }> }>(`/v1/admin/tenants/${encodeURIComponent(tenantId)}/usage-daily?days=14`),
    api<{ billing: Billing; estimate: { estimatedCents: number; currency: string } }>(`/v1/admin/tenants/${encodeURIComponent(tenantId)}/billing`),
    api<{ models: Array<{ id: string; name: string; isDefault: boolean }> }>(`/v1/admin/tenants/${encodeURIComponent(tenantId)}/models`),
    api<{ total: number; decisions: Record<string, number> }>(`/v1/admin/tenants/${encodeURIComponent(tenantId)}/audit-summary`).catch(() => ({ total: 0, decisions: {} })),
    api<{ requests: SupportRequest[] }>('/v1/admin/support-requests'),
  ])
  const host = document.getElementById('tenant-detail')!
  host.innerHTML = `
    <div class="card detail"><div class="row"><h2 id="detail-title"></h2><button id="close-detail" class="right">Close</button></div>
      <div class="grid">
        <div><h4>Tenant config</h4><div class="form"><input id="detail-name" placeholder="Tenant name"><input id="detail-issuer" placeholder="IdP issuer"><button id="save-tenant">Save</button></div></div>
        <div><h4>Quota</h4><div class="grid"><input id="q-users" placeholder="Max users"><input id="q-devices" placeholder="Max devices"><input id="q-cloud" placeholder="Max cloud/day"><input id="q-device-tickets" placeholder="Max device tickets/day"></div><button id="save-quota">Save quota</button></div>
        <div><h4>Billing</h4><div class="grid"><input id="b-currency" placeholder="Currency"><input id="b-cloud" placeholder="Cloud ticket cents"><input id="b-device" placeholder="Device ticket cents"><input id="b-budget" placeholder="Monthly budget (blank = none)"></div><button id="save-billing">Save billing</button><div class="muted" id="b-estimate"></div></div>
      </div>
      <h3>Users</h3><div class="form"><input id="new-user-email" placeholder="User email"><select id="new-user-role"><option value="member">member</option><option value="admin">admin</option></select><button id="add-user">Add user</button></div><div id="detail-users"></div>
      <h3>Models</h3><div id="detail-models"></div>
      <h3>Support access</h3><div class="form"><input id="support-reason" placeholder="Support reason"><button id="request-support">Request support</button></div><div id="detail-support"></div>
      <h3>Usage (14d)</h3><div id="detail-usage"></div>
      <h3>Audit summary</h3><div class="pre" id="detail-audit"></div>
    </div>`
  ;(document.getElementById('detail-title') as HTMLElement).textContent = `${tenant.name} · ${tenant.id}`
  document.getElementById('close-detail')!.addEventListener('click', () => { host.replaceChildren() })
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
  const bound = new Map(tenantModelResult.models.map(model => [model.id, model]))
  ;(document.getElementById('detail-models') as HTMLElement).replaceChildren(table(['ID', 'Name', 'Default', ''], models.map(model => {
    const action = button(bound.has(model.id) ? 'Set default' : 'Bind', async () => {
      await api(`/v1/admin/tenants/${encodeURIComponent(tenantId)}/models/${encodeURIComponent(model.id)}`, { method: 'PUT', body: JSON.stringify({ isDefault: bound.get(model.id)?.isDefault === true }) })
      await openTenant(tenantId)
    })
    return [model.id, model.name, String(bound.get(model.id)?.isDefault === true), action]
  })))
  document.getElementById('detail-usage')!.replaceChildren(table(['Date', 'Cloud tickets', 'Device tickets'], dailyResult.usage.map(day => [day.date, String(day.cloudTickets), String(day.deviceTickets)])))
  document.getElementById('detail-audit')!.textContent = JSON.stringify(auditResult, undefined, 2)
  document.getElementById('detail-support')!.replaceChildren(table(['Reason', 'Status', 'Requested by'], supportResult.requests.filter(request => request.tenantId === tenantId).map(request => [request.reason, request.status, request.requestedBy])))
}

async function saveTenant(tenantId: string): Promise<void> {
  await api(`/v1/admin/tenants/${encodeURIComponent(tenantId)}`, { method: 'PUT', body: JSON.stringify({
    name: (document.getElementById('detail-name') as HTMLInputElement).value,
    idpIssuer: (document.getElementById('detail-issuer') as HTMLInputElement).value,
  }) })
  await loadAll(); await openTenant(tenantId)
}

async function saveQuota(tenantId: string): Promise<void> {
  await api(`/v1/admin/tenants/${encodeURIComponent(tenantId)}/quota`, { method: 'PUT', body: JSON.stringify({
    maxUsers: Number((document.getElementById('q-users') as HTMLInputElement).value),
    maxDevices: Number((document.getElementById('q-devices') as HTMLInputElement).value),
    maxCloudTicketsPerDay: Number((document.getElementById('q-cloud') as HTMLInputElement).value),
    maxDeviceTicketsPerDay: Number((document.getElementById('q-device-tickets') as HTMLInputElement).value),
  }) })
  await openTenant(tenantId)
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
}

async function addUser(tenantId: string): Promise<void> {
  const email = (document.getElementById('new-user-email') as HTMLInputElement).value
  const role = (document.getElementById('new-user-role') as HTMLSelectElement).value
  await api(`/v1/admin/tenants/${encodeURIComponent(tenantId)}/users`, { method: 'POST', body: JSON.stringify({ email, role }) })
  await openTenant(tenantId)
}

async function requestSupport(tenantId: string): Promise<void> {
  const reason = (document.getElementById('support-reason') as HTMLInputElement).value
  await api(`/v1/admin/tenants/${encodeURIComponent(tenantId)}/support-requests`, { method: 'POST', body: JSON.stringify({ reason }) })
  await loadAll(); await openTenant(tenantId)
}

loadButton.addEventListener('click', () => {
  sessionStorage.setItem('siriusx.platformToken', tokenInput.value)
  selectedTenant = undefined
  renderShell()
  void loadAll().catch(showError)
})

if (token() !== '') { tokenInput.value = token(); renderShell(); void loadAll().catch(showError) }

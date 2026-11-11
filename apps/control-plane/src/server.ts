/** HTTP entry for the single-box control plane. Production terminates SSO at a gateway. */
import { createHash, createHmac } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import type { Storage } from '@siriusx/storage'
import { ControlPlane, ControlPlaneError, type Session } from './index.ts'
import type { DeviceGateway } from './device-gateway.ts'

export interface ControlPlaneServerOptions {
  readonly dbPath: string
  readonly dataDir: string
  readonly port?: number
  readonly host?: string
  readonly sessionSecret?: string
  readonly toolGatewayUrl?: string
  readonly analyticsPath?: string
  readonly ssoServiceToken?: string
  readonly botScenario?: 'ready' | 'waiting'
  readonly deviceOfflineLostMs?: number
  readonly platformAdminToken?: string
  readonly sourceWebhookToken?: string
  readonly githubWebhookSecret?: string
  readonly storage?: Storage
  readonly cacheRefreshMs?: number
}

export interface ControlPlaneServer {
  readonly server: Server
  readonly url: string
  readonly control: ControlPlane
  setDeviceGateway(gateway: DeviceGateway): void
  close(): Promise<void>
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PUT,OPTIONS',
  'access-control-allow-headers': 'content-type,authorization',
  'cache-control': 'no-store',
}

const MAX_JSON_BODY_BYTES = 1024 * 1024

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.byteLength
    if (total > MAX_JSON_BODY_BYTES) throw new ControlPlaneError(413, 'PAYLOAD_TOO_LARGE', 'request body exceeds 1 MiB')
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text === '') return {}
  const value: unknown = JSON.parse(text)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('expected JSON object')
  return value as Record<string, unknown>
}

async function readRawJson(request: IncomingMessage): Promise<{ body: Record<string, unknown>; raw: Buffer }> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.byteLength
    if (total > MAX_JSON_BODY_BYTES) throw new ControlPlaneError(413, 'PAYLOAD_TOO_LARGE', 'request body exceeds 1 MiB')
    chunks.push(buffer)
  }
  const raw = Buffer.concat(chunks)
  const value: unknown = raw.length === 0 ? {} : JSON.parse(raw.toString('utf8'))
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('expected JSON object')
  return { body: value as Record<string, unknown>, raw }
}

function write(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  response.writeHead(status, { ...CORS, 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) })
  response.end(body)
}

function sessionOf(control: ControlPlane, request: IncomingMessage): Session {
  const header = request.headers.authorization
  if (header === undefined || !header.startsWith('Bearer ')) throw new ControlPlaneError(401, 'UNAUTHORIZED', 'Bearer session token required')
  return control.verifySession(header.slice('Bearer '.length))
}

export async function startControlPlaneServer(options: ControlPlaneServerOptions): Promise<ControlPlaneServer> {
  const control = new ControlPlane({ dbPath: options.dbPath, dataDir: options.dataDir, ...(options.sessionSecret === undefined ? {} : { sessionSecret: options.sessionSecret }), ...(options.botScenario === undefined ? {} : { botScenario: options.botScenario }), ...(options.storage === undefined ? {} : { storage: options.storage }) })
  await control.initialize()
  const cacheRefreshTimer = options.storage === undefined ? undefined : setInterval(() => { void control.refreshCache().catch(() => undefined) }, options.cacheRefreshMs ?? 30_000)
  cacheRefreshTimer?.unref()
  let deviceGateway: DeviceGateway | undefined
  const toolGatewayUrl = options.toolGatewayUrl
  const analyticsPath = options.analyticsPath
  const ssoServiceToken = options.ssoServiceToken
  const platformAdminToken = options.platformAdminToken
  const sourceWebhookToken = options.sourceWebhookToken
  const githubWebhookSecret = options.githubWebhookSecret
  const requirePlatformAdmin = (request: IncomingMessage): void => {
    if (platformAdminToken === undefined || request.headers['x-siriusx-platform-token'] !== platformAdminToken) {
      throw new ControlPlaneError(401, 'PLATFORM_ADMIN_REQUIRED', 'platform admin token required')
    }
  }
  const offlineTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const offlineLostMs = options.deviceOfflineLostMs ?? 15 * 60 * 1000
  const server = createServer(async (request, response) => {
    if (request.method === 'OPTIONS') {
      response.writeHead(204, CORS).end()
      return
    }
    try {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`)
      const parts = url.pathname.split('/').filter(Boolean)
      if (request.method === 'GET' && url.pathname === '/admin') {
        response.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          'x-frame-options': 'DENY',
          'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
        })
        response.end(`<!doctype html><meta charset="utf-8"><title>SiriusX Platform Admin</title>
<style>body{font:14px system-ui,sans-serif;margin:24px;max-width:1100px}input,button,select{padding:6px;margin:2px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px;text-align:left}code{background:#f4f4f4;padding:2px}</style>
<h1>SiriusX Platform Admin</h1>
<p>Platform admin token is kept in <code>sessionStorage</code> only.</p>
<div><input id="token" type="password" placeholder="X-SiriusX-Platform-Token"><button id="load">Load</button></div>
<div id="create"><h2>Create tenant</h2><input id="name" placeholder="Name"><input id="issuer" placeholder="IdP issuer"><input id="email" placeholder="Admin email"><input id="tenantId" placeholder="Tenant id (optional)"><button id="createTenant">Create</button></div>
<div id="models"><h2>Model catalog</h2><input id="modelId" placeholder="Model id (optional)"><input id="modelName" placeholder="Display name"><input id="modelProvider" placeholder="Provider"><input id="modelNameId" placeholder="Provider model id"><button id="createModel">Add model</button><div id="modelList">Load to begin.</div></div>
<div id="sourceBindings"><h2>Source bindings</h2><input id="sourceProvider" placeholder="provider"><input id="sourceExternal" placeholder="external id"><input id="sourceTenant" placeholder="tenant id"><input id="sourceRepo" placeholder="repo URL (optional)"><input id="sourceBase" placeholder="base ref (optional)"><button id="createSource">Add source binding</button><div id="sourceList">Load to begin.</div></div>
<h2>Support requests</h2><div id="supportRequests">Load to begin.</div>
<div style="display:flex;align-items:center;gap:8px"><h2>Platform audit</h2><button id="exportPlatformAudit">Export CSV</button></div><div id="platformAudit">Load to begin.</div>
<h2>Tenants</h2><div id="tenants">Load to begin.</div>
<h2 id="usersTitle" style="display:none">Users</h2><div id="users"></div>
<div id="error" style="color:#b00020"></div>
<script>
let tenantsCache = [];
const token = () => sessionStorage.getItem('platformToken') || '';
const headers = () => ({'x-siriusx-platform-token': token(), 'content-type': 'application/json'});
const err = e => document.getElementById('error').textContent = e instanceof Error ? e.message : String(e);
async function api(path, init = {}) { const r = await fetch(path, {...init, headers: headers()}); const v = await r.json(); if (!r.ok) throw new Error(v.error || ('HTTP ' + r.status)); return v; }
function row(text) { const tr = document.createElement('tr'); for (const value of text) { const td = document.createElement('td'); td.textContent = String(value); tr.append(td); } return tr; }
async function loadSourceBindings() {
  const data = await api('/v1/admin/source-bindings');
  const host = document.getElementById('sourceList'); host.textContent = '';
  const table = document.createElement('table'); table.append(row(['ID','Provider','External','Tenant','Repo','Base']));
  for (const binding of data.bindings) table.append(row([binding.id, binding.provider, binding.externalId, binding.tenantId, binding.repoUrl ?? '', binding.baseRef ?? '']));
  host.append(table);
}
async function loadSupportRequests() {
  const data = await api('/v1/admin/support-requests');
  const host = document.getElementById('supportRequests'); host.textContent = '';
  const table = document.createElement('table'); table.append(row(['Tenant','Reason','Status','Requested by']));
  for (const request of data.requests) table.append(row([request.tenantId, request.reason, request.status, request.requestedBy]));
  host.append(table);
}
async function loadPlatformAudit() {
  const data = await api('/v1/admin/audit');
  const host = document.getElementById('platformAudit'); host.textContent = '';
  const table = document.createElement('table'); table.append(row(['Actor','Action','Target','Detail']));
  for (const event of data.audit) table.append(row([event.actor, event.action, event.target, event.detail ?? '']));
  host.append(table);
}
async function loadModels() {
  const data = await api('/v1/admin/models');
  const host = document.getElementById('modelList'); host.textContent = '';
  const table = document.createElement('table'); table.append(row(['ID','Name','Provider','Model']));
  for (const model of data.models) table.append(row([model.id, model.name, model.provider, model.model]));
  host.append(table);
}
async function loadTenants() {
  err('');
  const data = await api('/v1/admin/tenants');
  tenantsCache = data.tenants;
  const host = document.getElementById('tenants'); host.textContent = '';
  const table = document.createElement('table'); table.append(row(['Name','Tenant','Issuer','Status','Users','Devices','Device tickets','Cloud tickets','']));
  for (const tenant of data.tenants) {
    const tr = row([tenant.name, tenant.id, tenant.idpIssuer, tenant.status, tenant.usage.users, tenant.usage.devices, tenant.usage.deviceTickets, tenant.usage.cloudTickets]);
    const button = document.createElement('button'); button.textContent = 'Users'; button.onclick = () => loadUsers(tenant.id); const td = document.createElement('td'); td.append(button);
    const toggle = document.createElement('button'); toggle.textContent = tenant.status === 'active' ? 'Suspend' : 'Resume'; toggle.onclick = async () => { try { await api('/v1/admin/tenants/' + encodeURIComponent(tenant.id) + '/status', {method:'POST', body: JSON.stringify({status: tenant.status === 'active' ? 'suspended' : 'active'})}); await loadTenants(); await loadPlatformAudit(); } catch (e) { err(e); } };
    td.append(toggle); tr.append(td); table.append(tr);
  }
  host.append(table);
}
async function loadUsers(tenantId) {
  err(''); document.getElementById('usersTitle').style.display = 'block';
  const data = await api('/v1/admin/tenants/' + encodeURIComponent(tenantId) + '/users');
  const host = document.getElementById('users'); host.textContent = '';
  const h = document.createElement('h3'); h.textContent = tenantId; host.append(h);
  const currentTenant = tenantsCache.find(item => item.id === tenantId) || { name: '', idpIssuer: '' };
  const config = document.createElement('div'); config.innerHTML = '<h4>Tenant config</h4><input id="tenantName" placeholder="Tenant name"><input id="tenantIssuer" placeholder="IdP issuer"><button id="saveTenant">Save tenant</button>'; host.append(config);
  config.querySelector('#tenantName').value = currentTenant.name; config.querySelector('#tenantIssuer').value = currentTenant.idpIssuer;
  config.querySelector('#saveTenant').onclick = async () => { try { await api('/v1/admin/tenants/' + encodeURIComponent(tenantId), {method:'PUT', body: JSON.stringify({name: config.querySelector('#tenantName').value, idpIssuer: config.querySelector('#tenantIssuer').value})}); await loadTenants(); await loadUsers(tenantId); await loadPlatformAudit(); } catch (e) { err(e); } };
  const quota = await api('/v1/admin/tenants/' + encodeURIComponent(tenantId) + '/quota');
  const q = document.createElement('div'); q.innerHTML = '<h4>Quota</h4><input id="maxUsers" placeholder="Max users"><input id="maxDevices" placeholder="Max devices"><input id="maxCloud" placeholder="Max cloud/day"><input id="maxDevice" placeholder="Max device tickets/day"><button id="saveQuota">Save quota</button>'; host.append(q);
  q.querySelector('#maxUsers').value = quota.quota.maxUsers; q.querySelector('#maxDevices').value = quota.quota.maxDevices; q.querySelector('#maxCloud').value = quota.quota.maxCloudTicketsPerDay; q.querySelector('#maxDevice').value = quota.quota.maxDeviceTicketsPerDay;
  q.querySelector('#saveQuota').onclick = async () => { try { await api('/v1/admin/tenants/' + encodeURIComponent(tenantId) + '/quota', {method:'PUT', body: JSON.stringify({maxUsers:Number(q.querySelector('#maxUsers').value), maxDevices:Number(q.querySelector('#maxDevices').value), maxCloudTicketsPerDay:Number(q.querySelector('#maxCloud').value), maxDeviceTicketsPerDay:Number(q.querySelector('#maxDevice').value)})}); await loadUsers(tenantId); } catch (e) { err(e); } };
  const support = document.createElement('div'); support.innerHTML = '<h4>Support access</h4><input id="supportReason" placeholder="Support reason"><button id="requestSupport">Request support</button>'; host.append(support);
  support.querySelector('#requestSupport').onclick = async () => { try { await api('/v1/admin/tenants/' + encodeURIComponent(tenantId) + '/support-requests', {method:'POST', body: JSON.stringify({reason: support.querySelector('#supportReason').value})}); await loadSupportRequests(); await loadPlatformAudit(); } catch (e) { err(e); } };
  const billing = await api('/v1/admin/tenants/' + encodeURIComponent(tenantId) + '/billing');
  const bill = document.createElement('div'); bill.innerHTML = '<h4>Billing</h4><input id="currency" placeholder="Currency"><input id="cloudCents" placeholder="Cloud ticket cents"><input id="deviceCents" placeholder="Device ticket cents"><input id="budget" placeholder="Monthly budget cents (blank = none)"><button id="saveBilling">Save billing</button><div id="billEstimate"></div>'; host.append(bill);
  bill.querySelector('#currency').value = billing.billing.currency; bill.querySelector('#cloudCents').value = billing.billing.cloudTicketCents; bill.querySelector('#deviceCents').value = billing.billing.deviceTicketCents; bill.querySelector('#budget').value = billing.billing.monthlyBudgetCents ?? '';
  bill.querySelector('#billEstimate').textContent = 'Estimate: ' + billing.estimate.estimatedCents + ' ' + billing.estimate.currency;
  bill.querySelector('#saveBilling').onclick = async () => { try { await api('/v1/admin/tenants/' + encodeURIComponent(tenantId) + '/billing', {method:'PUT', body: JSON.stringify({currency: bill.querySelector('#currency').value, cloudTicketCents: Number(bill.querySelector('#cloudCents').value), deviceTicketCents: Number(bill.querySelector('#deviceCents').value), monthlyBudgetCents: bill.querySelector('#budget').value === '' ? null : Number(bill.querySelector('#budget').value)})}); await loadUsers(tenantId); await loadPlatformAudit(); } catch (e) { err(e); } };
  const daily = await api('/v1/admin/tenants/' + encodeURIComponent(tenantId) + '/usage-daily?days=14');
  const trend = document.createElement('div'); trend.innerHTML = '<h4>Usage (14d)</h4>'; host.append(trend);
  const ttable = document.createElement('table'); ttable.append(row(['Date','Cloud tickets','Device tickets'])); for (const day of daily.usage) ttable.append(row([day.date, day.cloudTickets, day.deviceTickets])); trend.append(ttable);
  const tm = await api('/v1/admin/tenants/' + encodeURIComponent(tenantId) + '/models');
  const catalog = await api('/v1/admin/models');
  const bound = new Map(tm.models.map(model => [model.id, model]));
  const modelBox = document.createElement('div'); modelBox.innerHTML = '<h4>Catalog models</h4>'; host.append(modelBox);
  for (const model of catalog.models) { const div = document.createElement('div'); div.textContent = model.id + ' · ' + model.name + (bound.get(model.id)?.isDefault ? ' (default)' : '') + ' '; const button = document.createElement('button'); const isBound = bound.has(model.id); button.textContent = isBound ? 'Set default' : 'Bind'; button.onclick = async () => { try { await api('/v1/admin/tenants/' + encodeURIComponent(tenantId) + '/models/' + encodeURIComponent(model.id), {method:'PUT', body: JSON.stringify({isDefault: !isBound ? false : true})}); await loadUsers(tenantId); } catch (e) { err(e); } }; div.append(button); modelBox.append(div); }
  const add = document.createElement('div'); add.innerHTML = '<input id="newEmail" placeholder="User email"><select id="newRole"><option>member</option><option>admin</option></select><button id="addUser">Add user</button>'; host.append(add);
  add.querySelector('#addUser').onclick = async () => { try { await api('/v1/admin/tenants/' + encodeURIComponent(tenantId) + '/users', {method:'POST', body: JSON.stringify({email: add.querySelector('#newEmail').value, role: add.querySelector('#newRole').value})}); await loadUsers(tenantId); } catch (e) { err(e); } };
  const table = document.createElement('table'); table.append(row(['Email','Role','User ID']));
  for (const user of data.users) {
    const tr = row([user.email, user.role, user.userId]);
    const select = document.createElement('select'); select.innerHTML = '<option>member</option><option>admin</option>'; select.value = user.role;
    select.onchange = async () => { try { await api('/v1/admin/tenants/' + encodeURIComponent(tenantId) + '/users/' + encodeURIComponent(user.userId) + '/role', {method:'PUT', body: JSON.stringify({role: select.value})}); await loadUsers(tenantId); await loadPlatformAudit(); } catch (e) { err(e); } };
    tr.children[1].textContent = ''; tr.children[1].append(select); table.append(tr);
  }
  host.append(table);
}
document.getElementById('load').onclick = async () => { try { sessionStorage.setItem('platformToken', document.getElementById('token').value); await Promise.all([loadTenants(), loadModels(), loadPlatformAudit(), loadSupportRequests(), loadSourceBindings()]); } catch (e) { err(e); } };
document.getElementById('exportPlatformAudit').onclick = async () => { try { const response = await fetch('/v1/admin/audit/export?format=csv', {headers: {'x-siriusx-platform-token': token()}}); if (!response.ok) throw new Error('HTTP ' + response.status); const blob = await response.blob(); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'siriusx-platform-audit.csv'; link.click(); URL.revokeObjectURL(link.href); } catch (e) { err(e); } };
document.getElementById('createSource').onclick = async () => { try { await api('/v1/admin/source-bindings', {method:'POST', body: JSON.stringify({provider: document.getElementById('sourceProvider').value, externalId: document.getElementById('sourceExternal').value, tenantId: document.getElementById('sourceTenant').value, ...(document.getElementById('sourceRepo').value === '' ? {} : {repoUrl: document.getElementById('sourceRepo').value}), ...(document.getElementById('sourceBase').value === '' ? {} : {baseRef: document.getElementById('sourceBase').value})})}); await loadSourceBindings(); await loadPlatformAudit(); } catch (e) { err(e); } };
document.getElementById('createModel').onclick = async () => { try { await api('/v1/admin/models', {method:'POST', body: JSON.stringify({id: document.getElementById('modelId').value || undefined, name: document.getElementById('modelName').value, provider: document.getElementById('modelProvider').value, model: document.getElementById('modelNameId').value})}); await loadModels(); } catch (e) { err(e); } };
document.getElementById('createTenant').onclick = async () => { try { await api('/v1/admin/tenants', {method:'POST', body: JSON.stringify({name:document.getElementById('name').value, idpIssuer:document.getElementById('issuer').value, adminEmail:document.getElementById('email').value, ...(document.getElementById('tenantId').value === '' ? {} : {tenantId:document.getElementById('tenantId').value})})}); await loadTenants(); await loadPlatformAudit(); } catch (e) { err(e); } };
</script>`)
        return
      }
      if (request.method === 'GET' && url.pathname === '/health') {
        write(response, 200, { ok: true, service: 'siriusx-control-plane', version: process.env.SIRIUSX_VERSION ?? 'dev', commit: process.env.SIRIUSX_COMMIT ?? 'dev' })
        return
      }
      if (request.method === 'GET' && url.pathname === '/metrics') {
        const metrics = control.metrics()
        const body = [
          '# HELP siriusx_control_plane_up Control-plane process is serving.',
          '# TYPE siriusx_control_plane_up gauge',
          'siriusx_control_plane_up 1',
          '# TYPE siriusx_control_plane_tenants gauge',
          `siriusx_control_plane_tenants ${metrics.tenants}`,
          '# TYPE siriusx_control_plane_users gauge',
          `siriusx_control_plane_users ${metrics.users}`,
          '# TYPE siriusx_control_plane_devices gauge',
          `siriusx_control_plane_devices ${metrics.devices}`,
          '# TYPE siriusx_control_plane_device_tickets gauge',
          `siriusx_control_plane_device_tickets ${metrics.deviceTickets}`,
          '# TYPE siriusx_control_plane_cloud_tickets gauge',
          `siriusx_control_plane_cloud_tickets ${metrics.cloudTickets}`,
          '',
        ].join('\n')
        response.writeHead(200, { ...CORS, 'content-type': 'text/plain; version=0.0.4; charset=utf-8', 'cache-control': 'no-store' })
        response.end(body)
        return
      }
      if (request.method === 'GET' && url.pathname === '/ready') {
        try { write(response, 200, { ok: true, service: 'siriusx-control-plane', checks: control.ready() }) }
        catch (error) { write(response, 503, { ok: false, service: 'siriusx-control-plane', error: error instanceof Error ? error.message : String(error) }) }
        return
      }
      if (request.method === 'POST' && url.pathname === '/v1/sessions/revoke') {
        const token = (request.headers.authorization ?? '').replace(/^Bearer /u, '')
        if (token === '') throw new ControlPlaneError(401, 'UNAUTHORIZED', 'session token required')
        write(response, 200, control.revokeSession(token))
        return
      }
      if (request.method === 'POST' && url.pathname === '/v1/approvals/callback') {
        if (ssoServiceToken === undefined || request.headers['x-siriusx-service-token'] !== ssoServiceToken) throw new ControlPlaneError(401, 'UNAUTHORIZED', 'service token required')
        const body = await readJson(request)
        if (typeof body.ticketId !== 'string' || typeof body.tenantId !== 'string' || typeof body.approvalId !== 'string' || (body.status !== 'approved' && body.status !== 'rejected')) throw new Error('invalid approval callback')
        write(response, 200, { resumed: await control.resumeTicketFromApproval(body.tenantId, body.ticketId, body.approvalId, body.status) })
        return
      }
      if (request.method === 'POST' && url.pathname === '/v1/sso/session') {
        if (ssoServiceToken === undefined || request.headers['x-siriusx-service-token'] !== ssoServiceToken) {
          throw new ControlPlaneError(401, 'UNAUTHORIZED', 'service token required')
        }
        const body = await readJson(request)
        if (typeof body.tenantId !== 'string' || typeof body.email !== 'string' || (body.role !== 'admin' && body.role !== 'member')) throw new Error('tenantId, email and role are required')
        write(response, 200, await control.ssoSession({ tenantId: body.tenantId, email: body.email, role: body.role }))
        return
      }
      if (parts[0] === 'v1' && parts[1] === 'admin') {
        requirePlatformAdmin(request)
        if (parts[2] === 'support-requests' && parts[3] === undefined) {
          if (request.method === 'GET') { write(response, 200, { requests: await control.listSupportRequests() }); return }
        }
        if (request.method === 'POST' && parts[2] === 'tenants' && parts[3] !== undefined && parts[4] === 'support-requests') {
          const body = await readJson(request)
          if (typeof body.reason !== 'string' || body.reason.trim() === '') throw new Error('reason is required')
          const supportRequest = await control.createSupportRequest(parts[3], 'platform', body.reason.trim())
          await control.recordPlatformAudit({ actor: 'platform', action: 'support.request', target: `${parts[3]}/${supportRequest.id}`, detail: body.reason.trim() })
          write(response, 201, supportRequest)
          return
        }
        if (request.method === 'GET' && parts[2] === 'audit' && parts[3] === undefined) {
          write(response, 200, { audit: await control.listPlatformAudit() })
          return
        }
        if (request.method === 'GET' && parts[2] === 'audit' && parts[3] === 'export') {
          const rows = await control.listPlatformAudit()
          if (url.searchParams.get('format') === 'csv') {
            const columns = ['id', 'actor', 'action', 'target', 'detail', 'createdAt']
            const escape = (value: unknown): string => { const text = value === null || value === undefined ? '' : String(value); return /[",\n]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text }
            const csv = [columns.join(','), ...rows.map(row => columns.map(column => escape(row[column as keyof typeof row])).join(','))].join('\n') + '\n'
            response.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="siriusx-platform-audit.csv"', 'cache-control': 'no-store' })
            response.end(csv)
            return
          }
          write(response, 200, { audit: rows })
          return
        }
        if (parts[2] === 'source-bindings' && parts[3] === undefined) {
          if (request.method === 'GET') { write(response, 200, { bindings: await control.listSourceBindings() }); return }
          if (request.method === 'POST') {
            const body = await readJson(request)
            if (body.provider !== 'gitlab' && body.provider !== 'github' && body.provider !== 'feishu' && body.provider !== 'teams') throw new Error('provider is required')
            if (typeof body.externalId !== 'string' || typeof body.tenantId !== 'string') throw new Error('externalId and tenantId are required')
            const binding = await control.createSourceBinding({
              provider: body.provider, externalId: body.externalId, tenantId: body.tenantId,
              ...(typeof body.botId === 'string' ? { botId: body.botId } : {}),
              ...(typeof body.repoUrl === 'string' ? { repoUrl: body.repoUrl } : {}),
              ...(typeof body.baseRef === 'string' ? { baseRef: body.baseRef } : {}),
              ...(typeof body.autoDispatch === 'boolean' ? { autoDispatch: body.autoDispatch } : {}),
            })
            await control.recordPlatformAudit({ actor: 'platform', action: 'source.binding', target: binding.id, detail: `${body.provider}:${body.externalId}` })
            write(response, 201, binding)
            return
          }
        }
        if (request.method === 'GET' && parts[2] === 'tenants' && parts[3] === undefined) {
          write(response, 200, { tenants: control.listTenants().map(tenant => ({ ...tenant, usage: control.tenantUsage(tenant.id) })) })
          return
        }
        if (request.method === 'POST' && parts[2] === 'tenants' && parts[3] === undefined) {
          const body = await readJson(request)
          if (typeof body.name !== 'string' || typeof body.idpIssuer !== 'string' || typeof body.adminEmail !== 'string') throw new Error('name, idpIssuer and adminEmail are required')
          const tenant = await control.provisionTenant({
            name: body.name, idpIssuer: body.idpIssuer, adminEmail: body.adminEmail,
            ...(typeof body.tenantId === 'string' ? { tenantId: body.tenantId } : {}),
          })
          await control.recordPlatformAudit({ actor: 'platform', action: 'tenant.create', target: tenant.id, detail: tenant.name })
          write(response, 201, { tenant })
          return
        }
        if (request.method === 'POST' && parts[2] === 'tenants' && parts[3] !== undefined && parts[4] === 'status' && parts[5] === undefined) {
          const body = await readJson(request)
          if (body.status !== 'active' && body.status !== 'suspended') throw new Error('status must be active or suspended')
          const tenant = await control.setTenantStatus(parts[3], body.status)
          await control.recordPlatformAudit({ actor: 'platform', action: 'tenant.status', target: tenant.id, detail: body.status })
          write(response, 200, { tenant })
          return
        }
        if (request.method === 'PUT' && parts[2] === 'tenants' && parts[3] !== undefined && parts[4] === undefined) {
          const body = await readJson(request)
          const tenant = await control.updateTenant(parts[3], {
            ...(typeof body.name === 'string' ? { name: body.name } : {}),
            ...(typeof body.idpIssuer === 'string' ? { idpIssuer: body.idpIssuer } : {}),
          })
          await control.recordPlatformAudit({ actor: 'platform', action: 'tenant.update', target: tenant.id, detail: JSON.stringify({ name: tenant.name, idpIssuer: tenant.idpIssuer }) })
          write(response, 200, { tenant })
          return
        }
        if (parts[2] === 'models' && parts[3] === undefined) {
          if (request.method === 'GET') { write(response, 200, { models: await control.listModelCatalog() }); return }
          if (request.method === 'POST') {
            const body = await readJson(request)
            if (typeof body.name !== 'string' || typeof body.provider !== 'string' || typeof body.model !== 'string') throw new Error('name, provider and model are required')
            const model = await control.addModel({ name: body.name, provider: body.provider, model: body.model, ...(typeof body.id === 'string' ? { id: body.id } : {}) })
            await control.recordPlatformAudit({ actor: 'platform', action: 'model.create', target: model.id, detail: body.model })
            write(response, 201, model)
            return
          }
        }
        if (parts[2] === 'tenants' && parts[3] !== undefined && parts[4] === 'models') {
          if (request.method === 'GET' && parts[5] === undefined) { write(response, 200, { models: await control.listTenantModels(parts[3]) }); return }
          if (request.method === 'PUT' && parts[5] !== undefined) {
            const body = await readJson(request)
            await control.bindTenantModel(parts[3], parts[5], body.isDefault === true)
            await control.recordPlatformAudit({ actor: 'platform', action: 'model.bind', target: `${parts[3]}/${parts[5]}`, detail: body.isDefault === true ? 'default' : 'bound' })
            write(response, 200, { models: await control.listTenantModels(parts[3]) })
            return
          }
        }
        if (parts[2] === 'tenants' && parts[3] !== undefined && parts[4] === 'audit-summary' && parts[5] === undefined) {
          if (toolGatewayUrl === undefined) { write(response, 200, { total: 0, decisions: {}, unavailable: true }); return }
          const upstream = await fetch(`${toolGatewayUrl}/v1/audit/summary`, { headers: { 'x-tenant-id': parts[3], 'x-user-id': 'platform', 'x-role': 'admin' } })
          write(response, upstream.status, await upstream.json())
          return
        }
        if (parts[2] === 'tenants' && parts[3] !== undefined && parts[4] === 'billing' && parts[5] === undefined) {
          if (request.method === 'GET') { write(response, 200, { billing: await control.getBilling(parts[3]), estimate: await control.billingEstimate(parts[3]) }); return }
          if (request.method === 'PUT') {
            const body = await readJson(request)
            const billing = await control.setBilling(parts[3], {
              ...(typeof body.currency === 'string' ? { currency: body.currency } : {}),
              ...(typeof body.cloudTicketCents === 'number' ? { cloudTicketCents: body.cloudTicketCents } : {}),
              ...(typeof body.deviceTicketCents === 'number' ? { deviceTicketCents: body.deviceTicketCents } : {}),
              ...(body.monthlyBudgetCents === null || typeof body.monthlyBudgetCents === 'number' ? { monthlyBudgetCents: body.monthlyBudgetCents } : {}),
            })
            await control.recordPlatformAudit({ actor: 'platform', action: 'billing.update', target: parts[3], detail: JSON.stringify(billing) })
            write(response, 200, { billing, estimate: await control.billingEstimate(parts[3]) })
            return
          }
        }
        if (parts[2] === 'tenants' && parts[3] !== undefined && parts[4] === 'usage-daily' && parts[5] === undefined) {
          const days = url.searchParams.get('days') === null ? 30 : Number(url.searchParams.get('days'))
          write(response, 200, { days, usage: control.usageDaily(parts[3], days) })
          return
        }
        if (parts[2] === 'tenants' && parts[3] !== undefined && parts[4] === 'quota' && parts[5] === undefined) {
          if (request.method === 'GET') { write(response, 200, { quota: control.getQuota(parts[3]), usage: control.tenantUsage(parts[3]) }); return }
          if (request.method === 'PUT') {
            const body = await readJson(request)
            const patch = {
              ...(typeof body.maxUsers === 'number' ? { maxUsers: body.maxUsers } : {}),
              ...(typeof body.maxDevices === 'number' ? { maxDevices: body.maxDevices } : {}),
              ...(typeof body.maxCloudTicketsPerDay === 'number' ? { maxCloudTicketsPerDay: body.maxCloudTicketsPerDay } : {}),
              ...(typeof body.maxDeviceTicketsPerDay === 'number' ? { maxDeviceTicketsPerDay: body.maxDeviceTicketsPerDay } : {}),
            }
            const quota = await control.setQuota(parts[3], patch)
            await control.recordPlatformAudit({ actor: 'platform', action: 'quota.update', target: parts[3], detail: JSON.stringify(quota) })
            write(response, 200, { quota, usage: control.tenantUsage(parts[3]) })
            return
          }
        }
        if (parts[2] === 'tenants' && parts[3] !== undefined && parts[4] === 'users') {
          if (request.method === 'GET' && parts[5] === undefined) { write(response, 200, { users: control.listUsers(parts[3]) }); return }
          if (request.method === 'POST' && parts[5] === undefined) {
            const body = await readJson(request)
            if (typeof body.email !== 'string' || (body.role !== 'admin' && body.role !== 'member')) throw new Error('email and role are required')
            const user = await control.addUser({ tenantId: parts[3], email: body.email, role: body.role })
            await control.recordPlatformAudit({ actor: 'platform', action: 'user.create', target: `${parts[3]}/${user.userId}`, detail: body.email })
            write(response, 201, user)
            return
          }
          if (request.method === 'PUT' && parts[5] !== undefined && parts[6] === 'role') {
            const body = await readJson(request)
            if (body.role !== 'admin' && body.role !== 'member') throw new Error('role is required')
            await control.updateUserRole(parts[3], parts[5], body.role)
            await control.recordPlatformAudit({ actor: 'platform', action: 'user.role', target: `${parts[3]}/${parts[5]}`, detail: body.role })
            write(response, 200, { updated: true })
            return
          }
        }
        write(response, 404, { error: 'not found', code: 'NOT_FOUND' })
        return
      }
      if (request.method === 'POST' && url.pathname === '/v1/sources/gitlab/webhook') {
        if (sourceWebhookToken === undefined) throw new ControlPlaneError(503, 'SOURCE_WEBHOOK_DISABLED', 'source webhook token is not configured')
        if (request.headers['x-gitlab-token'] !== sourceWebhookToken) throw new ControlPlaneError(401, 'SOURCE_UNAUTHORIZED', 'invalid GitLab webhook token')
        const body = await readJson(request)
        const project = typeof body.project === 'object' && body.project !== null ? body.project as Record<string, unknown> : undefined
        const externalId = typeof project?.path_with_namespace === 'string' ? project.path_with_namespace : typeof project?.pathWithNamespace === 'string' ? project.pathWithNamespace : undefined
        if (externalId === undefined) throw new ControlPlaneError(400, 'INVALID_SOURCE_EVENT', 'GitLab project path is required')
        const binding = await control.findSourceBinding('gitlab', externalId)
        if (binding === undefined) { write(response, 202, { accepted: false, ignored: 'no source binding' }); return }
        const deliveryId = typeof request.headers['x-gitlab-event-uuid'] === 'string' && request.headers['x-gitlab-event-uuid'] !== ''
          ? request.headers['x-gitlab-event-uuid']
          : createHash('sha256').update(JSON.stringify(body)).digest('hex')
        const eventType = typeof request.headers['x-gitlab-event'] === 'string' ? request.headers['x-gitlab-event'] : 'unknown'
        const recorded = await control.recordSourceEvent({ provider: 'gitlab', deliveryId, bindingId: binding.id, tenantId: binding.tenantId, eventType, payload: body })
        let ticketId: string | undefined
        let dispatchError: string | undefined
        if (recorded.accepted && binding.autoDispatch && binding.repoUrl !== null) {
          const attributes = typeof body.object_attributes === 'object' && body.object_attributes !== null ? body.object_attributes as Record<string, unknown> : {}
          const title = typeof attributes.title === 'string' ? attributes.title : `${eventType} event`
          const description = typeof attributes.description === 'string' ? attributes.description : ''
          try {
            const ticket = control.createCloudTicketFromSource({ tenantId: binding.tenantId, operatorId: 'app:source-gitlab', channel: 'gitlab', repoUrl: binding.repoUrl, baseRef: binding.baseRef ?? 'main', prompt: `GitLab ${eventType}: ${title}\n\n${description}` })
            ticketId = ticket.ticketId
            await control.markSourceEvent(recorded.id, 'dispatched', ticketId)
          } catch (error) {
            dispatchError = error instanceof Error ? error.message : String(error)
            await control.markSourceEvent(recorded.id, 'failed')
          }
        }
        write(response, 202, { accepted: recorded.accepted, duplicate: !recorded.accepted, eventId: recorded.id, ...(ticketId === undefined ? {} : { ticketId }), ...(dispatchError === undefined ? {} : { dispatchError }) })
        return
      }
      if (request.method === 'POST' && url.pathname === '/v1/sources/github/webhook') {
        if (githubWebhookSecret === undefined) throw new ControlPlaneError(503, 'SOURCE_WEBHOOK_DISABLED', 'GitHub webhook secret is not configured')
        const signature = request.headers['x-hub-signature-256']
        if (typeof signature !== 'string' || !signature.startsWith('sha256=')) throw new ControlPlaneError(401, 'SOURCE_UNAUTHORIZED', 'missing GitHub webhook signature')
        const { body, raw } = await readRawJson(request)
        const expected = `sha256=${createHmac('sha256', githubWebhookSecret).update(raw).digest('hex')}`
        if (signature !== expected) throw new ControlPlaneError(401, 'SOURCE_UNAUTHORIZED', 'invalid GitHub webhook signature')
        const repository = typeof body.repository === 'object' && body.repository !== null ? body.repository as Record<string, unknown> : undefined
        const externalId = typeof repository?.full_name === 'string' ? repository.full_name : undefined
        if (externalId === undefined) throw new ControlPlaneError(400, 'INVALID_SOURCE_EVENT', 'GitHub repository full_name is required')
        const binding = await control.findSourceBinding('github', externalId)
        if (binding === undefined) { write(response, 202, { accepted: false, ignored: 'no source binding' }); return }
        const deliveryId = typeof request.headers['x-github-delivery'] === 'string' && request.headers['x-github-delivery'] !== ''
          ? request.headers['x-github-delivery']
          : createHash('sha256').update(raw).digest('hex')
        const eventType = typeof request.headers['x-github-event'] === 'string' ? request.headers['x-github-event'] : 'unknown'
        const recorded = await control.recordSourceEvent({ provider: 'github', deliveryId, bindingId: binding.id, tenantId: binding.tenantId, eventType, payload: body })
        let ticketId: string | undefined
        let dispatchError: string | undefined
        if (recorded.accepted && binding.autoDispatch && binding.repoUrl !== null) {
          const issue = typeof body.issue === 'object' && body.issue !== null ? body.issue as Record<string, unknown> : {}
          const title = typeof issue.title === 'string' ? issue.title : `${eventType} event`
          const description = typeof issue.body === 'string' ? issue.body : ''
          try {
            const ticket = control.createCloudTicketFromSource({ tenantId: binding.tenantId, operatorId: 'app:source-github', channel: 'github', repoUrl: binding.repoUrl, baseRef: binding.baseRef ?? 'main', prompt: `GitHub ${eventType}: ${title}\n\n${description}` })
            ticketId = ticket.ticketId
            await control.markSourceEvent(recorded.id, 'dispatched', ticketId)
          } catch (error) {
            dispatchError = error instanceof Error ? error.message : String(error)
            await control.markSourceEvent(recorded.id, 'failed')
          }
        }
        write(response, 202, { accepted: recorded.accepted, duplicate: !recorded.accepted, eventId: recorded.id, ...(ticketId === undefined ? {} : { ticketId }), ...(dispatchError === undefined ? {} : { dispatchError }) })
        return
      }
      if (request.method === 'POST' && parts[0] === 'v1' && parts[1] === 'sources' && (parts[2] === 'feishu' || parts[2] === 'teams') && parts[3] === 'webhook') {
        if (sourceWebhookToken === undefined) throw new ControlPlaneError(503, 'SOURCE_WEBHOOK_DISABLED', 'source webhook token is not configured')
        if (request.headers['x-siriusx-source-token'] !== sourceWebhookToken) throw new ControlPlaneError(401, 'SOURCE_UNAUTHORIZED', 'invalid source webhook token')
        const body = await readJson(request)
        if (parts[2] === 'feishu' && body.type === 'url_verification') {
          write(response, 200, { challenge: body.challenge })
          return
        }
        const provider = parts[2]
        let externalId: string | undefined
        let deliveryId: string | undefined
        let eventType: string | undefined
        let prompt = ''
        if (provider === 'feishu') {
          const event = typeof body.event === 'object' && body.event !== null ? body.event as Record<string, unknown> : undefined
          const message = typeof event?.message === 'object' && event.message !== null ? event.message as Record<string, unknown> : undefined
          externalId = typeof message?.chat_id === 'string' ? message.chat_id : typeof event?.chat_id === 'string' ? event.chat_id : undefined
          const header = typeof body.header === 'object' && body.header !== null ? body.header as Record<string, unknown> : undefined
          deliveryId = typeof header?.event_id === 'string' ? header.event_id : undefined
          eventType = typeof header?.event_type === 'string' ? header.event_type : 'feishu.message'
          if (typeof message?.content === 'string') { try { const content = JSON.parse(message.content) as { text?: unknown }; if (typeof content.text === 'string') prompt = content.text } catch { /* keep empty */ } }
        } else {
          externalId = typeof body.conversation === 'object' && body.conversation !== null && typeof (body.conversation as Record<string, unknown>).id === 'string' ? String((body.conversation as Record<string, unknown>).id) : undefined
          deliveryId = typeof body.id === 'string' ? body.id : undefined
          eventType = typeof body.type === 'string' ? body.type : 'teams.message'
          prompt = typeof body.text === 'string' ? body.text : ''
        }
        if (externalId === undefined) throw new ControlPlaneError(400, 'INVALID_SOURCE_EVENT', `${provider} conversation id is required`)
        const binding = await control.findSourceBinding(provider, externalId)
        if (binding === undefined) { write(response, 202, { accepted: false, ignored: 'no source binding' }); return }
        const id = deliveryId ?? createHash('sha256').update(JSON.stringify(body)).digest('hex')
        const recorded = await control.recordSourceEvent({ provider, deliveryId: id, bindingId: binding.id, tenantId: binding.tenantId, eventType: eventType ?? 'message', payload: body })
        let ticketId: string | undefined
        let dispatchError: string | undefined
        if (recorded.accepted && binding.autoDispatch && binding.repoUrl !== null) {
          try {
            const ticket = control.createCloudTicketFromSource({ tenantId: binding.tenantId, operatorId: `app:source-${provider}`, channel: provider, repoUrl: binding.repoUrl, baseRef: binding.baseRef ?? 'main', prompt: `${provider}: ${prompt}` })
            ticketId = ticket.ticketId
            await control.markSourceEvent(recorded.id, 'dispatched', ticketId)
          } catch (error) {
            dispatchError = error instanceof Error ? error.message : String(error)
            await control.markSourceEvent(recorded.id, 'failed')
          }
        }
        write(response, 202, { accepted: recorded.accepted, duplicate: !recorded.accepted, eventId: recorded.id, ...(ticketId === undefined ? {} : { ticketId }), ...(dispatchError === undefined ? {} : { dispatchError }) })
        return
      }
      const session = sessionOf(control, request)
      if (request.method === 'GET' && url.pathname === '/v1/me') {
        write(response, 200, session)
        return
      }
      if (request.method === 'GET' && url.pathname === '/v1/quota') {
        write(response, 200, { quota: control.getQuota(session.tenantId), usage: control.tenantUsage(session.tenantId) })
        return
      }
      if (request.method === 'GET' && url.pathname === '/v1/usage-daily') {
        const days = url.searchParams.get('days') === null ? 30 : Number(url.searchParams.get('days'))
        write(response, 200, { days, usage: control.usageDaily(session.tenantId, days) })
        return
      }
      if (request.method === 'GET' && url.pathname === '/v1/billing') {
        write(response, 200, { billing: await control.getBilling(session.tenantId), estimate: await control.billingEstimate(session.tenantId) })
        return
      }
      if (request.method === 'GET' && url.pathname === '/v1/audit/export') {
        if (toolGatewayUrl === undefined) throw new ControlPlaneError(503, 'TOOL_GATEWAY_UNAVAILABLE', 'tool gateway is not configured')
        const upstream = await fetch(`${toolGatewayUrl}/v1/audit/export${url.search}`, { headers: { 'x-tenant-id': session.tenantId, 'x-user-id': session.userId, 'x-role': session.role } })
        const body = Buffer.from(await upstream.arrayBuffer())
        response.writeHead(upstream.status, {
          'content-type': upstream.headers.get('content-type') ?? 'application/json; charset=utf-8',
          ...(upstream.headers.get('content-disposition') === null ? {} : { 'content-disposition': upstream.headers.get('content-disposition')! }),
          'content-length': body.byteLength,
          'cache-control': 'no-store',
        })
        response.end(body)
        return
      }
      if (request.method === 'GET' && url.pathname === '/v1/audit-summary') {
        if (toolGatewayUrl === undefined) { write(response, 200, { total: 0, decisions: {}, unavailable: true }); return }
        const upstream = await fetch(`${toolGatewayUrl}/v1/audit/summary`, { headers: { 'x-tenant-id': session.tenantId, 'x-user-id': session.userId, 'x-role': session.role } })
        write(response, upstream.status, await upstream.json())
        return
      }
      if (request.method === 'GET' && url.pathname === '/v1/support-requests') {
        if (session.role !== 'admin') throw new ControlPlaneError(403, 'ADMIN_REQUIRED', 'admin role required')
        write(response, 200, { requests: await control.listSupportRequests(session.tenantId) })
        return
      }
      if (request.method === 'POST' && parts[0] === 'v1' && parts[1] === 'source-events' && parts[2] !== undefined && parts[3] === 'dispatch') {
        write(response, 202, await control.dispatchSourceEvent(session, parts[2]))
        return
      }
      if (request.method === 'GET' && url.pathname === '/v1/source-events') {
        if (session.role !== 'admin') throw new ControlPlaneError(403, 'ADMIN_REQUIRED', 'admin role required')
        write(response, 200, { events: await control.listSourceEvents(session.tenantId) })
        return
      }
      if (request.method === 'POST' && parts[0] === 'v1' && parts[1] === 'support-requests' && parts[2] !== undefined && parts[3] === 'decide') {
        if (session.role !== 'admin') throw new ControlPlaneError(403, 'ADMIN_REQUIRED', 'admin role required')
        const body = await readJson(request)
        if (typeof body.approved !== 'boolean') throw new Error('approved is required')
        write(response, 200, await control.decideSupportRequest(session.tenantId, parts[2], body.approved, session.userId))
        return
      }
      if (request.method === 'GET' && url.pathname === '/v1/models') {
        write(response, 200, { models: await control.listTenantModels(session.tenantId) })
        return
      }
      if (request.method === 'PUT' && parts[0] === 'v1' && parts[1] === 'models' && parts[2] !== undefined && parts[3] === 'default') {
        if (session.role !== 'admin') throw new ControlPlaneError(403, 'ADMIN_REQUIRED', 'admin role required')
        await control.bindTenantModel(session.tenantId, parts[2], true)
        write(response, 200, { models: await control.listTenantModels(session.tenantId) })
        return
      }
      if (parts[0] === 'v1' && parts[1] === 'users') {
        if (session.role !== 'admin') throw new ControlPlaneError(403, 'ADMIN_REQUIRED', 'admin role required')
        if (request.method === 'GET' && parts[2] === undefined) { write(response, 200, { users: control.listUsers(session.tenantId) }); return }
        if (request.method === 'POST' && parts[2] === undefined) {
          const body = await readJson(request)
          if (typeof body.email !== 'string' || (body.role !== 'admin' && body.role !== 'member')) throw new Error('email and role are required')
          write(response, 201, control.addUser({ tenantId: session.tenantId, email: body.email, role: body.role }))
          return
        }
        if (request.method === 'PUT' && parts[2] !== undefined && parts[3] === 'role') {
          const body = await readJson(request)
          if (body.role !== 'admin' && body.role !== 'member') throw new Error('role is required')
          await control.updateUserRole(session.tenantId, parts[2], body.role)
          write(response, 200, { updated: true })
          return
        }
      }
      if (url.pathname === '/v1/settings') {
        if (request.method === 'GET') { write(response, 200, control.getSettings(session.tenantId)); return }
        if (request.method === 'PUT') {
          const body = await readJson(request)
          await control.updateSettings(session, {
            ...(typeof body.nativeConversationEnabled === 'boolean' ? { nativeConversationEnabled: body.nativeConversationEnabled } : {}),
            ...(typeof body.byokEnabled === 'boolean' ? { byokEnabled: body.byokEnabled } : {}),
            ...(typeof body.localExecutionEnabled === 'boolean' ? { localExecutionEnabled: body.localExecutionEnabled } : {}),
          })
          write(response, 200, control.getSettings(session.tenantId))
          return
        }
      }
      if (request.method === 'POST' && url.pathname === '/v1/devices/pair/start') {
        const body = await readJson(request)
        if (typeof body.name !== 'string') throw new Error('name is required')
        write(response, 201, control.startPairing(session, body.name))
        return
      }
      if (request.method === 'POST' && url.pathname === '/v1/devices/pair/confirm') {
        const body = await readJson(request)
        if (typeof body.code !== 'string') throw new Error('code is required')
        write(response, 200, control.confirmPairing(session, body.code))
        return
      }
      if (request.method === 'GET' && url.pathname === '/v1/devices') {
        write(response, 200, { devices: control.listDevices(session) })
        return
      }
      if (request.method === 'POST' && parts[0] === 'v1' && parts[1] === 'devices' && parts[2] !== undefined && parts[3] === 'rotate-token') {
        const rotated = control.rotateDeviceToken(session, parts[2])
        deviceGateway?.closeDevice(parts[2])
        write(response, 200, rotated)
        return
      }
      if (request.method === 'POST' && parts[0] === 'v1' && parts[1] === 'devices' && parts[2] !== undefined && parts[3] === 'revoke') {
        control.revokeDevice(session, parts[2])
        deviceGateway?.closeDevice(parts[2])
        write(response, 200, { revoked: true })
        return
      }
      if (request.method === 'POST' && parts[0] === 'v1' && parts[1] === 'devices' && parts[2] !== undefined && parts[3] === 'tickets') {
        if (deviceGateway === undefined) throw new ControlPlaneError(503, 'DEVICE_GATEWAY_UNAVAILABLE', 'device gateway is not attached')
        const body = await readJson(request)
        if (typeof body.path !== 'string' || typeof body.prompt !== 'string') throw new Error('path and prompt are required')
        const ticket = control.createDeviceTicket(session, parts[2], { path: body.path, prompt: body.prompt })
        const delivered = deviceGateway.sendToDevice(session.tenantId, parts[2], {
          type: 'ticket.assign',
          ticketId: ticket.ticketId,
          assignment: ticket.assignment,
        })
        if (delivered) control.markDeviceTicketDelivered(session.tenantId, ticket.ticketId)
        write(response, 202, { ticketId: ticket.ticketId, delivered })
        return
      }
      if (parts[0] === 'v1' && parts[1] === 'tool-policies') {
        if (toolGatewayUrl === undefined) throw new ControlPlaneError(503, 'TOOL_GATEWAY_UNAVAILABLE', 'tool gateway is not configured')
        const headers = { 'content-type': 'application/json', 'x-tenant-id': session.tenantId, 'x-user-id': session.userId, 'x-role': session.role }
        const upstreamPath = `/v1/policies${parts[2] === undefined ? '' : `/${encodeURIComponent(parts[2])}`}`
        const init: RequestInit = { method: request.method ?? 'GET', headers }
        if (request.method === 'PUT') {
          const body = await readJson(request)
          if (body.effect !== 'approval' && body.effect !== 'deny') throw new Error('effect must be approval or deny')
          init.body = JSON.stringify({ effect: body.effect })
        }
        const upstream = await fetch(`${toolGatewayUrl}${upstreamPath}`, init)
        write(response, upstream.status, await upstream.json())
        return
      }
      if (request.method === 'GET' && url.pathname === '/v1/approvals') {
        if (toolGatewayUrl === undefined) { write(response, 200, { approvals: [] }); return }
        const upstream = await fetch(`${toolGatewayUrl}/v1/approvals`, {
          headers: { 'x-tenant-id': session.tenantId, 'x-user-id': session.userId, 'x-role': session.role },
        })
        write(response, upstream.status, await upstream.json())
        return
      }
      if (request.method === 'POST' && parts[0] === 'v1' && parts[1] === 'approvals' && parts[2] !== undefined && parts[3] === 'decide') {
        if (toolGatewayUrl === undefined) throw new ControlPlaneError(503, 'TOOL_GATEWAY_UNAVAILABLE', 'tool gateway is not configured')
        const body = await readJson(request)
        if (typeof body.approved !== 'boolean') throw new Error('approved is required')
        const upstream = await fetch(`${toolGatewayUrl}/v1/approvals/${parts[2]}/decide`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-tenant-id': session.tenantId, 'x-user-id': session.userId, 'x-role': session.role },
          body: JSON.stringify({ approved: body.approved }),
        })
        write(response, upstream.status, await upstream.json())
        return
      }
      if (request.method === 'POST' && parts[0] === 'v1' && parts[1] === 'bots' && parts[2] !== undefined && parts[3] === 'tickets') {
        if (deviceGateway === undefined) throw new ControlPlaneError(503, 'DEVICE_GATEWAY_UNAVAILABLE', 'device gateway is not attached')
        const body = await readJson(request)
        if (typeof body.deviceId !== 'string' || typeof body.path !== 'string' || typeof body.prompt !== 'string') throw new Error('deviceId, path and prompt are required')
        const ticket = control.createPersonalBotTicket(session, parts[2], body.deviceId, { path: body.path, prompt: body.prompt })
        const delivered = deviceGateway.sendToDevice(session.tenantId, body.deviceId, {
          type: 'ticket.assign', ticketId: ticket.ticketId, assignment: ticket.assignment,
        })
        if (delivered) control.markDeviceTicketDelivered(session.tenantId, ticket.ticketId)
        write(response, 202, { ticketId: ticket.ticketId, delivered })
        return
      }
      if (request.method === 'GET' && url.pathname === '/v1/bots') {
        write(response, 200, { bots: control.listBots(session) })
        return
      }
      if (request.method === 'POST' && url.pathname === '/v1/bots') {
        const body = await readJson(request)
        if (typeof body.name !== 'string' || body.name.trim() === '') throw new Error('name is required')
        write(response, 201, control.createBot(session, body.name.trim()))
        return
      }
      if (request.method === 'GET' && url.pathname === '/v1/tickets') {
        write(response, 200, { tickets: control.listTickets(session) })
        return
      }
      if (request.method === 'POST' && url.pathname === '/v1/tickets') {
        const body = await readJson(request)
        if (typeof body.path !== 'string' || typeof body.prompt !== 'string') throw new Error('path and prompt are required')
        write(response, 202, control.createTicket(session, { path: body.path, prompt: body.prompt }))
        return
      }
      if (request.method === 'POST' && url.pathname === '/v1/cloud-projects/tickets') {
        const body = await readJson(request)
        if (typeof body.repoUrl !== 'string' || typeof body.prompt !== 'string') throw new Error('repoUrl and prompt are required')
        write(response, 202, control.createCloudTicket(session, {
          repoUrl: body.repoUrl,
          baseRef: typeof body.baseRef === 'string' ? body.baseRef : 'main',
          prompt: body.prompt,
        }))
        return
      }
      if (parts[0] === 'v1' && parts[1] === 'tickets' && parts[2] !== undefined) {
        const ticketId = parts[2]
        if (request.method === 'GET' && parts.length === 4 && parts[3] === 'trace') {
          const ticket = control.ticketDetail(session, ticketId) as Record<string, unknown>
          let audit: unknown[] = []
          let auditChain: unknown
          if (toolGatewayUrl !== undefined) {
            const headers = { 'x-tenant-id': session.tenantId, 'x-user-id': session.userId, 'x-role': session.role }
            const upstream = await fetch(`${toolGatewayUrl}/v1/audit?ticketId=${encodeURIComponent(ticketId)}`, { headers })
            if (upstream.ok) {
              const body = await upstream.json() as { audit?: unknown[] }
              audit = body.audit ?? []
            }
            const integrity = await fetch(`${toolGatewayUrl}/v1/audit/verify`, { headers })
            if (integrity.ok) auditChain = await integrity.json()
          }
          const analytics = analyticsPath === undefined ? [] : (await readFile(analyticsPath, 'utf8')).split('\n').filter(Boolean).flatMap(line => {
            try {
              const event = JSON.parse(line) as Record<string, unknown>
              return event.ticketId === ticketId ? [event] : []
            } catch { return [] }
          })
          write(response, 200, { ticket, audit, analytics, ...(auditChain === undefined ? {} : { auditChain }) })
          return
        }
        if (request.method === 'GET' && parts.length === 3) {
          write(response, 200, control.ticketDetail(session, ticketId))
          return
        }
        if (request.method === 'POST' && parts[3] === 'input') {
          const body = await readJson(request)
          if (typeof body.text !== 'string' || body.text.trim() === '') throw new Error('text is required')
          if (control.cloudTicketTarget(session.tenantId, ticketId) !== undefined) {
            const followUp = await control.sendCloudFollowUp(session, ticketId, body.text)
            write(response, 202, { ticketId, assignmentId: followUp.assignmentId, accepted: true })
            return
          }
          const deviceTicket = control.deviceTicketTarget(session.tenantId, ticketId)
          if (deviceTicket !== undefined) {
            if (deviceGateway === undefined) throw new ControlPlaneError(503, 'DEVICE_GATEWAY_UNAVAILABLE', 'device gateway is not attached')
            const followUp = control.createDeviceFollowUp(session, ticketId, body.text)
            const delivered = deviceGateway.sendToDevice(session.tenantId, deviceTicket.deviceId, {
              type: 'ticket.assign', ticketId: followUp.ticketId, assignment: followUp.assignment,
            })
            if (delivered) control.markDeviceTicketDelivered(session.tenantId, followUp.ticketId)
            write(response, 200, { ticketId, delivered })
            return
          }
          write(response, 200, await control.sendTicketInput(session, ticketId, body.text))
          return
        }
        if (request.method === 'POST' && parts[3] === 'cancel') {
          if (control.cloudTicketTarget(session.tenantId, ticketId) !== undefined) {
            control.cancelCloudTicket(session, ticketId)
            write(response, 200, { ticketId, status: 'cancelled' })
            return
          }
          const deviceTicket = control.deviceTicketTarget(session.tenantId, ticketId)
          if (deviceTicket !== undefined) {
            if (deviceGateway === undefined) throw new ControlPlaneError(503, 'DEVICE_GATEWAY_UNAVAILABLE', 'device gateway is not attached')
            const delivered = deviceGateway.sendToDevice(session.tenantId, deviceTicket.deviceId, { type: 'ticket.cancel', ticketId })
            write(response, 200, { ticketId, delivered, status: delivered ? 'cancel-requested' : 'offline' })
            return
          }
          write(response, 200, await control.cancelTicket(session, ticketId))
          return
        }
      }
      write(response, 404, { error: 'not found', code: 'NOT_FOUND' })
    } catch (error) {
      const known = error instanceof ControlPlaneError
      write(response, known ? error.status : 400, {
        error: error instanceof Error ? error.message : String(error),
        ...(known ? { code: error.code } : {}),
      })
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? 4320, options.host ?? '127.0.0.1', () => { resolve() })
  })
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : options.port ?? 4320
  return {
    server,
    url: `http://${options.host ?? '127.0.0.1'}:${port}`,
    control,
    setDeviceGateway: gateway => {
      deviceGateway = gateway
      gateway.setMessageHandler((auth, message) => {
        if (message.type === 'ticket.event' && typeof message.ticketId === 'string' && 'event' in message) {
          try { control.recordDeviceEvent(auth.tenantId, message.ticketId, message.event) } catch { /* malformed device event is ignored */ }
        }
      })
      gateway.setConnectHandler(auth => {
        const key = `${auth.tenantId}/${auth.deviceId}`
        const timer = offlineTimers.get(key)
        if (timer !== undefined) { clearTimeout(timer); offlineTimers.delete(key) }
        for (const assignment of [...control.pendingDeviceAssignments(auth.tenantId, auth.deviceId), ...control.recoverableDeviceAssignments(auth.tenantId, auth.deviceId)]) {
          const delivered = gateway.sendToDevice(auth.tenantId, auth.deviceId, {
            type: 'ticket.assign',
            ticketId: assignment.ticketId,
            assignment: assignment.assignment,
          })
          if (delivered) control.markDeviceTicketDelivered(auth.tenantId, assignment.ticketId)
        }
      })
      gateway.setDisconnectHandler(auth => {
        const key = `${auth.tenantId}/${auth.deviceId}`
        const previous = offlineTimers.get(key)
        if (previous !== undefined) clearTimeout(previous)
        const timer = setTimeout(() => {
          offlineTimers.delete(key)
          if (!gateway.connectedDevices(auth.tenantId).includes(auth.deviceId)) control.markDeviceOffline(auth.tenantId, auth.deviceId)
        }, offlineLostMs)
        timer.unref?.()
        offlineTimers.set(key, timer)
      })
    },
    close: async () => {
      await new Promise<void>((resolve, reject) => server.close(error => { error === undefined ? resolve() : reject(error) }))
      if (cacheRefreshTimer !== undefined) clearInterval(cacheRefreshTimer)
      for (const timer of offlineTimers.values()) clearTimeout(timer)
      offlineTimers.clear()
      control.close()
    },
  }
}

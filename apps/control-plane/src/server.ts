/** HTTP entry for the single-box control plane. Production terminates SSO at a gateway. */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
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
  const control = new ControlPlane({ dbPath: options.dbPath, dataDir: options.dataDir, ...(options.sessionSecret === undefined ? {} : { sessionSecret: options.sessionSecret }), ...(options.botScenario === undefined ? {} : { botScenario: options.botScenario }) })
  let deviceGateway: DeviceGateway | undefined
  const toolGatewayUrl = options.toolGatewayUrl
  const analyticsPath = options.analyticsPath
  const ssoServiceToken = options.ssoServiceToken
  const platformAdminToken = options.platformAdminToken
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
<h2>Tenants</h2><div id="tenants">Load to begin.</div>
<h2 id="usersTitle" style="display:none">Users</h2><div id="users"></div>
<div id="error" style="color:#b00020"></div>
<script>
const token = () => sessionStorage.getItem('platformToken') || '';
const headers = () => ({'x-siriusx-platform-token': token(), 'content-type': 'application/json'});
const err = e => document.getElementById('error').textContent = e instanceof Error ? e.message : String(e);
async function api(path, init = {}) { const r = await fetch(path, {...init, headers: headers()}); const v = await r.json(); if (!r.ok) throw new Error(v.error || ('HTTP ' + r.status)); return v; }
function row(text) { const tr = document.createElement('tr'); for (const value of text) { const td = document.createElement('td'); td.textContent = String(value); tr.append(td); } return tr; }
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
  const host = document.getElementById('tenants'); host.textContent = '';
  const table = document.createElement('table'); table.append(row(['Name','Tenant','Issuer','Users','Devices','Device tickets','Cloud tickets','']));
  for (const tenant of data.tenants) {
    const tr = row([tenant.name, tenant.id, tenant.idpIssuer, tenant.usage.users, tenant.usage.devices, tenant.usage.deviceTickets, tenant.usage.cloudTickets]);
    const button = document.createElement('button'); button.textContent = 'Users'; button.onclick = () => loadUsers(tenant.id); const td = document.createElement('td'); td.append(button); tr.append(td); table.append(tr);
  }
  host.append(table);
}
async function loadUsers(tenantId) {
  err(''); document.getElementById('usersTitle').style.display = 'block';
  const data = await api('/v1/admin/tenants/' + encodeURIComponent(tenantId) + '/users');
  const host = document.getElementById('users'); host.textContent = '';
  const h = document.createElement('h3'); h.textContent = tenantId; host.append(h);
  const quota = await api('/v1/admin/tenants/' + encodeURIComponent(tenantId) + '/quota');
  const q = document.createElement('div'); q.innerHTML = '<h4>Quota</h4><input id="maxUsers" placeholder="Max users"><input id="maxDevices" placeholder="Max devices"><input id="maxCloud" placeholder="Max cloud/day"><input id="maxDevice" placeholder="Max device tickets/day"><button id="saveQuota">Save quota</button>'; host.append(q);
  q.querySelector('#maxUsers').value = quota.quota.maxUsers; q.querySelector('#maxDevices').value = quota.quota.maxDevices; q.querySelector('#maxCloud').value = quota.quota.maxCloudTicketsPerDay; q.querySelector('#maxDevice').value = quota.quota.maxDeviceTicketsPerDay;
  q.querySelector('#saveQuota').onclick = async () => { try { await api('/v1/admin/tenants/' + encodeURIComponent(tenantId) + '/quota', {method:'PUT', body: JSON.stringify({maxUsers:Number(q.querySelector('#maxUsers').value), maxDevices:Number(q.querySelector('#maxDevices').value), maxCloudTicketsPerDay:Number(q.querySelector('#maxCloud').value), maxDeviceTicketsPerDay:Number(q.querySelector('#maxDevice').value)})}); await loadUsers(tenantId); } catch (e) { err(e); } };
  const tm = await api('/v1/admin/tenants/' + encodeURIComponent(tenantId) + '/models');
  const catalog = await api('/v1/admin/models');
  const bound = new Map(tm.models.map(model => [model.id, model]));
  const modelBox = document.createElement('div'); modelBox.innerHTML = '<h4>Catalog models</h4>'; host.append(modelBox);
  for (const model of catalog.models) { const div = document.createElement('div'); div.textContent = model.id + ' · ' + model.name + (bound.get(model.id)?.isDefault ? ' (default)' : '') + ' '; const button = document.createElement('button'); const isBound = bound.has(model.id); button.textContent = isBound ? 'Set default' : 'Bind'; button.onclick = async () => { try { await api('/v1/admin/tenants/' + encodeURIComponent(tenantId) + '/models/' + encodeURIComponent(model.id), {method:'PUT', body: JSON.stringify({isDefault: !isBound ? false : true})}); await loadUsers(tenantId); } catch (e) { err(e); } }; div.append(button); modelBox.append(div); }
  const add = document.createElement('div'); add.innerHTML = '<input id="newEmail" placeholder="User email"><select id="newRole"><option>member</option><option>admin</option></select><button id="addUser">Add user</button>'; host.append(add);
  add.querySelector('#addUser').onclick = async () => { try { await api('/v1/admin/tenants/' + encodeURIComponent(tenantId) + '/users', {method:'POST', body: JSON.stringify({email: add.querySelector('#newEmail').value, role: add.querySelector('#newRole').value})}); await loadUsers(tenantId); } catch (e) { err(e); } };
  const table = document.createElement('table'); table.append(row(['Email','Role','User ID']));
  for (const user of data.users) table.append(row([user.email, user.role, user.userId]));
  host.append(table);
}
document.getElementById('load').onclick = async () => { try { sessionStorage.setItem('platformToken', document.getElementById('token').value); await Promise.all([loadTenants(), loadModels()]); } catch (e) { err(e); } };
document.getElementById('createModel').onclick = async () => { try { await api('/v1/admin/models', {method:'POST', body: JSON.stringify({id: document.getElementById('modelId').value || undefined, name: document.getElementById('modelName').value, provider: document.getElementById('modelProvider').value, model: document.getElementById('modelNameId').value})}); await loadModels(); } catch (e) { err(e); } };
document.getElementById('createTenant').onclick = async () => { try { await api('/v1/admin/tenants', {method:'POST', body: JSON.stringify({name:document.getElementById('name').value, idpIssuer:document.getElementById('issuer').value, adminEmail:document.getElementById('email').value, ...(document.getElementById('tenantId').value === '' ? {} : {tenantId:document.getElementById('tenantId').value})})}); await loadTenants(); } catch (e) { err(e); } };
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
        write(response, 200, control.ssoSession({ tenantId: body.tenantId, email: body.email, role: body.role }))
        return
      }
      if (parts[0] === 'v1' && parts[1] === 'admin') {
        requirePlatformAdmin(request)
        if (request.method === 'GET' && parts[2] === 'tenants' && parts[3] === undefined) {
          write(response, 200, { tenants: control.listTenants().map(tenant => ({ ...tenant, usage: control.tenantUsage(tenant.id) })) })
          return
        }
        if (request.method === 'POST' && parts[2] === 'tenants' && parts[3] === undefined) {
          const body = await readJson(request)
          if (typeof body.name !== 'string' || typeof body.idpIssuer !== 'string' || typeof body.adminEmail !== 'string') throw new Error('name, idpIssuer and adminEmail are required')
          const tenant = control.provisionTenant({
            name: body.name, idpIssuer: body.idpIssuer, adminEmail: body.adminEmail,
            ...(typeof body.tenantId === 'string' ? { tenantId: body.tenantId } : {}),
          })
          write(response, 201, { tenant })
          return
        }
        if (parts[2] === 'models' && parts[3] === undefined) {
          if (request.method === 'GET') { write(response, 200, { models: control.listModelCatalog() }); return }
          if (request.method === 'POST') {
            const body = await readJson(request)
            if (typeof body.name !== 'string' || typeof body.provider !== 'string' || typeof body.model !== 'string') throw new Error('name, provider and model are required')
            write(response, 201, control.addModel({ name: body.name, provider: body.provider, model: body.model, ...(typeof body.id === 'string' ? { id: body.id } : {}) }))
            return
          }
        }
        if (parts[2] === 'tenants' && parts[3] !== undefined && parts[4] === 'models') {
          if (request.method === 'GET' && parts[5] === undefined) { write(response, 200, { models: control.listTenantModels(parts[3]) }); return }
          if (request.method === 'PUT' && parts[5] !== undefined) {
            const body = await readJson(request)
            control.bindTenantModel(parts[3], parts[5], body.isDefault === true)
            write(response, 200, { models: control.listTenantModels(parts[3]) })
            return
          }
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
            write(response, 200, { quota: control.setQuota(parts[3], patch), usage: control.tenantUsage(parts[3]) })
            return
          }
        }
        if (parts[2] === 'tenants' && parts[3] !== undefined && parts[4] === 'users') {
          if (request.method === 'GET' && parts[5] === undefined) { write(response, 200, { users: control.listUsers(parts[3]) }); return }
          if (request.method === 'POST' && parts[5] === undefined) {
            const body = await readJson(request)
            if (typeof body.email !== 'string' || (body.role !== 'admin' && body.role !== 'member')) throw new Error('email and role are required')
            write(response, 201, control.addUser({ tenantId: parts[3], email: body.email, role: body.role }))
            return
          }
          if (request.method === 'PUT' && parts[5] !== undefined && parts[6] === 'role') {
            const body = await readJson(request)
            if (body.role !== 'admin' && body.role !== 'member') throw new Error('role is required')
            control.updateUserRole(parts[3], parts[5], body.role)
            write(response, 200, { updated: true })
            return
          }
        }
        write(response, 404, { error: 'not found', code: 'NOT_FOUND' })
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
      if (request.method === 'GET' && url.pathname === '/v1/models') {
        write(response, 200, { models: control.listTenantModels(session.tenantId) })
        return
      }
      if (request.method === 'PUT' && parts[0] === 'v1' && parts[1] === 'models' && parts[2] !== undefined && parts[3] === 'default') {
        if (session.role !== 'admin') throw new ControlPlaneError(403, 'ADMIN_REQUIRED', 'admin role required')
        control.bindTenantModel(session.tenantId, parts[2], true)
        write(response, 200, { models: control.listTenantModels(session.tenantId) })
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
          control.updateUserRole(session.tenantId, parts[2], body.role)
          write(response, 200, { updated: true })
          return
        }
      }
      if (url.pathname === '/v1/settings') {
        if (request.method === 'GET') { write(response, 200, control.getSettings(session.tenantId)); return }
        if (request.method === 'PUT') {
          const body = await readJson(request)
          control.updateSettings(session, {
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
      for (const timer of offlineTimers.values()) clearTimeout(timer)
      offlineTimers.clear()
      control.close()
    },
  }
}

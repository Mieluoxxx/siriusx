/** SiriusX control plane: tenants, users, devices, bots, settings, and per-tenant Bot runtimes. */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { Storage } from '@siriusx/storage'
import { BotService } from '@siriusx/autobot/bot-service'
import { FakeKernel } from '@siriusx/fake-kernel'
import { LocalExecutor } from '@siriusx/executor-local'
import { AssignmentEventSchema, type AssignmentEvent } from '@siriusx/contracts/executor'
import { deriveTicketStage, type TicketStage } from '@siriusx/contracts/ticket-stage'
import { CloudExecutor, DockerSandboxProvider, type CancelAssignment } from '@siriusx/cloud-executor'
import { AcpCloudKernel } from '@siriusx/kernel-acp'
import { fileURLToPath } from 'node:url'

export type Role = 'admin' | 'member'

export interface DesktopSsoConfig {
  readonly issuer: string
  readonly clientId: string
  readonly jwksUri?: string
  readonly hs256Secret?: string
  readonly tenantClaim?: string
  readonly adminRole?: string
  readonly modelGatewayUrl?: string
}

export interface ControlPlaneOptions {
  readonly storage?: Storage
  readonly desktopSso?: DesktopSsoConfig
  readonly dbPath: string
  readonly dataDir: string
  readonly sessionSecret?: string
  readonly now?: () => number
  readonly botScenario?: 'ready' | 'waiting'
  readonly sessionTtlMs?: number
  readonly secretsKey?: string
  readonly modelRouterConfigPath?: string
  readonly modelRouterKey?: string
}

export interface Session {
  readonly tenantId: string
  readonly userId: string
  readonly role: Role
}

export interface Tenant {
  readonly id: string
  readonly name: string
  readonly idpIssuer: string
  readonly createdAt: number
  readonly status: 'active' | 'suspended'
}

export interface Device {
  readonly id: string
  readonly tenantId: string
  readonly userId: string
  readonly name: string
  readonly revoked: boolean
  readonly lastSeenAt: number | null
}

export interface PersonalBot {
  readonly id: string
  readonly tenantId: string
  readonly ownerUserId: string
  readonly name: string
}

export class ControlPlaneError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ControlPlaneError'
    this.status = status
    this.code = code
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  idp_issuer TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS users_tenant_email ON users(tenant_id, email);
CREATE TABLE IF NOT EXISTS settings (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  native_conversation_enabled INTEGER NOT NULL DEFAULT 1,
  byok_enabled INTEGER NOT NULL DEFAULT 1,
  local_execution_enabled INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  token_hash TEXT,
  token_expires_at INTEGER,
  revoked INTEGER NOT NULL DEFAULT 0,
  last_seen_at INTEGER
);
CREATE TABLE IF NOT EXISTS pairing_codes (
  code TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  device_name TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE TABLE IF NOT EXISTS source_bindings (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  bot_id TEXT,
  repo_url TEXT,
  base_ref TEXT,
  auto_dispatch INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE(provider, external_id)
);
CREATE TABLE IF NOT EXISTS source_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  binding_id TEXT,
  tenant_id TEXT,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'received',
  ticket_id TEXT,
  UNIQUE(provider, delivery_id)
);
CREATE TABLE IF NOT EXISTS tenant_billing (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  currency TEXT NOT NULL DEFAULT 'USD',
  cloud_ticket_cents INTEGER NOT NULL DEFAULT 0,
  device_ticket_cents INTEGER NOT NULL DEFAULT 0,
  monthly_budget_cents INTEGER
);
CREATE TABLE IF NOT EXISTS support_requests (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  requested_by TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL,
  requested_at INTEGER NOT NULL,
  decided_at INTEGER,
  expires_at INTEGER
);
CREATE TABLE IF NOT EXISTS platform_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  detail TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS model_catalog (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tenant_model_upstreams (
  tenant_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  protocol TEXT NOT NULL DEFAULT 'chat',
  base_url TEXT NOT NULL,
  upstream_model TEXT NOT NULL,
  api_key_cipher TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, model_id, id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (model_id) REFERENCES model_catalog(id)
);
CREATE TABLE IF NOT EXISTS tenant_models (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  model_id TEXT NOT NULL REFERENCES model_catalog(id),
  is_default INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, model_id)
);
CREATE TABLE IF NOT EXISTS tenant_quotas (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  max_users INTEGER NOT NULL,
  max_devices INTEGER NOT NULL,
  max_cloud_tickets_per_day INTEGER NOT NULL,
  max_device_tickets_per_day INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS revoked_sessions (
  session_id TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS bots (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS device_tickets (
  ticket_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  device_id TEXT NOT NULL REFERENCES devices(id),
  path TEXT NOT NULL,
  prompt TEXT NOT NULL,
  stage TEXT NOT NULL,
  latest_state TEXT,
  report_kind TEXT,
  delivery_failing INTEGER NOT NULL DEFAULT 0,
  report_json TEXT,
  assignment_json TEXT,
  event_count INTEGER NOT NULL DEFAULT 0,
  delivered_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS device_ticket_events (
  ticket_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  event_json TEXT NOT NULL,
  PRIMARY KEY (ticket_id, seq)
);
CREATE TABLE IF NOT EXISTS cloud_tickets (
  ticket_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  assignment_id TEXT NOT NULL,
  repo_url TEXT NOT NULL,
  base_ref TEXT NOT NULL,
  prompt TEXT NOT NULL,
  stage TEXT NOT NULL,
  state TEXT NOT NULL,
  report_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cloud_ticket_events (
  ticket_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  event_json TEXT NOT NULL,
  PRIMARY KEY (ticket_id, seq)
);
`

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

export class ControlPlane {
  readonly #db: DatabaseSync
  readonly #storage: Storage | undefined
  readonly #desktopSso: DesktopSsoConfig | undefined
  readonly #secretsKey: Buffer
  readonly #modelRouterConfigPath: string | undefined
  readonly #modelRouterKey: string
  readonly #tenantCache = new Map<string, Tenant>()
  readonly #userCache = new Map<string, { id: string; tenantId: string; email: string; role: Role; createdAt: number }>()
  readonly #settingsCache = new Map<string, { nativeConversationEnabled: boolean; byokEnabled: boolean; localExecutionEnabled: boolean }>()
  readonly #quotaCache = new Map<string, { maxUsers: number; maxDevices: number; maxCloudTicketsPerDay: number; maxDeviceTicketsPerDay: number }>()
  #cacheReady = false
  #cacheStop: (() => Promise<void>) | undefined
  readonly #dataDir: string
  readonly #secret: string
  readonly #now: () => number
  readonly #botScenario: 'ready' | 'waiting'
  readonly #sessionTtlMs: number
  readonly #runtimes = new Map<string, BotService>()
  readonly #cloudRuns = new Map<string, Promise<void>>()
  #cloud: CloudExecutor | undefined
  readonly #pairingFailures = new Map<string, { count: number; resetAt: number }>()

  constructor(options: ControlPlaneOptions) {
    mkdirSync(options.dataDir, { recursive: true })
    this.#db = new DatabaseSync(options.dbPath)
    this.#storage = options.storage
    this.#desktopSso = options.desktopSso
    this.#secretsKey = createHash('sha256').update(options.secretsKey ?? options.sessionSecret ?? 'siriusx-local-secret').digest()
    this.#modelRouterConfigPath = options.modelRouterConfigPath
    this.#modelRouterKey = options.modelRouterKey ?? 'sk-siriusx-router'
    this.#db.exec(SCHEMA)
    const tenantColumns = this.#db.prepare('PRAGMA table_info(tenants)').all() as Array<{ name: string }>
    if (!tenantColumns.some(column => column.name === 'status')) this.#db.exec("ALTER TABLE tenants ADD COLUMN status TEXT NOT NULL DEFAULT 'active'")
    const bindingColumns = this.#db.prepare('PRAGMA table_info(source_bindings)').all() as Array<{ name: string }>
    if (!bindingColumns.some(column => column.name === 'auto_dispatch')) this.#db.exec('ALTER TABLE source_bindings ADD COLUMN auto_dispatch INTEGER NOT NULL DEFAULT 0')
    const eventColumns = this.#db.prepare('PRAGMA table_info(source_events)').all() as Array<{ name: string }>
    if (!eventColumns.some(column => column.name === 'status')) this.#db.exec("ALTER TABLE source_events ADD COLUMN status TEXT NOT NULL DEFAULT 'received'")
    if (!eventColumns.some(column => column.name === 'ticket_id')) this.#db.exec('ALTER TABLE source_events ADD COLUMN ticket_id TEXT')
    this.#dataDir = options.dataDir
    this.#secret = options.sessionSecret ?? randomBytes(32).toString('base64url')
    this.#now = options.now ?? Date.now
    this.#db.prepare('INSERT OR IGNORE INTO model_catalog (id, name, provider, model, enabled, created_at) VALUES (?, ?, ?, ?, 1, ?)').run('tenant-default', 'Tenant default', 'upstream', 'tenant-default', this.#now())
    this.#db.prepare('INSERT OR IGNORE INTO tenant_models (tenant_id, model_id, is_default) SELECT id, ?, 1 FROM tenants').run('tenant-default')
    this.#db.prepare('INSERT OR IGNORE INTO tenant_billing (tenant_id, currency, cloud_ticket_cents, device_ticket_cents, monthly_budget_cents) SELECT id, \'USD\', 0, 0, NULL FROM tenants').run()
    this.#db.prepare('INSERT OR IGNORE INTO tenant_quotas (tenant_id, max_users, max_devices, max_cloud_tickets_per_day, max_device_tickets_per_day, updated_at) SELECT id, 50, 20, 100, 500, ? FROM tenants').run(this.#now())
    const deviceColumns = this.#db.prepare('PRAGMA table_info(devices)').all() as Array<{ name: string }>
    if (!deviceColumns.some(column => column.name === 'token_expires_at')) this.#db.exec('ALTER TABLE devices ADD COLUMN token_expires_at INTEGER')
    this.#botScenario = options.botScenario ?? 'ready'
    this.#sessionTtlMs = options.sessionTtlMs ?? 12 * 60 * 60 * 1000
    this.reconcileCloudTickets()
  }

  close(): void {
    for (const runtime of this.#runtimes.values()) runtime.close()
    void this.#cloud?.close()
    this.#runtimes.clear()
    this.#db.close()
  }

  private tenantRow(tenantId: string): { id: string; name: string; idp_issuer: string; created_at: number; status: 'active' | 'suspended' } {
    if (this.#storage !== undefined && this.#cacheReady) {
      const cached = this.#tenantCache.get(tenantId)
      if (cached === undefined) throw new ControlPlaneError(404, 'TENANT_NOT_FOUND', tenantId)
      return { id: cached.id, name: cached.name, idp_issuer: cached.idpIssuer, created_at: cached.createdAt, status: cached.status }
    }
    const row = this.#db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId) as
      | { id: string; name: string; idp_issuer: string; created_at: number; status: 'active' | 'suspended' }
      | undefined
    if (row === undefined) throw new ControlPlaneError(404, 'TENANT_NOT_FOUND', tenantId)
    return row
  }

  async provisionTenant(input: { name: string; idpIssuer: string; adminEmail: string; tenantId?: string }): Promise<Tenant> {
    const id = input.tenantId ?? randomUUID()
    const now = this.#now()
    const adminUserId = randomUUID()
    this.#db.exec('BEGIN')
    try {
      this.#db.prepare('INSERT INTO tenants (id, name, idp_issuer, status, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(id, input.name, input.idpIssuer, 'active', now)
      this.#db.prepare('INSERT INTO settings (tenant_id) VALUES (?)').run(id)
      this.#db.prepare('INSERT OR IGNORE INTO tenant_models (tenant_id, model_id, is_default) VALUES (?, ?, 1)').run(id, 'tenant-default')
      this.#db.prepare('INSERT INTO tenant_billing (tenant_id, currency, cloud_ticket_cents, device_ticket_cents, monthly_budget_cents) VALUES (?, \'USD\', 0, 0, NULL)').run(id)
      this.#db.prepare('INSERT INTO tenant_quotas (tenant_id, max_users, max_devices, max_cloud_tickets_per_day, max_device_tickets_per_day, updated_at) VALUES (?, 50, 20, 100, 500, ?)').run(id, now)
      this.#db.prepare('INSERT INTO users (id, tenant_id, email, role, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(adminUserId, id, input.adminEmail, 'admin', now)
      if (this.#storage !== undefined) {
        await this.#storage.query('INSERT INTO tenants (id, name, idp_issuer, status, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING', [id, input.name, input.idpIssuer, 'active', now])
        await this.#storage.query('INSERT INTO settings (tenant_id) VALUES (?) ON CONFLICT (tenant_id) DO NOTHING', [id])
        await this.#storage.query('INSERT INTO users (id, tenant_id, email, role, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (tenant_id, email) DO NOTHING', [adminUserId, id, input.adminEmail, 'admin', now])
        await this.#storage.query('INSERT INTO tenant_models (tenant_id, model_id, is_default) VALUES (?, ?, 1) ON CONFLICT (tenant_id, model_id) DO NOTHING', [id, 'tenant-default'])
        await this.#storage.query('INSERT INTO tenant_quotas (tenant_id, max_users, max_devices, max_cloud_tickets_per_day, max_device_tickets_per_day, updated_at) VALUES (?, 50, 20, 100, 500, ?) ON CONFLICT (tenant_id) DO NOTHING', [id, now])
      }
      this.#db.exec('COMMIT')
    } catch (error) {
      this.#db.exec('ROLLBACK')
      throw error
    }
    const tenant = { id, name: input.name, idpIssuer: input.idpIssuer, createdAt: now, status: 'active' as const }
    if (this.#storage !== undefined) {
      this.#tenantCache.set(id, tenant)
      this.#userCache.set(adminUserId, { id: adminUserId, tenantId: id, email: input.adminEmail, role: 'admin' as Role, createdAt: now })
      this.#settingsCache.set(id, { nativeConversationEnabled: true, byokEnabled: true, localExecutionEnabled: true })
      this.#quotaCache.set(id, { maxUsers: 50, maxDevices: 20, maxCloudTicketsPerDay: 100, maxDeviceTicketsPerDay: 500 })
      await this.#notifyCacheChange()
    }
    return tenant
  }

  async setTenantStatus(tenantId: string, status: 'active' | 'suspended'): Promise<Tenant> {
    const current = this.tenantRow(tenantId)
    if (this.#storage !== undefined) await this.#storage.query('UPDATE tenants SET status = ? WHERE id = ?', [status, tenantId])
    this.#db.prepare('UPDATE tenants SET status = ? WHERE id = ?').run(status, tenantId)
    const tenant = { id: tenantId, name: current.name, idpIssuer: current.idp_issuer, createdAt: current.created_at, status }
    if (this.#storage !== undefined) { this.#tenantCache.set(tenantId, tenant); await this.#notifyCacheChange() }
    return tenant
  }

  async updateTenant(tenantId: string, patch: { name?: string; idpIssuer?: string }): Promise<Tenant> {
    const current = this.tenantRow(tenantId)
    const name = patch.name ?? current.name
    const idpIssuer = patch.idpIssuer ?? current.idp_issuer
    if (this.#storage !== undefined) await this.#storage.query('UPDATE tenants SET name = ?, idp_issuer = ? WHERE id = ?', [name, idpIssuer, tenantId])
    this.#db.prepare('UPDATE tenants SET name = ?, idp_issuer = ? WHERE id = ?').run(name, idpIssuer, tenantId)
    const tenant = { id: tenantId, name, idpIssuer, createdAt: current.created_at, status: current.status }
    if (this.#storage !== undefined) { this.#tenantCache.set(tenantId, tenant); await this.#notifyCacheChange() }
    return tenant
  }

  listTenants(): Tenant[] {
    if (this.#storage !== undefined && this.#cacheReady) return [...this.#tenantCache.values()].sort((left, right) => left.createdAt - right.createdAt)
    return (this.#db.prepare('SELECT * FROM tenants ORDER BY created_at, rowid').all() as Array<{
      id: string; name: string; idp_issuer: string; created_at: number; status: 'active' | 'suspended'
    }>).map(row => ({ id: row.id, name: row.name, idpIssuer: row.idp_issuer, createdAt: row.created_at, status: row.status }))
  }

  async getBilling(tenantId: string): Promise<{ currency: string; cloudTicketCents: number; deviceTicketCents: number; monthlyBudgetCents: number | null }> {
    this.tenantRow(tenantId)
    let row: { currency: string; cloud_ticket_cents: number; device_ticket_cents: number; monthly_budget_cents: number | null } | undefined
    if (this.#storage !== undefined) {
      row = (await this.#storage.query<{ currency: string; cloud_ticket_cents: string | number; device_ticket_cents: string | number; monthly_budget_cents: string | number | null }>('SELECT * FROM tenant_billing WHERE tenant_id = ?', [tenantId])).rows[0] as typeof row
      if (row !== undefined) {
        row = { ...row, cloud_ticket_cents: Number(row.cloud_ticket_cents), device_ticket_cents: Number(row.device_ticket_cents), monthly_budget_cents: row.monthly_budget_cents === null ? null : Number(row.monthly_budget_cents) }
      }
    } else {
      row = this.#db.prepare('SELECT * FROM tenant_billing WHERE tenant_id = ?').get(tenantId) as typeof row
    }
    return row === undefined
      ? { currency: 'USD', cloudTicketCents: 0, deviceTicketCents: 0, monthlyBudgetCents: null }
      : { currency: row.currency, cloudTicketCents: row.cloud_ticket_cents, deviceTicketCents: row.device_ticket_cents, monthlyBudgetCents: row.monthly_budget_cents }
  }

  async setBilling(tenantId: string, patch: Partial<{ currency: string; cloudTicketCents: number; deviceTicketCents: number; monthlyBudgetCents: number | null }>): Promise<{ currency: string; cloudTicketCents: number; deviceTicketCents: number; monthlyBudgetCents: number | null }> {
    this.tenantRow(tenantId)
    const current = await this.getBilling(tenantId)
    const next = { ...current, ...patch }
    if (next.currency.length < 3 || next.currency.length > 8) throw new ControlPlaneError(400, 'INVALID_BILLING', 'currency must be 3-8 characters')
    for (const value of [next.cloudTicketCents, next.deviceTicketCents]) if (!Number.isSafeInteger(value) || value < 0) throw new ControlPlaneError(400, 'INVALID_BILLING', 'ticket prices must be non-negative integers')
    if (next.monthlyBudgetCents !== null && (!Number.isSafeInteger(next.monthlyBudgetCents) || next.monthlyBudgetCents < 0)) throw new ControlPlaneError(400, 'INVALID_BILLING', 'monthly budget must be null or a non-negative integer')
    if (this.#storage !== undefined) {
      await this.#storage.query('INSERT INTO tenant_billing (tenant_id, currency, cloud_ticket_cents, device_ticket_cents, monthly_budget_cents) VALUES (?, ?, ?, ?, ?) ON CONFLICT (tenant_id) DO UPDATE SET currency = EXCLUDED.currency, cloud_ticket_cents = EXCLUDED.cloud_ticket_cents, device_ticket_cents = EXCLUDED.device_ticket_cents, monthly_budget_cents = EXCLUDED.monthly_budget_cents', [tenantId, next.currency, next.cloudTicketCents, next.deviceTicketCents, next.monthlyBudgetCents])
      return next
    }
    this.#db.prepare('INSERT OR REPLACE INTO tenant_billing (tenant_id, currency, cloud_ticket_cents, device_ticket_cents, monthly_budget_cents) VALUES (?, ?, ?, ?, ?)')
      .run(tenantId, next.currency, next.cloudTicketCents, next.deviceTicketCents, next.monthlyBudgetCents)
    return next
  }

  async billingEstimate(tenantId: string, days = 30): Promise<{ currency: string; cloudTickets: number; deviceTickets: number; estimatedCents: number; monthlyBudgetCents: number | null }> {
    const billing = await this.getBilling(tenantId)
    const usage = this.usageDaily(tenantId, days)
    const cloudTickets = usage.reduce((sum, day) => sum + day.cloudTickets, 0)
    const deviceTickets = usage.reduce((sum, day) => sum + day.deviceTickets, 0)
    return { currency: billing.currency, cloudTickets, deviceTickets, estimatedCents: cloudTickets * billing.cloudTicketCents + deviceTickets * billing.deviceTicketCents, monthlyBudgetCents: billing.monthlyBudgetCents }
  }

  async createSourceBinding(input: { provider: 'gitlab' | 'github' | 'feishu' | 'teams'; externalId: string; tenantId: string; botId?: string; repoUrl?: string; baseRef?: string; autoDispatch?: boolean }): Promise<{ id: string }> {
    this.tenantRow(input.tenantId)
    if (input.externalId.trim() === '') throw new ControlPlaneError(400, 'INVALID_BINDING', 'externalId is required')
    const id = randomUUID()
    if (this.#storage !== undefined) await this.#storage.query('INSERT INTO source_bindings (id, provider, external_id, tenant_id, bot_id, repo_url, base_ref, auto_dispatch, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [id, input.provider, input.externalId, input.tenantId, input.botId ?? null, input.repoUrl ?? null, input.baseRef ?? null, input.autoDispatch === true ? 1 : 0, this.#now()])
    this.#db.prepare('INSERT INTO source_bindings (id, provider, external_id, tenant_id, bot_id, repo_url, base_ref, auto_dispatch, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, input.provider, input.externalId, input.tenantId, input.botId ?? null, input.repoUrl ?? null, input.baseRef ?? null, input.autoDispatch === true ? 1 : 0, this.#now())
    return { id }
  }

  async listSourceBindings(tenantId?: string): Promise<Array<{ id: string; provider: string; externalId: string; tenantId: string; botId: string | null; repoUrl: string | null; baseRef: string | null; autoDispatch: boolean }>> {
    if (this.#storage !== undefined) {
      const result = tenantId === undefined
        ? await this.#storage.query<{ id: string; provider: string; external_id: string; tenant_id: string; bot_id: string | null; repo_url: string | null; base_ref: string | null; auto_dispatch: number | string }>('SELECT * FROM source_bindings ORDER BY created_at, id')
        : await this.#storage.query<{ id: string; provider: string; external_id: string; tenant_id: string; bot_id: string | null; repo_url: string | null; base_ref: string | null; auto_dispatch: number | string }>('SELECT * FROM source_bindings WHERE tenant_id = ? ORDER BY created_at, id', [tenantId])
      return result.rows.map(row => ({ id: row.id, provider: row.provider, externalId: row.external_id, tenantId: row.tenant_id, botId: row.bot_id, repoUrl: row.repo_url, baseRef: row.base_ref, autoDispatch: Number(row.auto_dispatch) === 1 }))
    }
    const rows = tenantId === undefined
      ? this.#db.prepare('SELECT * FROM source_bindings ORDER BY created_at, rowid').all()
      : this.#db.prepare('SELECT * FROM source_bindings WHERE tenant_id = ? ORDER BY created_at, rowid').all(tenantId)
    return (rows as Array<{ id: string; provider: string; external_id: string; tenant_id: string; bot_id: string | null; repo_url: string | null; base_ref: string | null; auto_dispatch: number }>).map(row => ({
      id: row.id, provider: row.provider, externalId: row.external_id, tenantId: row.tenant_id, botId: row.bot_id, repoUrl: row.repo_url, baseRef: row.base_ref, autoDispatch: row.auto_dispatch === 1,
    }))
  }

  async findSourceBinding(provider: string, externalId: string): Promise<{ id: string; tenantId: string; botId: string | null; repoUrl: string | null; baseRef: string | null; autoDispatch: boolean } | undefined> {
    let row: { id: string; tenant_id: string; bot_id: string | null; repo_url: string | null; base_ref: string | null; auto_dispatch: number | string } | undefined
    if (this.#storage !== undefined) row = (await this.#storage.query<{ id: string; tenant_id: string; bot_id: string | null; repo_url: string | null; base_ref: string | null; auto_dispatch: number | string }>('SELECT * FROM source_bindings WHERE provider = ? AND external_id = ?', [provider, externalId])).rows[0] as typeof row
    else row = this.#db.prepare('SELECT * FROM source_bindings WHERE provider = ? AND external_id = ?').get(provider, externalId) as typeof row
    return row === undefined ? undefined : { id: row.id, tenantId: row.tenant_id, botId: row.bot_id, repoUrl: row.repo_url, baseRef: row.base_ref, autoDispatch: Number(row.auto_dispatch) === 1 }
  }

  async getSourceBinding(id: string): Promise<{ id: string; provider: string; externalId: string; tenantId: string; botId: string | null; repoUrl: string | null; baseRef: string | null; autoDispatch: boolean } | undefined> {
    let row: { id: string; provider: string; external_id: string; tenant_id: string; bot_id: string | null; repo_url: string | null; base_ref: string | null; auto_dispatch: number | string } | undefined
    if (this.#storage !== undefined) row = (await this.#storage.query<{ id: string; provider: string; external_id: string; tenant_id: string; bot_id: string | null; repo_url: string | null; base_ref: string | null; auto_dispatch: number | string }>('SELECT * FROM source_bindings WHERE id = ?', [id])).rows[0] as typeof row
    else row = this.#db.prepare('SELECT * FROM source_bindings WHERE id = ?').get(id) as typeof row
    return row === undefined ? undefined : { id: row.id, provider: row.provider, externalId: row.external_id, tenantId: row.tenant_id, botId: row.bot_id, repoUrl: row.repo_url, baseRef: row.base_ref, autoDispatch: Number(row.auto_dispatch) === 1 }
  }

  async getSourceEvent(tenantId: string, eventId: string): Promise<{ id: string; provider: string; bindingId: string | null; eventType: string; payload: Record<string, unknown>; status: string; ticketId: string | null } | undefined> {
    let row: { id: string; provider: string; binding_id: string | null; event_type: string; payload_json: string; status: string; ticket_id: string | null } | undefined
    if (this.#storage !== undefined) row = (await this.#storage.query<{ id: string; provider: string; binding_id: string | null; event_type: string; payload_json: string; status: string; ticket_id: string | null }>('SELECT * FROM source_events WHERE id = ? AND tenant_id = ?', [eventId, tenantId])).rows[0] as typeof row
    else row = this.#db.prepare('SELECT * FROM source_events WHERE id = ? AND tenant_id = ?').get(eventId, tenantId) as typeof row
    if (row === undefined) return undefined
    return { id: row.id, provider: row.provider, bindingId: row.binding_id, eventType: row.event_type, payload: JSON.parse(row.payload_json) as Record<string, unknown>, status: row.status, ticketId: row.ticket_id }
  }

  async dispatchSourceEvent(session: Session, eventId: string): Promise<{ ticketId: string }> {
    if (session.role !== 'admin') throw new ControlPlaneError(403, 'ADMIN_REQUIRED', 'admin role required')
    const event = await this.getSourceEvent(session.tenantId, eventId)
    if (event === undefined) throw new ControlPlaneError(404, 'SOURCE_EVENT_NOT_FOUND', eventId)
    if (event.status === 'dispatched' && event.ticketId !== null) return { ticketId: event.ticketId }
    if (event.bindingId === null) throw new ControlPlaneError(409, 'SOURCE_BINDING_MISSING', eventId)
    const binding = await this.getSourceBinding(event.bindingId)
    if (binding === undefined || binding.repoUrl === null) throw new ControlPlaneError(409, 'SOURCE_BINDING_INCOMPLETE', eventId)
    const attributes = typeof event.payload.object_attributes === 'object' && event.payload.object_attributes !== null ? event.payload.object_attributes as Record<string, unknown> : {}
    const issue = typeof event.payload.issue === 'object' && event.payload.issue !== null ? event.payload.issue as Record<string, unknown> : {}
    const message = typeof event.payload.event === 'object' && event.payload.event !== null ? (event.payload.event as Record<string, unknown>).message as Record<string, unknown> | undefined : undefined
    const rawPrompt = typeof attributes.title === 'string' ? attributes.title : typeof issue.title === 'string' ? issue.title : typeof event.payload.text === 'string' ? event.payload.text : typeof message?.content === 'string' ? message.content : event.eventType
    const ticket = this.createCloudTicketFromSource({ tenantId: session.tenantId, operatorId: `app:${session.userId}`, channel: binding.provider as 'gitlab' | 'github' | 'feishu' | 'teams', repoUrl: binding.repoUrl, baseRef: binding.baseRef ?? 'main', prompt: `${event.provider} ${event.eventType}: ${rawPrompt}` })
    await this.markSourceEvent(event.id, 'dispatched', ticket.ticketId)
    return ticket
  }

  async recordSourceEvent(input: { provider: string; deliveryId: string; bindingId?: string; tenantId?: string; eventType: string; payload: unknown }): Promise<{ id: string; accepted: boolean }> {
    const id = randomUUID()
    if (this.#storage !== undefined) {
      const result = await this.#storage.query('INSERT INTO source_events (id, provider, delivery_id, binding_id, tenant_id, event_type, payload_json, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (provider, delivery_id) DO NOTHING', [id, input.provider, input.deliveryId, input.bindingId ?? null, input.tenantId ?? null, input.eventType, JSON.stringify(input.payload), this.#now()])
      if (result.rowCount === 1) return { id, accepted: true }
      const existing = await this.#storage.query<{ id: string }>('SELECT id FROM source_events WHERE provider = ? AND delivery_id = ?', [input.provider, input.deliveryId])
      return { id: existing.rows[0]!.id, accepted: false }
    }
    const result = this.#db.prepare('INSERT OR IGNORE INTO source_events (id, provider, delivery_id, binding_id, tenant_id, event_type, payload_json, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, input.provider, input.deliveryId, input.bindingId ?? null, input.tenantId ?? null, input.eventType, JSON.stringify(input.payload), this.#now())
    return { id: result.changes === 1 ? id : (this.#db.prepare('SELECT id FROM source_events WHERE provider = ? AND delivery_id = ?').get(input.provider, input.deliveryId) as { id: string }).id, accepted: result.changes === 1 }
  }

  async markSourceEvent(eventId: string, status: string, ticketId?: string): Promise<void> {
    if (this.#storage !== undefined) {
      await this.#storage.query('UPDATE source_events SET status = ?, ticket_id = ? WHERE id = ?', [status, ticketId ?? null, eventId])
      return
    }
    this.#db.prepare('UPDATE source_events SET status = ?, ticket_id = ? WHERE id = ?').run(status, ticketId ?? null, eventId)
  }

  async listSourceEvents(tenantId: string, limit = 100): Promise<Array<{ id: string; provider: string; deliveryId: string; eventType: string; receivedAt: number; status: string; ticketId: string | null }>> {
    if (this.#storage !== undefined) {
      const result = await this.#storage.query<{ id: string; provider: string; delivery_id: string; event_type: string; received_at: string | number; status: string; ticket_id: string | null }>('SELECT id, provider, delivery_id, event_type, received_at, status, ticket_id FROM source_events WHERE tenant_id = ? ORDER BY received_at DESC, id DESC LIMIT ?', [tenantId, limit])
      return result.rows.map(row => ({ id: row.id, provider: row.provider, deliveryId: row.delivery_id, eventType: row.event_type, receivedAt: Number(row.received_at), status: row.status, ticketId: row.ticket_id }))
    }
    return (this.#db.prepare('SELECT id, provider, delivery_id, event_type, received_at, status, ticket_id FROM source_events WHERE tenant_id = ? ORDER BY received_at DESC, rowid DESC LIMIT ?').all(tenantId, limit) as Array<{
      id: string; provider: string; delivery_id: string; event_type: string; received_at: number; status: string; ticket_id: string | null
    }>).map(row => ({ id: row.id, provider: row.provider, deliveryId: row.delivery_id, eventType: row.event_type, receivedAt: row.received_at, status: row.status, ticketId: row.ticket_id }))
  }

  async createSupportRequest(tenantId: string, requestedBy: string, reason: string): Promise<{ id: string; status: string; expiresAt: number | null }> {
    this.tenantRow(tenantId)
    if (reason.trim() === '') throw new ControlPlaneError(400, 'INVALID_REASON', 'reason is required')
    const id = randomUUID()
    if (this.#storage !== undefined) {
      await this.#storage.query('INSERT INTO support_requests (id, tenant_id, requested_by, reason, status, requested_at) VALUES (?, ?, ?, ?, ?, ?)', [id, tenantId, requestedBy, reason, 'pending', this.#now()])
      return { id, status: 'pending', expiresAt: null }
    }
    this.#db.prepare('INSERT INTO support_requests (id, tenant_id, requested_by, reason, status, requested_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, tenantId, requestedBy, reason, 'pending', this.#now())
    return { id, status: 'pending', expiresAt: null }
  }

  async listSupportRequests(tenantId?: string): Promise<Array<{ id: string; tenantId: string; requestedBy: string; reason: string; status: string; requestedAt: number; decidedAt: number | null; expiresAt: number | null }>> {
    if (this.#storage !== undefined) {
      const result = tenantId === undefined
        ? await this.#storage.query<{ id: string; tenant_id: string; requested_by: string; reason: string; status: string; requested_at: string | number; decided_at: string | number | null; expires_at: string | number | null }>('SELECT * FROM support_requests ORDER BY requested_at DESC, id DESC')
        : await this.#storage.query<{ id: string; tenant_id: string; requested_by: string; reason: string; status: string; requested_at: string | number; decided_at: string | number | null; expires_at: string | number | null }>('SELECT * FROM support_requests WHERE tenant_id = ? ORDER BY requested_at DESC, id DESC', [tenantId])
      return result.rows.map(row => ({
        id: row.id, tenantId: row.tenant_id, requestedBy: row.requested_by, reason: row.reason, status: row.status,
        requestedAt: Number(row.requested_at), decidedAt: row.decided_at === null ? null : Number(row.decided_at), expiresAt: row.expires_at === null ? null : Number(row.expires_at),
      }))
    }
    const rows = tenantId === undefined
      ? this.#db.prepare('SELECT * FROM support_requests ORDER BY requested_at DESC, rowid DESC').all()
      : this.#db.prepare('SELECT * FROM support_requests WHERE tenant_id = ? ORDER BY requested_at DESC, rowid DESC').all(tenantId)
    return (rows as Array<{ id: string; tenant_id: string; requested_by: string; reason: string; status: string; requested_at: number; decided_at: number | null; expires_at: number | null }>).map(row => ({
      id: row.id, tenantId: row.tenant_id, requestedBy: row.requested_by, reason: row.reason, status: row.status,
      requestedAt: row.requested_at, decidedAt: row.decided_at, expiresAt: row.expires_at,
    }))
  }

  async decideSupportRequest(tenantId: string, requestId: string, approved: boolean, decidedBy: string): Promise<{ id: string; status: string; expiresAt: number | null }> {
    this.tenantRow(tenantId)
    let row: { status: string } | undefined
    if (this.#storage !== undefined) {
      row = (await this.#storage.query<{ status: string }>('SELECT status FROM support_requests WHERE id = ? AND tenant_id = ?', [requestId, tenantId])).rows[0]
    } else {
      row = this.#db.prepare('SELECT status FROM support_requests WHERE id = ? AND tenant_id = ?').get(requestId, tenantId) as { status: string } | undefined
    }
    if (row === undefined) throw new ControlPlaneError(404, 'SUPPORT_REQUEST_NOT_FOUND', requestId)
    if (row.status !== 'pending') throw new ControlPlaneError(409, 'SUPPORT_REQUEST_SETTLED', row.status)
    const status = approved ? 'approved' : 'denied'
    const expiresAt = approved ? this.#now() + 60 * 60 * 1000 : null
    if (this.#storage !== undefined) {
      await this.#storage.query('UPDATE support_requests SET status = ?, decided_at = ?, expires_at = ? WHERE id = ?', [status, this.#now(), expiresAt, requestId])
      return { id: requestId, status, expiresAt }
    }
    this.#db.prepare('UPDATE support_requests SET status = ?, decided_at = ?, expires_at = ? WHERE id = ?').run(status, this.#now(), expiresAt, requestId)
    return { id: requestId, status, expiresAt }
  }

  async recordPlatformAudit(input: { actor: string; action: string; target: string; detail?: string }): Promise<void> {
    if (this.#storage !== undefined) {
      await this.#storage.query('INSERT INTO platform_audit (actor, action, target, detail, created_at) VALUES (?, ?, ?, ?, ?)', [input.actor, input.action, input.target, input.detail ?? null, this.#now()])
      return
    }
    this.#db.prepare('INSERT INTO platform_audit (actor, action, target, detail, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(input.actor, input.action, input.target, input.detail ?? null, this.#now())
  }

  async listPlatformAudit(limit = 100): Promise<Array<{ id: number; actor: string; action: string; target: string; detail: string | null; createdAt: number }>> {
    if (this.#storage !== undefined) {
      const result = await this.#storage.query<{ id: string | number; actor: string; action: string; target: string; detail: string | null; created_at: string | number }>('SELECT id, actor, action, target, detail, created_at FROM platform_audit ORDER BY created_at DESC, id DESC LIMIT ?', [limit])
      return result.rows.map(row => ({ id: Number(row.id), actor: row.actor, action: row.action, target: row.target, detail: row.detail, createdAt: Number(row.created_at) }))
    }
    return (this.#db.prepare('SELECT * FROM platform_audit ORDER BY created_at DESC, rowid DESC LIMIT ?').all(limit) as Array<{
      id: number; actor: string; action: string; target: string; detail: string | null; created_at: number
    }>).map(row => ({ id: row.id, actor: row.actor, action: row.action, target: row.target, detail: row.detail, createdAt: row.created_at }))
  }

  async listModelCatalog(): Promise<Array<{ id: string; name: string; provider: string; model: string; enabled: boolean }>> {
    if (this.#storage !== undefined) {
      const result = await this.#storage.query<{ id: string; name: string; provider: string; model: string; enabled: number | string }>('SELECT * FROM model_catalog ORDER BY created_at, id')
      return result.rows.map(row => ({ id: row.id, name: row.name, provider: row.provider, model: row.model, enabled: Number(row.enabled) === 1 }))
    }
    return (this.#db.prepare('SELECT * FROM model_catalog ORDER BY created_at, rowid').all() as Array<{
      id: string; name: string; provider: string; model: string; enabled: number
    }>).map(row => ({ id: row.id, name: row.name, provider: row.provider, model: row.model, enabled: row.enabled === 1 }))
  }

  async addModel(input: { id?: string; name: string; provider: string; model: string }): Promise<{ id: string }> {
    const id = input.id === undefined || input.id === '' ? randomUUID() : input.id
    if (this.#storage !== undefined) await this.#storage.query('INSERT INTO model_catalog (id, name, provider, model, enabled, created_at) VALUES (?, ?, ?, ?, 1, ?)', [id, input.name, input.provider, input.model, this.#now()])
    this.#db.prepare('INSERT INTO model_catalog (id, name, provider, model, enabled, created_at) VALUES (?, ?, ?, ?, 1, ?)').run(id, input.name, input.provider, input.model, this.#now())
    return { id }
  }

  async listTenantModels(tenantId: string): Promise<Array<{ id: string; name: string; provider: string; model: string; isDefault: boolean }>> {
    this.tenantRow(tenantId)
    if (this.#storage !== undefined) {
      const result = await this.#storage.query<{ id: string; name: string; provider: string; model: string; is_default: number | string }>('SELECT c.*, tm.is_default FROM tenant_models tm JOIN model_catalog c ON c.id = tm.model_id WHERE tm.tenant_id = ? AND c.enabled = 1 ORDER BY tm.is_default DESC, c.created_at', [tenantId])
      return result.rows.map(row => ({ id: row.id, name: row.name, provider: row.provider, model: row.model, isDefault: Number(row.is_default) === 1 }))
    }
    return (this.#db.prepare('SELECT c.*, tm.is_default FROM tenant_models tm JOIN model_catalog c ON c.id = tm.model_id WHERE tm.tenant_id = ? AND c.enabled = 1 ORDER BY tm.is_default DESC, c.created_at').all(tenantId) as Array<{
      id: string; name: string; provider: string; model: string; is_default: number
    }>).map(row => ({ id: row.id, name: row.name, provider: row.provider, model: row.model, isDefault: row.is_default === 1 }))
  }

  async bindTenantModel(tenantId: string, modelId: string, isDefault = false): Promise<void> {
    this.tenantRow(tenantId)
    const model = this.#db.prepare('SELECT id FROM model_catalog WHERE id = ? AND enabled = 1').get(modelId) as { id: string } | undefined
    if (model === undefined) throw new ControlPlaneError(404, 'MODEL_NOT_FOUND', modelId)
    if (this.#storage !== undefined) {
      if (isDefault) await this.#storage.query('UPDATE tenant_models SET is_default = 0 WHERE tenant_id = ?', [tenantId])
      await this.#storage.query('INSERT INTO tenant_models (tenant_id, model_id, is_default) VALUES (?, ?, ?) ON CONFLICT (tenant_id, model_id) DO UPDATE SET is_default = EXCLUDED.is_default', [tenantId, modelId, isDefault ? 1 : 0])
    }
    if (isDefault) this.#db.prepare('UPDATE tenant_models SET is_default = 0 WHERE tenant_id = ?').run(tenantId)
    this.#db.prepare('INSERT OR REPLACE INTO tenant_models (tenant_id, model_id, is_default) VALUES (?, ?, ?)').run(tenantId, modelId, isDefault ? 1 : 0)
    await this.rebuildModelRouterConfig()
  }

  async upsertTenantModelUpstream(tenantId: string, modelId: string, input: {
    id?: string
    name: string
    protocol: 'chat' | 'responses' | 'claude'
    baseUrl: string
    upstreamModel: string
    apiKey?: string | null
    priority?: number
    enabled?: boolean
  }): Promise<{ id: string }> {
    this.tenantRow(tenantId)
    const bound = this.#storage !== undefined
      ? (await this.#storage.query('SELECT 1 FROM tenant_models WHERE tenant_id = ? AND model_id = ?', [tenantId, modelId])).rows.length > 0
      : this.#db.prepare('SELECT 1 FROM tenant_models WHERE tenant_id = ? AND model_id = ?').get(tenantId, modelId) !== undefined
    if (!bound) throw new ControlPlaneError(404, 'MODEL_NOT_BOUND', modelId)
    let parsed: URL
    try { parsed = new URL(input.baseUrl) } catch { throw new ControlPlaneError(400, 'INVALID_UPSTREAM_URL', 'baseUrl must be an absolute URL') }
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username !== '' || parsed.password !== '') throw new ControlPlaneError(400, 'INVALID_UPSTREAM_URL', 'baseUrl must be http(s) without credentials')
    if (input.name.trim() === '' || input.upstreamModel.trim() === '') throw new ControlPlaneError(400, 'INVALID_UPSTREAM', 'name and upstreamModel are required')
    const id = input.id === undefined || input.id === '' ? randomUUID() : input.id
    const existingCipher = this.#storage !== undefined
      ? (await this.#storage.query<{ api_key_cipher: string | null }>('SELECT api_key_cipher FROM tenant_model_upstreams WHERE tenant_id = ? AND model_id = ? AND id = ?', [tenantId, modelId, id])).rows[0]?.api_key_cipher
      : (this.#db.prepare('SELECT api_key_cipher FROM tenant_model_upstreams WHERE tenant_id = ? AND model_id = ? AND id = ?').get(tenantId, modelId, id) as { api_key_cipher: string | null } | undefined)?.api_key_cipher
    const cipher = input.apiKey === undefined ? (existingCipher ?? null) : input.apiKey === null || input.apiKey === '' ? null : this.encryptSecret(input.apiKey)
    const priority = input.priority ?? 0
    const enabled = input.enabled === false ? 0 : 1
    const values = [tenantId, modelId, id, input.name.trim(), input.protocol, parsed.href, input.upstreamModel.trim(), cipher, priority, enabled, this.#now()]
    if (this.#storage !== undefined) {
      await this.#storage.query('INSERT INTO tenant_model_upstreams (tenant_id, model_id, id, name, protocol, base_url, upstream_model, api_key_cipher, priority, enabled, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (tenant_id, model_id, id) DO UPDATE SET name = EXCLUDED.name, protocol = EXCLUDED.protocol, base_url = EXCLUDED.base_url, upstream_model = EXCLUDED.upstream_model, api_key_cipher = EXCLUDED.api_key_cipher, priority = EXCLUDED.priority, enabled = EXCLUDED.enabled, updated_at = EXCLUDED.updated_at', values)
    }
    this.#db.prepare('INSERT INTO tenant_model_upstreams (tenant_id, model_id, id, name, protocol, base_url, upstream_model, api_key_cipher, priority, enabled, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (tenant_id, model_id, id) DO UPDATE SET name = excluded.name, protocol = excluded.protocol, base_url = excluded.base_url, upstream_model = excluded.upstream_model, api_key_cipher = excluded.api_key_cipher, priority = excluded.priority, enabled = excluded.enabled, updated_at = excluded.updated_at').run(...values as never[])
    await this.rebuildModelRouterConfig()
    return { id }
  }

  async listTenantModelUpstreams(tenantId: string, modelId?: string): Promise<Array<{ id: string; tenantId: string; modelId: string; name: string; protocol: string; baseUrl: string; upstreamModel: string; priority: number; enabled: boolean; hasApiKey: boolean; apiKeyMasked: string | null }>> {
    this.tenantRow(tenantId)
    const rows = this.#storage !== undefined
      ? (await this.#storage.query<Record<string, unknown>>(modelId === undefined ? 'SELECT * FROM tenant_model_upstreams WHERE tenant_id = ? ORDER BY model_id, priority, name' : 'SELECT * FROM tenant_model_upstreams WHERE tenant_id = ? AND model_id = ? ORDER BY priority, name', modelId === undefined ? [tenantId] : [tenantId, modelId])).rows
      : (modelId === undefined
        ? this.#db.prepare('SELECT * FROM tenant_model_upstreams WHERE tenant_id = ? ORDER BY model_id, priority, name').all(tenantId)
        : this.#db.prepare('SELECT * FROM tenant_model_upstreams WHERE tenant_id = ? AND model_id = ? ORDER BY priority, name').all(tenantId, modelId)) as Array<Record<string, unknown>>
    return rows.map(row => ({
      id: String(row.id), tenantId: String(row.tenant_id), modelId: String(row.model_id), name: String(row.name), protocol: String(row.protocol),
      baseUrl: String(row.base_url), upstreamModel: String(row.upstream_model), priority: Number(row.priority), enabled: Number(row.enabled) === 1,
      hasApiKey: row.api_key_cipher !== null && row.api_key_cipher !== undefined, apiKeyMasked: row.api_key_cipher === null || row.api_key_cipher === undefined ? null : '••••••••',
    }))
  }

  async deleteTenantModelUpstream(tenantId: string, modelId: string, id: string): Promise<void> {
    this.tenantRow(tenantId)
    if (this.#storage !== undefined) await this.#storage.query('DELETE FROM tenant_model_upstreams WHERE tenant_id = ? AND model_id = ? AND id = ?', [tenantId, modelId, id])
    this.#db.prepare('DELETE FROM tenant_model_upstreams WHERE tenant_id = ? AND model_id = ? AND id = ?').run(tenantId, modelId, id)
    await this.rebuildModelRouterConfig()
  }

  async tenantModelUpstream(tenantId: string, modelId: string): Promise<{ url: string; key: string | undefined; upstreamModel: string; protocol: string } | undefined> {
    const rows = await this.listTenantModelUpstreams(tenantId, modelId)
    const selected = rows.find(row => row.enabled)
    if (selected === undefined) return undefined
    const cipher = this.#storage !== undefined
      ? (await this.#storage.query<{ api_key_cipher: string | null }>('SELECT api_key_cipher FROM tenant_model_upstreams WHERE tenant_id = ? AND model_id = ? AND id = ?', [tenantId, modelId, selected.id])).rows[0]?.api_key_cipher
      : (this.#db.prepare('SELECT api_key_cipher FROM tenant_model_upstreams WHERE tenant_id = ? AND model_id = ? AND id = ?').get(tenantId, modelId, selected.id) as { api_key_cipher: string | null } | undefined)?.api_key_cipher
    return { url: selected.baseUrl, key: cipher === null || cipher === undefined ? undefined : this.decryptSecret(cipher), upstreamModel: selected.upstreamModel, protocol: selected.protocol }
  }

  private encryptSecret(value: string): string {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.#secretsKey, iv)
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
    return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${encrypted.toString('base64')}`
  }

  private decryptSecret(value: string): string {
    const parts = value.split(':')
    if (parts.length !== 4 || parts[0] !== 'v1') throw new ControlPlaneError(500, 'SECRET_INVALID', 'invalid encrypted secret')
    const decipher = createDecipheriv('aes-256-gcm', this.#secretsKey, Buffer.from(parts[1]!, 'base64'))
    decipher.setAuthTag(Buffer.from(parts[2]!, 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(parts[3]!, 'base64')), decipher.final()]).toString('utf8')
  }

  private async rebuildModelRouterConfig(): Promise<void> {
    const path = this.#modelRouterConfigPath
    if (path === undefined) return
    const rows = this.#storage !== undefined
      ? (await this.#storage.query<Record<string, unknown>>('SELECT * FROM tenant_model_upstreams')).rows
      : this.#db.prepare('SELECT * FROM tenant_model_upstreams').all() as Array<Record<string, unknown>>
    const sections: Record<'chat' | 'responses' | 'claude', Array<Record<string, unknown>>> = { chat: [], responses: [], claude: [] }
    for (const row of rows) {
      if (Number(row.enabled) !== 1) continue
      const protocol = row.protocol === 'responses' || row.protocol === 'claude' ? row.protocol : 'chat'
      const cipher = row.api_key_cipher
      const apiKey = cipher === null || cipher === undefined ? undefined : (() => { try { return this.decryptSecret(String(cipher)) } catch { return undefined } })()
      const name = String(row.name).replace(/[^a-zA-Z0-9_.-]/gu, '-')
      sections[protocol].push({
        name: `siriusx-${String(row.tenant_id)}-${String(row.model_id)}-${String(row.id)}-${name}`,
        'base-url': String(row.base_url),
        ...(apiKey === undefined ? {} : { 'api-key': apiKey }),
        priority: Number(row.priority),
        'failover-mode': 'provider',
        models: [{ name: String(row.upstream_model), alias: `${String(row.tenant_id)}/${String(row.model_id)}` }],
      })
    }
    const config = {
      host: '0.0.0.0', port: 8317, 'api-keys': [this.#modelRouterKey], 'request-retry': 2,
      ...(sections.chat.length === 0 ? {} : { 'openai-completions': sections.chat }),
      ...(sections.responses.length === 0 ? {} : { 'openai-responses': sections.responses }),
      ...(sections.claude.length === 0 ? {} : { 'anthropic-messages': sections.claude }),
    }
    mkdirSync(dirname(path), { recursive: true })
    const temp = `${path}.${process.pid}.tmp`
    writeFileSync(temp, JSON.stringify(config, undefined, 2), { mode: 0o600 })
    renameSync(temp, path)
  }

  getQuota(tenantId: string): { maxUsers: number; maxDevices: number; maxCloudTicketsPerDay: number; maxDeviceTicketsPerDay: number } {
    this.tenantRow(tenantId)
    if (this.#storage !== undefined && this.#cacheReady) return this.#quotaCache.get(tenantId) ?? { maxUsers: 50, maxDevices: 20, maxCloudTicketsPerDay: 100, maxDeviceTicketsPerDay: 500 }
    const row = this.#db.prepare('SELECT * FROM tenant_quotas WHERE tenant_id = ?').get(tenantId) as {
      max_users: number; max_devices: number; max_cloud_tickets_per_day: number; max_device_tickets_per_day: number
    } | undefined
    return row === undefined
      ? { maxUsers: 50, maxDevices: 20, maxCloudTicketsPerDay: 100, maxDeviceTicketsPerDay: 500 }
      : { maxUsers: row.max_users, maxDevices: row.max_devices, maxCloudTicketsPerDay: row.max_cloud_tickets_per_day, maxDeviceTicketsPerDay: row.max_device_tickets_per_day }
  }

  async setQuota(tenantId: string, patch: Partial<{ maxUsers: number; maxDevices: number; maxCloudTicketsPerDay: number; maxDeviceTicketsPerDay: number }>): Promise<{ maxUsers: number; maxDevices: number; maxCloudTicketsPerDay: number; maxDeviceTicketsPerDay: number }> {
    this.tenantRow(tenantId)
    const current = this.getQuota(tenantId)
    const next = { ...current, ...patch }
    for (const value of Object.values(next)) if (!Number.isSafeInteger(value) || value < 0) throw new ControlPlaneError(400, 'INVALID_QUOTA', 'quota values must be non-negative integers')
    if (this.#storage !== undefined) {
      await this.#storage.query('INSERT INTO tenant_quotas (tenant_id, max_users, max_devices, max_cloud_tickets_per_day, max_device_tickets_per_day, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (tenant_id) DO UPDATE SET max_users = EXCLUDED.max_users, max_devices = EXCLUDED.max_devices, max_cloud_tickets_per_day = EXCLUDED.max_cloud_tickets_per_day, max_device_tickets_per_day = EXCLUDED.max_device_tickets_per_day, updated_at = EXCLUDED.updated_at', [tenantId, next.maxUsers, next.maxDevices, next.maxCloudTicketsPerDay, next.maxDeviceTicketsPerDay, this.#now()])
      this.#quotaCache.set(tenantId, next)
      await this.#notifyCacheChange()
      return next
    }
    this.#db.prepare('INSERT OR REPLACE INTO tenant_quotas (tenant_id, max_users, max_devices, max_cloud_tickets_per_day, max_device_tickets_per_day, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(tenantId, next.maxUsers, next.maxDevices, next.maxCloudTicketsPerDay, next.maxDeviceTicketsPerDay, this.#now())
    return next
  }

  private enforceQuota(tenantId: string, kind: 'users' | 'devices' | 'cloudTickets' | 'deviceTickets'): void {
    const quota = this.getQuota(tenantId)
    const limit = kind === 'users' ? quota.maxUsers : kind === 'devices' ? quota.maxDevices : kind === 'cloudTickets' ? quota.maxCloudTicketsPerDay : quota.maxDeviceTicketsPerDay
    let used: number
    if (kind === 'users' || kind === 'devices') {
      const table = kind === 'users' ? 'users' : 'devices'
      used = (this.#db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE tenant_id = ?`).get(tenantId) as { count: number }).count
    } else {
      const table = kind === 'cloudTickets' ? 'cloud_tickets' : 'device_tickets'
      const start = this.#now() - (this.#now() % (24 * 60 * 60 * 1000))
      used = (this.#db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE tenant_id = ? AND created_at >= ?`).get(tenantId, start) as { count: number }).count
    }
    if (used >= limit) throw new ControlPlaneError(429, 'QUOTA_EXCEEDED', `${kind} quota exceeded (${used}/${limit})`)
  }

  usageDaily(tenantId: string, days = 30): Array<{ date: string; cloudTickets: number; deviceTickets: number }> {
    this.tenantRow(tenantId)
    const requested = Math.min(365, Math.max(1, Math.floor(days)))
    const now = this.#now()
    const today = now - (now % (24 * 60 * 60 * 1000))
    const start = today - (requested - 1) * 24 * 60 * 60 * 1000
    const group = (table: string): Map<string, number> => new Map((this.#db.prepare(`SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') AS day, COUNT(*) AS count FROM ${table} WHERE tenant_id = ? AND created_at >= ? GROUP BY day`).all(tenantId, start) as Array<{ day: string; count: number }>).map(row => [row.day, row.count]))
    const cloud = group('cloud_tickets')
    const device = group('device_tickets')
    const result = []
    for (let offset = requested - 1; offset >= 0; offset--) {
      const date = new Date(today - offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      result.push({ date, cloudTickets: cloud.get(date) ?? 0, deviceTickets: device.get(date) ?? 0 })
    }
    return result
  }

  tenantUsage(tenantId: string): { users: number; devices: number; deviceTickets: number; cloudTickets: number; cloudTicketsToday: number; deviceTicketsToday: number; quota: ReturnType<ControlPlane['getQuota']> } {
    this.tenantRow(tenantId)
    const count = (table: string): number => (this.#db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE tenant_id = ?`).get(tenantId) as { count: number }).count
    const start = this.#now() - (this.#now() % (24 * 60 * 60 * 1000))
    const today = (table: string): number => (this.#db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE tenant_id = ? AND created_at >= ?`).get(tenantId, start) as { count: number }).count
    return { users: count('users'), devices: count('devices'), deviceTickets: count('device_tickets'), cloudTickets: count('cloud_tickets'), cloudTicketsToday: today('cloud_tickets'), deviceTicketsToday: today('device_tickets'), quota: this.getQuota(tenantId) }
  }

  listUsers(tenantId: string): Array<{ userId: string; email: string; role: Role; createdAt: number }> {
    this.tenantRow(tenantId)
    if (this.#storage !== undefined && this.#cacheReady) return [...this.#userCache.values()].filter(user => user.tenantId === tenantId).sort((left, right) => left.createdAt - right.createdAt).map(user => ({ userId: user.id, email: user.email, role: user.role, createdAt: user.createdAt }))
    return (this.#db.prepare('SELECT id, email, role, created_at FROM users WHERE tenant_id = ? ORDER BY created_at, rowid').all(tenantId) as Array<{
      id: string; email: string; role: Role; created_at: number
    }>).map(row => ({ userId: row.id, email: row.email, role: row.role, createdAt: row.created_at }))
  }

  async updateUserRole(tenantId: string, userId: string, role: Role): Promise<void> {
    this.tenantRow(tenantId)
    if (this.#storage !== undefined && this.#cacheReady) {
      const user = this.#userCache.get(userId)
      if (user === undefined || user.tenantId !== tenantId) throw new ControlPlaneError(404, 'USER_NOT_FOUND', userId)
      await this.#storage.query('UPDATE users SET role = ? WHERE id = ? AND tenant_id = ?', [role, userId, tenantId])
      user.role = role
      await this.#notifyCacheChange()
      return
    }
    const result = this.#db.prepare('UPDATE users SET role = ? WHERE id = ? AND tenant_id = ?').run(role, userId, tenantId)
    if (result.changes === 0) throw new ControlPlaneError(404, 'USER_NOT_FOUND', userId)
  }

  findTenantByIssuer(issuer: string): Tenant | undefined {
    if (this.#storage !== undefined && this.#cacheReady) return [...this.#tenantCache.values()].find(tenant => tenant.idpIssuer === issuer)
    const row = this.#db.prepare('SELECT * FROM tenants WHERE idp_issuer = ?').get(issuer) as
      | { id: string; name: string; idp_issuer: string; created_at: number; status: 'active' | 'suspended' } | undefined
    return row === undefined ? undefined : { id: row.id, name: row.name, idpIssuer: row.idp_issuer, createdAt: row.created_at, status: row.status }
  }

  findUserByEmail(tenantId: string, email: string): { id: string; role: Role } | undefined {
    if (this.#storage !== undefined && this.#cacheReady) {
      const user = [...this.#userCache.values()].find(item => item.tenantId === tenantId && item.email === email)
      return user === undefined ? undefined : { id: user.id, role: user.role }
    }
    const row = this.#db.prepare('SELECT id, role FROM users WHERE tenant_id = ? AND email = ?').get(tenantId, email) as { id: string; role: Role } | undefined
    return row
  }

  async addUser(input: { tenantId: string; email: string; role?: Role }): Promise<{ userId: string }> {
    this.tenantRow(input.tenantId)
    this.enforceQuota(input.tenantId, 'users')
    const userId = randomUUID()
    if (this.#storage !== undefined) {
      await this.#storage.query('INSERT INTO users (id, tenant_id, email, role, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (tenant_id, email) DO NOTHING', [userId, input.tenantId, input.email, input.role ?? 'member', this.#now()])
    }
    this.#db.prepare('INSERT INTO users (id, tenant_id, email, role, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(userId, input.tenantId, input.email, input.role ?? 'member', this.#now())
    if (this.#storage !== undefined) { this.#userCache.set(userId, { id: userId, tenantId: input.tenantId, email: input.email, role: input.role ?? 'member', createdAt: this.#now() }); await this.#notifyCacheChange() }
    return { userId }
  }

  /** Trusted service-to-service SSO identity exchange; never exposed to browsers. */
  /** Verify a desktop OIDC ID token and mint a tenant control-plane session. */
  async ssoDesktopSession(idToken: string): Promise<{ token: string; userId: string; tenantId: string; role: Role; model: { id: string; provider: string; model: string } | null; modelGatewayUrl?: string }> {
    const config = this.#desktopSso
    if (config === undefined) throw new ControlPlaneError(503, 'SSO_NOT_CONFIGURED', 'desktop SSO is not configured')
    let payload: Record<string, unknown>
    try {
      if (config.hs256Secret !== undefined && config.hs256Secret !== '') {
        const result = await jwtVerify(idToken, new TextEncoder().encode(config.hs256Secret), { issuer: config.issuer, audience: config.clientId })
        payload = result.payload as Record<string, unknown>
      } else if (config.jwksUri !== undefined && config.jwksUri !== '') {
        const result = await jwtVerify(idToken, createRemoteJWKSet(new URL(config.jwksUri)), { issuer: config.issuer, audience: config.clientId })
        payload = result.payload as Record<string, unknown>
      } else {
        throw new Error('desktop SSO has neither JWKS URI nor HS256 test secret')
      }
    } catch (error) {
      throw new ControlPlaneError(401, 'SSO_TOKEN_INVALID', error instanceof Error ? error.message : 'invalid id_token')
    }
    const claim = config.tenantClaim ?? 'tenant_id'
    const tenantId = typeof payload[claim] === 'string' ? payload[claim] as string : typeof payload.tenant_id === 'string' ? payload.tenant_id : typeof payload.org_id === 'string' ? payload.org_id : undefined
    if (tenantId === undefined || tenantId === '') throw new ControlPlaneError(401, 'SSO_TENANT_MISSING', `id_token has no ${claim} claim`)
    const email = typeof payload.email === 'string' ? payload.email : typeof payload.preferred_username === 'string' ? payload.preferred_username : undefined
    if (email === undefined || email === '') throw new ControlPlaneError(401, 'SSO_EMAIL_MISSING', 'id_token has no email claim')
    const roles = Array.isArray(payload.roles) ? payload.roles.filter((role): role is string => typeof role === 'string') : []
    const adminRole = config.adminRole ?? 'admin'
    const role: Role = roles.includes(adminRole) ? 'admin' : 'member'
    const session = await this.ssoSession({ tenantId, email, role })
    const models = await this.listTenantModels(tenantId)
    const selected = models.find(model => model.isDefault) ?? models[0]
    return {
      ...session,
      role,
      model: selected === undefined ? null : { id: selected.id, provider: selected.provider, model: selected.model },
      ...(config.modelGatewayUrl === undefined ? {} : { modelGatewayUrl: config.modelGatewayUrl }),
    }
  }

  async ssoSession(input: { tenantId: string; email: string; role: Role }): Promise<{ token: string; userId: string; tenantId: string }> {
    const tenant = this.#db.prepare('SELECT id FROM tenants WHERE id = ?').get(input.tenantId) as { id: string } | undefined
    if (tenant === undefined) throw new ControlPlaneError(404, 'TENANT_NOT_FOUND', input.tenantId)
    const existing = this.findUserByEmail(input.tenantId, input.email)
    const user = existing ?? await this.addUser({ tenantId: input.tenantId, email: input.email, role: input.role })
    const role = existing?.role ?? input.role
    const userId = existing?.id ?? (user as { userId: string }).userId
    return { token: this.issueSession({ tenantId: input.tenantId, userId, role }), userId, tenantId: input.tenantId }
  }

  issueSession(input: { tenantId: string; userId: string; role: Role }): string {
    if (this.tenantRow(input.tenantId).status === 'suspended') throw new ControlPlaneError(403, 'TENANT_SUSPENDED', 'tenant is suspended')
    let user: { id: string; role: string } | undefined
    if (this.#storage !== undefined && this.#cacheReady) {
      const cached = this.#userCache.get(input.userId)
      user = cached === undefined || cached.tenantId !== input.tenantId ? undefined : { id: cached.id, role: cached.role }
    } else {
      user = this.#db.prepare('SELECT id, role FROM users WHERE id = ? AND tenant_id = ?').get(input.userId, input.tenantId) as
        | { id: string; role: string } | undefined
    }
    if (user === undefined) throw new ControlPlaneError(401, 'USER_NOT_FOUND', 'user is not a member of this tenant')
    const payload = Buffer.from(JSON.stringify({ tenantId: input.tenantId, userId: input.userId, role: input.role, jti: randomUUID(), exp: this.#now() + this.#sessionTtlMs })).toString('base64url')
    const signature = createHmac('sha256', this.#secret).update(payload).digest('base64url')
    return `${payload}.${signature}`
  }

  revokeSession(token: string): { revoked: true } {
    const [payload, signature] = token.split('.')
    if (payload === undefined || signature === undefined) throw new ControlPlaneError(401, 'UNAUTHORIZED', 'invalid session token')
    const expected = createHmac('sha256', this.#secret).update(payload).digest('base64url')
    if (!safeEqual(signature, expected)) throw new ControlPlaneError(401, 'UNAUTHORIZED', 'invalid session token')
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: number; jti?: string }
    if (typeof value.exp !== 'number' || typeof value.jti !== 'string') throw new ControlPlaneError(401, 'SESSION_NOT_REVOCABLE', 'session has no revocable id')
    this.#db.prepare('INSERT OR REPLACE INTO revoked_sessions (session_id, expires_at) VALUES (?, ?)').run(value.jti, value.exp)
    return { revoked: true }
  }

  verifySession(token: string): Session {
    const [payload, signature] = token.split('.')
    if (payload === undefined || signature === undefined) throw new ControlPlaneError(401, 'UNAUTHORIZED', 'invalid session token')
    const expected = createHmac('sha256', this.#secret).update(payload).digest('base64url')
    if (!safeEqual(signature, expected)) throw new ControlPlaneError(401, 'UNAUTHORIZED', 'invalid session token')
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<Session> & { exp?: number; jti?: string }
    if (typeof value.tenantId !== 'string' || typeof value.userId !== 'string' || (value.role !== 'admin' && value.role !== 'member') || typeof value.exp !== 'number') {
      throw new ControlPlaneError(401, 'UNAUTHORIZED', 'invalid session claims')
    }
    if (value.exp <= this.#now()) throw new ControlPlaneError(401, 'SESSION_EXPIRED', 'session expired')
    if (typeof value.jti === 'string' && this.#db.prepare('SELECT 1 FROM revoked_sessions WHERE session_id = ? AND expires_at > ?').get(value.jti, this.#now()) !== undefined) {
      throw new ControlPlaneError(401, 'SESSION_REVOKED', 'session revoked')
    }
    if (this.tenantRow(value.tenantId).status === 'suspended') throw new ControlPlaneError(403, 'TENANT_SUSPENDED', 'tenant is suspended')
    let user: { role: Role } | undefined
    if (this.#storage !== undefined && this.#cacheReady) {
      const cached = this.#userCache.get(value.userId)
      user = cached === undefined || cached.tenantId !== value.tenantId ? undefined : { role: cached.role }
    } else {
      user = this.#db.prepare('SELECT role FROM users WHERE id = ? AND tenant_id = ?').get(value.userId, value.tenantId) as { role: Role } | undefined
    }
    if (user === undefined) throw new ControlPlaneError(401, 'UNAUTHORIZED', 'user no longer exists')
    return { tenantId: value.tenantId, userId: value.userId, role: user.role }
  }

  getSettings(tenantId: string): { nativeConversationEnabled: boolean; byokEnabled: boolean; localExecutionEnabled: boolean } {
    this.tenantRow(tenantId)
    if (this.#storage !== undefined && this.#cacheReady) return this.#settingsCache.get(tenantId) ?? { nativeConversationEnabled: true, byokEnabled: true, localExecutionEnabled: true }
    const row = this.#db.prepare('SELECT * FROM settings WHERE tenant_id = ?').get(tenantId) as {
      native_conversation_enabled: number; byok_enabled: number; local_execution_enabled: number
    } | undefined
    return row === undefined
      ? { nativeConversationEnabled: true, byokEnabled: true, localExecutionEnabled: true }
      : {
          nativeConversationEnabled: row.native_conversation_enabled === 1,
          byokEnabled: row.byok_enabled === 1,
          localExecutionEnabled: row.local_execution_enabled === 1,
        }
  }

  async updateSettings(session: Session, patch: Partial<{ nativeConversationEnabled: boolean; byokEnabled: boolean; localExecutionEnabled: boolean }>): Promise<void> {
    if (session.role !== 'admin') throw new ControlPlaneError(403, 'ADMIN_REQUIRED', 'admin role required')
    const current = this.getSettings(session.tenantId)
    const next = {
      nativeConversationEnabled: patch.nativeConversationEnabled ?? current.nativeConversationEnabled,
      byokEnabled: patch.byokEnabled ?? current.byokEnabled,
      localExecutionEnabled: patch.localExecutionEnabled ?? current.localExecutionEnabled,
    }
    if (this.#storage !== undefined) {
      await this.#storage.query('INSERT INTO settings (tenant_id, native_conversation_enabled, byok_enabled, local_execution_enabled) VALUES (?, ?, ?, ?) ON CONFLICT (tenant_id) DO UPDATE SET native_conversation_enabled = EXCLUDED.native_conversation_enabled, byok_enabled = EXCLUDED.byok_enabled, local_execution_enabled = EXCLUDED.local_execution_enabled', [session.tenantId, next.nativeConversationEnabled ? 1 : 0, next.byokEnabled ? 1 : 0, next.localExecutionEnabled ? 1 : 0])
      this.#settingsCache.set(session.tenantId, next)
      await this.#notifyCacheChange()
      return
    }
    this.#db.prepare('UPDATE settings SET native_conversation_enabled = ?, byok_enabled = ?, local_execution_enabled = ? WHERE tenant_id = ?')
      .run(next.nativeConversationEnabled ? 1 : 0, next.byokEnabled ? 1 : 0, next.localExecutionEnabled ? 1 : 0, session.tenantId)
  }

  startPairing(session: Session, deviceName: string): { code: string; expiresAt: number } {
    if (!this.getSettings(session.tenantId).localExecutionEnabled) {
      throw new ControlPlaneError(403, 'LOCAL_EXECUTION_DISABLED', 'local execution is disabled')
    }
    this.enforceQuota(session.tenantId, 'devices')
    const deviceId = randomUUID()
    const code = randomBytes(4).toString('hex').toUpperCase()
    const expiresAt = this.#now() + 10 * 60 * 1000
    this.#db.prepare('INSERT INTO devices (id, tenant_id, user_id, name, token_hash, revoked, last_seen_at) VALUES (?, ?, ?, ?, NULL, 0, NULL)')
      .run(deviceId, session.tenantId, session.userId, deviceName)
    this.#db.prepare('INSERT INTO pairing_codes (code, tenant_id, user_id, device_id, device_name, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(code, session.tenantId, session.userId, deviceId, deviceName, expiresAt)
    return { code, expiresAt }
  }

  confirmPairing(session: Session, code: string): { deviceId: string; token: string } {
    const key = `${session.tenantId}/${session.userId}`
    const now = this.#now()
    const failures = this.#pairingFailures.get(key)
    if (failures !== undefined && failures.resetAt > now && failures.count >= 5) {
      throw new ControlPlaneError(429, 'PAIRING_RATE_LIMITED', 'too many pairing attempts; retry later')
    }
    let row: { device_id: string; expires_at: number; consumed_at: number | null } | undefined
    try {
      row = this.#db.prepare('SELECT * FROM pairing_codes WHERE code = ? AND tenant_id = ? AND user_id = ?').get(code, session.tenantId, session.userId) as
        | { device_id: string; expires_at: number; consumed_at: number | null } | undefined
      if (row === undefined) throw new ControlPlaneError(404, 'PAIRING_NOT_FOUND', code)
      if (row.consumed_at !== null) throw new ControlPlaneError(409, 'PAIRING_USED', code)
      if (row.expires_at < now) throw new ControlPlaneError(410, 'PAIRING_EXPIRED', code)
    } catch (error) {
      this.#pairingFailures.set(key, { count: (failures?.resetAt === undefined || failures.resetAt <= now ? 0 : failures.count) + 1, resetAt: now + 5 * 60 * 1000 })
      throw error
    }
    this.#pairingFailures.delete(key)
    const token = randomBytes(32).toString('base64url')
    this.#db.prepare('UPDATE pairing_codes SET consumed_at = ? WHERE code = ?').run(now, code)
    this.#db.prepare('UPDATE devices SET token_hash = ?, token_expires_at = ?, last_seen_at = ? WHERE id = ?').run(tokenHash(token), now + 30 * 24 * 60 * 60 * 1000, now, row.device_id)
    return { deviceId: row.device_id, token }
  }

  listDevices(session: Session): Device[] {
    const rows = this.#db.prepare('SELECT * FROM devices WHERE tenant_id = ? ORDER BY rowid').all(session.tenantId) as Array<{
      id: string; tenant_id: string; user_id: string; name: string; revoked: number; last_seen_at: number | null; token_expires_at: number | null
    }>
    return rows.map(row => ({
      id: row.id, tenantId: row.tenant_id, userId: row.user_id, name: row.name,
      revoked: row.revoked === 1, lastSeenAt: row.last_seen_at, tokenExpiresAt: row.token_expires_at,
    }))
  }

  rotateDeviceToken(session: Session, deviceId: string): { token: string; expiresAt: number } {
    const row = this.#db.prepare('SELECT user_id FROM devices WHERE id = ? AND tenant_id = ? AND revoked = 0').get(deviceId, session.tenantId) as { user_id: string } | undefined
    if (row === undefined) throw new ControlPlaneError(404, 'DEVICE_NOT_FOUND', deviceId)
    if (session.role !== 'admin' && row.user_id !== session.userId) throw new ControlPlaneError(403, 'DEVICE_NOT_OWNED', deviceId)
    const token = randomBytes(32).toString('base64url')
    const expiresAt = this.#now() + 30 * 24 * 60 * 60 * 1000
    this.#db.prepare('UPDATE devices SET token_hash = ?, token_expires_at = ?, last_seen_at = ? WHERE id = ? AND tenant_id = ?').run(tokenHash(token), expiresAt, this.#now(), deviceId, session.tenantId)
    return { token, expiresAt }
  }

  revokeDevice(session: Session, deviceId: string): void {
    if (session.role !== 'admin') throw new ControlPlaneError(403, 'ADMIN_REQUIRED', 'admin role required')
    const result = this.#db.prepare('UPDATE devices SET revoked = 1 WHERE id = ? AND tenant_id = ?').run(deviceId, session.tenantId)
    if (result.changes === 0) throw new ControlPlaneError(404, 'DEVICE_NOT_FOUND', deviceId)
  }

  verifyDeviceToken(token: string): { tenantId: string; userId: string; deviceId: string } {
    const row = this.#db.prepare('SELECT id, tenant_id, user_id, token_expires_at FROM devices WHERE token_hash = ? AND revoked = 0').get(tokenHash(token)) as
      | { id: string; tenant_id: string; user_id: string; token_expires_at: number | null } | undefined
    if (row === undefined) throw new ControlPlaneError(401, 'DEVICE_UNAUTHORIZED', 'device token is invalid or revoked')
    if (row.token_expires_at !== null && row.token_expires_at < this.#now()) throw new ControlPlaneError(401, 'DEVICE_UNAUTHORIZED', 'device token expired')
    this.#db.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').run(this.#now(), row.id)
    return { tenantId: row.tenant_id, userId: row.user_id, deviceId: row.id }
  }

  createBot(session: Session, name: string): PersonalBot {
    const id = randomUUID()
    this.#db.prepare('INSERT INTO bots (id, tenant_id, owner_user_id, name, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, session.tenantId, session.userId, name, this.#now())
    return { id, tenantId: session.tenantId, ownerUserId: session.userId, name }
  }

  listBots(session: Session): PersonalBot[] {
    const rows = this.#db.prepare('SELECT * FROM bots WHERE tenant_id = ? AND owner_user_id = ? ORDER BY rowid').all(session.tenantId, session.userId) as Array<{
      id: string; tenant_id: string; owner_user_id: string; name: string
    }>
    return rows.map(row => ({ id: row.id, tenantId: row.tenant_id, ownerUserId: row.owner_user_id, name: row.name }))
  }

  private deviceRow(tenantId: string, deviceId: string): { id: string; revoked: number } {
    const row = this.#db.prepare('SELECT id, revoked FROM devices WHERE id = ? AND tenant_id = ?').get(deviceId, tenantId) as
      | { id: string; revoked: number } | undefined
    if (row === undefined) throw new ControlPlaneError(404, 'DEVICE_NOT_FOUND', deviceId)
    if (row.revoked === 1) throw new ControlPlaneError(410, 'DEVICE_REVOKED', deviceId)
    return row
  }

  createDeviceTicket(session: Session, deviceId: string, input: { path: string; prompt: string; botId?: string }): {
    ticketId: string
    assignment: Record<string, unknown>
  } {
    if (!this.getSettings(session.tenantId).localExecutionEnabled) {
      throw new ControlPlaneError(403, 'LOCAL_EXECUTION_DISABLED', 'local execution is disabled')
    }
    this.deviceRow(session.tenantId, deviceId)
    this.enforceQuota(session.tenantId, 'deviceTickets')
    const ticketId = randomUUID()
    const assignmentId = randomUUID()
    const workdirKey = ticketId
    const stage = deriveTicketStage({ deliveryFailing: true, pendingInput: false })
    const assignment = {
      tenantId: session.tenantId,
      assignmentId,
      ticketId,
      workdirKey,
      kind: 'start',
      priority: 'normal',
      workspace: { kind: 'local_dir', deviceId, path: input.path },
      model: { source: 'local', id: 'device-default' },
      input: { prompt: input.prompt, followUps: [] },
      secretRefs: [],
      traceId: ticketId,
      clientContext: { operatorId: `app:${session.userId}`, channel: 'app', platform: 'web', deviceId },
      ...(input.botId === undefined ? {} : { botId: input.botId }),
    }
    this.#db.prepare('INSERT INTO device_tickets (ticket_id, tenant_id, device_id, path, prompt, stage, delivery_failing, assignment_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)')
      .run(ticketId, session.tenantId, deviceId, input.path, input.prompt, stage, JSON.stringify(assignment), this.#now(), this.#now())
    return { ticketId, assignment }
  }

  createDeviceFollowUp(session: Session, ticketId: string, text: string): {
    ticketId: string
    assignment: Record<string, unknown>
  } {
    const row = this.#db.prepare('SELECT * FROM device_tickets WHERE ticket_id = ? AND tenant_id = ?').get(ticketId, session.tenantId) as
      | { device_id: string; path: string } | undefined
    if (row === undefined) throw new ControlPlaneError(404, 'TICKET_NOT_FOUND', ticketId)
    this.deviceRow(session.tenantId, row.device_id)
    const assignmentId = randomUUID()
    const assignment = {
      tenantId: session.tenantId,
      assignmentId,
      ticketId,
      workdirKey: ticketId,
      kind: 'resume',
      priority: 'normal',
      workspace: { kind: 'local_dir', deviceId: row.device_id, path: row.path },
      model: { source: 'local', id: 'device-default' },
      input: { prompt: text, followUps: [] },
      secretRefs: [],
      traceId: ticketId,
      clientContext: { operatorId: `app:${session.userId}`, channel: 'app', platform: 'web', deviceId: row.device_id },
    }
    this.#db.prepare('UPDATE device_tickets SET assignment_json = ?, delivery_failing = 1, delivered_at = NULL, latest_state = ?, report_kind = NULL, report_json = NULL, stage = ?, updated_at = ? WHERE ticket_id = ?')
      .run(JSON.stringify(assignment), 'preparing', deriveTicketStage({ deliveryFailing: true, pendingInput: false }), this.#now(), ticketId)
    return { ticketId, assignment }
  }

  markDeviceTicketDelivered(tenantId: string, ticketId: string): void {
    const row = this.#db.prepare('SELECT * FROM device_tickets WHERE ticket_id = ? AND tenant_id = ?').get(ticketId, tenantId) as
      | { latest_state: string | null; report_kind: string | null } | undefined
    if (row === undefined) throw new ControlPlaneError(404, 'TICKET_NOT_FOUND', ticketId)
    const stage = deriveTicketStage({
      deliveryFailing: false,
      pendingInput: false,
      ...(row.latest_state === null ? {} : { latest: { state: row.latest_state as 'preparing', ...(row.report_kind === null ? {} : { reportKind: row.report_kind as 'ready' }) } }),
    })
    this.#db.prepare('UPDATE device_tickets SET delivery_failing = 0, delivered_at = ?, stage = ?, updated_at = ? WHERE ticket_id = ?')
      .run(this.#now(), stage, this.#now(), ticketId)
  }

  /** Settle delivered-but-unreported device assignments after an offline grace period. */
  markDeviceOffline(tenantId: string, deviceId: string): number {
    const rows = this.#db.prepare("SELECT ticket_id, event_count FROM device_tickets WHERE tenant_id = ? AND device_id = ? AND delivered_at IS NOT NULL AND latest_state IN ('preparing','running','backgrounded')")
      .all(tenantId, deviceId) as Array<{ ticket_id: string; event_count: number }>
    for (const row of rows) {
      const event = { type: 'state', seq: row.event_count, at: new Date(this.#now()).toISOString(), state: 'lost' }
      this.#db.prepare('INSERT OR REPLACE INTO device_ticket_events (ticket_id, seq, event_json) VALUES (?, ?, ?)')
        .run(row.ticket_id, row.event_count, JSON.stringify(event))
      const stage = deriveTicketStage({ deliveryFailing: false, pendingInput: false, latest: { state: 'lost' } })
      this.#db.prepare('UPDATE device_tickets SET latest_state = ?, stage = ?, event_count = ?, updated_at = ? WHERE ticket_id = ?')
        .run('lost', stage, row.event_count + 1, this.#now(), row.ticket_id)
    }
    return rows.length
  }

  /** Delivered assignments that a reconnecting device should resume inside the grace period. */
  recoverableDeviceAssignments(tenantId: string, deviceId: string): Array<{ ticketId: string; assignment: unknown }> {
    const rows = this.#db.prepare("SELECT ticket_id, assignment_json FROM device_tickets WHERE tenant_id = ? AND device_id = ? AND delivered_at IS NOT NULL AND latest_state IN ('preparing','running','backgrounded')")
      .all(tenantId, deviceId) as Array<{ ticket_id: string; assignment_json: string | null }>
    return rows.flatMap(row => row.assignment_json === null ? [] : [{ ticketId: row.ticket_id, assignment: JSON.parse(row.assignment_json) as unknown }])
  }

  pendingDeviceAssignments(tenantId: string, deviceId: string): Array<{ ticketId: string; assignment: unknown }> {
    const rows = this.#db.prepare('SELECT ticket_id, assignment_json FROM device_tickets WHERE tenant_id = ? AND device_id = ? AND delivered_at IS NULL')
      .all(tenantId, deviceId) as Array<{ ticket_id: string; assignment_json: string | null }>
    return rows.flatMap(row => row.assignment_json === null ? [] : [{ ticketId: row.ticket_id, assignment: JSON.parse(row.assignment_json) as unknown }])
  }

  recordDeviceEvent(tenantId: string, ticketId: string, value: unknown): void {
    const parsed = AssignmentEventSchema.parse(value) as AssignmentEvent
    const row = this.#db.prepare('SELECT * FROM device_tickets WHERE ticket_id = ? AND tenant_id = ?').get(ticketId, tenantId) as
      | { latest_state: string | null; report_kind: string | null; report_json: string | null; event_count: number } | undefined
    if (row === undefined) throw new ControlPlaneError(404, 'TICKET_NOT_FOUND', ticketId)
    // A ticket can receive several assignments (start + follow-ups). Store a
    // ticket-global sequence so the previous trail is not overwritten.
    const event = { ...parsed, seq: row.event_count } as AssignmentEvent
    this.#db.prepare('INSERT OR REPLACE INTO device_ticket_events (ticket_id, seq, event_json) VALUES (?, ?, ?)')
      .run(ticketId, event.seq, JSON.stringify(event))
    let latestState = row.latest_state
    let reportKind = row.report_kind
    let reportJson = row.report_json
    if (event.type === 'state') {
      latestState = event.state
      if (event.state === 'reported') { /* report event follows */ }
    } else if (event.type === 'report') {
      latestState = 'reported'
      reportKind = event.report.kind
      reportJson = JSON.stringify(event.report)
    }
    const stage = deriveTicketStage({
      deliveryFailing: false,
      pendingInput: false,
      ...(latestState === null ? {} : { latest: { state: latestState as 'preparing', ...(reportKind === null ? {} : { reportKind: reportKind as 'ready' }) } }),
    })
    this.#db.prepare('UPDATE device_tickets SET latest_state = ?, report_kind = ?, report_json = ?, event_count = ?, stage = ?, updated_at = ? WHERE ticket_id = ?')
      .run(latestState, reportKind, reportJson, row.event_count + 1, stage, this.#now(), ticketId)
  }

  deviceTicketTarget(tenantId: string, ticketId: string): { deviceId: string } | undefined {
    const row = this.#db.prepare('SELECT device_id FROM device_tickets WHERE ticket_id = ? AND tenant_id = ?').get(ticketId, tenantId) as
      | { device_id: string } | undefined
    return row === undefined ? undefined : { deviceId: row.device_id }
  }

  private cloudExecutor(): CloudExecutor {
    if (this.#cloud !== undefined) return this.#cloud
    const image = process.env.SIRIUSX_SANDBOX_IMAGE ?? 'teams-bridge:0.2.0'
    const fixture = fileURLToPath(new URL('./fixtures/fake-acp-raw.mjs', import.meta.url))
    mkdirSync(join(this.#dataDir, 'cloud'), { recursive: true })
    this.#cloud = new CloudExecutor({
      dbPath: join(this.#dataDir, 'cloud', 'assignments.sqlite'),
      provider: new DockerSandboxProvider({ image }),
      image,
      network: 'none',
      ...(process.env.SIRIUSX_CLOUD_ASSIGNMENT_TIMEOUT_MS === undefined ? {} : { assignmentTimeoutMs: Number(process.env.SIRIUSX_CLOUD_ASSIGNMENT_TIMEOUT_MS) }),
      kernel: new AcpCloudKernel({
        command: 'node',
        args: ['/workspace/fake-acp.mjs'],
        copyIn: { localPath: fixture, remotePath: '/workspace/fake-acp.mjs' },
        allowTools: true,
        timeoutMs: 2 * 60 * 1000,
        startDelayMs: process.env.SIRIUSX_CLOUD_START_DELAY_MS === undefined ? 0 : Number(process.env.SIRIUSX_CLOUD_START_DELAY_MS),
      } as never),
    })
    return this.#cloud
  }

  private executeCloudAssignment(ticketId: string, assignmentId: string, input: Record<string, unknown>): void {
    const executor = this.cloudExecutor()
    const run = (async () => {
      try {
        await executor.createAssignment(input as never)
        const done = await executor.wait(assignmentId)
        this.recordCloudAssignment(ticketId, assignmentId, done.state, done.report, executor.streamEventsForBot(assignmentId, 0).events)
      } catch (error) {
        this.recordCloudAssignment(ticketId, assignmentId, 'reported', {
          kind: 'failed', summary: 'cloud executor failed', reason: error instanceof Error ? error.message : String(error),
        }, [])
      } finally {
        try { await executor.destroyWorkdir(String(input.tenantId), assignmentId) } catch { /* best effort */ }
      }
    })()
    this.#cloudRuns.set(ticketId, run)
    void run.finally(() => { if (this.#cloudRuns.get(ticketId) === run) this.#cloudRuns.delete(ticketId) })
  }

  private parseCloudRepoUrl(value: string): URL {
    let url: URL
    try { url = new URL(value) } catch { throw new ControlPlaneError(400, 'INVALID_REPO_URL', 'repoUrl must be a valid URL') }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new ControlPlaneError(400, 'INVALID_REPO_URL', 'repoUrl must use http or https')
    if (url.username !== '' || url.password !== '') throw new ControlPlaneError(400, 'INVALID_REPO_URL', 'repoUrl must not contain credentials')
    return url
  }

  createCloudTicket(session: Session, input: { repoUrl: string; baseRef: string; prompt: string }): { ticketId: string } {
    if (session.role !== 'admin' && session.role !== 'member') throw new ControlPlaneError(403, 'UNAUTHORIZED', 'role required')
    return this.createCloudTicketForTenant(session.tenantId, input, { operatorId: `app:${session.userId}`, channel: 'app' as const, platform: 'web' as const })
  }

  createCloudTicketFromSource(input: { tenantId: string; operatorId: string; channel: 'gitlab' | 'github' | 'feishu' | 'teams'; repoUrl: string; baseRef: string; prompt: string }): { ticketId: string } {
    this.tenantRow(input.tenantId)
    return this.createCloudTicketForTenant(input.tenantId, input, { operatorId: input.operatorId, channel: input.channel, platform: 'web' as const })
  }

  private createCloudTicketForTenant(tenantId: string, input: { repoUrl: string; baseRef: string; prompt: string }, context: { operatorId: string; channel: 'app' | 'gitlab' | 'github' | 'feishu' | 'teams'; platform: 'web' }): { ticketId: string } {
    this.parseCloudRepoUrl(input.repoUrl)
    this.enforceQuota(tenantId, 'cloudTickets')
    const ticketId = randomUUID()
    const assignmentId = randomUUID()
    const repoUrl = this.parseCloudRepoUrl(input.repoUrl)
    const baseRef = input.baseRef.trim() === '' ? 'main' : input.baseRef.trim()
    const stage = deriveTicketStage({ deliveryFailing: false, pendingInput: false })
    this.#db.prepare('INSERT INTO cloud_tickets (ticket_id, tenant_id, assignment_id, repo_url, base_ref, prompt, stage, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(ticketId, tenantId, assignmentId, input.repoUrl, baseRef, input.prompt, stage, 'preparing', this.#now(), this.#now())
    const repo = {
      provider: repoUrl.hostname.includes('gitlab') ? 'gitlab' as const : 'github' as const,
      host: repoUrl.hostname,
      projectPath: repoUrl.pathname.replace(/^\//u, '').replace(/\.git$/u, ''),
      cloneUrl: input.repoUrl,
    }
    const assignmentInput = {
      tenantId,
      assignmentId,
      ticketId,
      kind: 'start' as const,
      priority: 'human' as const,
      workspace: { kind: 'cloud_project' as const, projectId: repo.projectPath, repo, baseRef },
      kernel: 'dsh' as const,
      model: { source: 'tenant' as const, id: 'tenant-default' },
      workdirKey: ticketId,
      input: { prompt: input.prompt, followUps: [] },
      secretRefs: [],
      traceId: ticketId,
      clientContext: { operatorId: context.operatorId, channel: context.channel, platform: context.platform },
    }
    this.executeCloudAssignment(ticketId, assignmentId, assignmentInput as unknown as Record<string, unknown>)
    return { ticketId }
  }

  async sendCloudFollowUp(session: Session, ticketId: string, text: string): Promise<{ ticketId: string; assignmentId: string }> {
    if (session.role !== 'admin' && session.role !== 'member') throw new ControlPlaneError(403, 'UNAUTHORIZED', 'role required')
    const row = this.#db.prepare('SELECT * FROM cloud_tickets WHERE ticket_id = ? AND tenant_id = ?').get(ticketId, session.tenantId) as { repo_url: string; base_ref: string } | undefined
    if (row === undefined) throw new ControlPlaneError(404, 'TICKET_NOT_FOUND', ticketId)
    await this.#cloudRuns.get(ticketId)?.catch(() => undefined)
    const assignmentId = randomUUID()
    const nextSeq = (this.#db.prepare('SELECT COALESCE(MAX(seq) + 1, 0) AS next FROM cloud_ticket_events WHERE ticket_id = ?').get(ticketId) as { next: number }).next
    this.#db.prepare("UPDATE cloud_tickets SET assignment_id = ?, state = 'preparing', report_json = NULL, stage = 'working/queued', updated_at = ? WHERE ticket_id = ?").run(assignmentId, this.#now(), ticketId)
    this.#db.prepare('INSERT OR REPLACE INTO cloud_ticket_events (ticket_id, seq, event_json) VALUES (?, ?, ?)')
      .run(ticketId, nextSeq, JSON.stringify({ type: 'state', seq: nextSeq, at: new Date(this.#now()).toISOString(), state: 'preparing' }))
    const repoUrl = this.parseCloudRepoUrl(row.repo_url)
    const repo = {
      provider: repoUrl.hostname.includes('gitlab') ? 'gitlab' as const : 'github' as const,
      host: repoUrl.hostname,
      projectPath: repoUrl.pathname.replace(/^\//u, '').replace(/\.git$/u, ''),
      cloneUrl: row.repo_url,
    }
    this.executeCloudAssignment(ticketId, assignmentId, {
      tenantId: session.tenantId, assignmentId, ticketId, kind: 'resume', priority: 'human',
      workspace: { kind: 'cloud_project', projectId: repo.projectPath, repo, baseRef: row.base_ref },
      kernel: 'dsh', model: { source: 'tenant', id: 'tenant-default' }, workdirKey: `${ticketId}-${assignmentId}`,
      input: { prompt: `Continue the ticket from the previous report.\n\nFollow-up:\n${text}`, followUps: [{ source: 'human', author: `app:${session.userId}`, text, triggerId: randomUUID() }] },
      secretRefs: [], traceId: ticketId, clientContext: { operatorId: `app:${session.userId}`, channel: 'app', platform: 'web' },
    })
    return { ticketId, assignmentId }
  }

  private recordCloudAssignment(ticketId: string, assignmentId: string, state: string, report: unknown, events: readonly unknown[]): void {
    const row = this.#db.prepare('SELECT tenant_id FROM cloud_tickets WHERE ticket_id = ?').get(ticketId) as { tenant_id: string } | undefined
    if (row === undefined) return
    const reportKind = typeof report === 'object' && report !== null && 'kind' in report ? String(report.kind) : undefined
    const stage = deriveTicketStage({
      deliveryFailing: false,
      pendingInput: false,
      latest: { state: state as 'preparing', ...(reportKind === undefined ? {} : { reportKind: reportKind as 'ready' }) },
    })
    this.#db.prepare('UPDATE cloud_tickets SET assignment_id = ?, state = ?, report_json = ?, stage = ?, updated_at = ? WHERE ticket_id = ?')
      .run(assignmentId, state, report === undefined ? null : JSON.stringify(report), stage, this.#now(), ticketId)
    const baseSeq = (this.#db.prepare('SELECT COALESCE(MAX(seq) + 1, 0) AS next FROM cloud_ticket_events WHERE ticket_id = ?').get(ticketId) as { next: number }).next
    const insert = this.#db.prepare('INSERT OR REPLACE INTO cloud_ticket_events (ticket_id, seq, event_json) VALUES (?, ?, ?)')
    let offset = 0
    for (const event of events) {
      const localSeq = typeof event === 'object' && event !== null && 'seq' in event && typeof event.seq === 'number' ? event.seq : offset
      offset++
      insert.run(ticketId, baseSeq + localSeq, JSON.stringify({ ...(event as Record<string, unknown>), seq: baseSeq + localSeq }))
    }
  }

  private listCloudTickets(tenantId: string): Array<{
    ticketId: string; title: string; stage: TicketStage; closed: boolean; pendingInputs: number;
    latestAssignment?: { assignmentId: string; state: string; report?: unknown }
  }> {
    const rows = this.#db.prepare('SELECT * FROM cloud_tickets WHERE tenant_id = ? ORDER BY created_at, rowid').all(tenantId) as Array<{
      ticket_id: string; assignment_id: string; prompt: string; stage: string; state: string; report_json: string | null
    }>
    return rows.map(row => ({
      ticketId: row.ticket_id,
      title: row.prompt.slice(0, 120),
      stage: row.stage as TicketStage,
      closed: row.stage === 'idle',
      pendingInputs: 0,
      latestAssignment: { assignmentId: row.assignment_id, state: row.state, ...(row.report_json === null ? {} : { report: JSON.parse(row.report_json) as unknown }) },
    }))
  }

  private getCloudTicket(tenantId: string, ticketId: string): unknown {
    const ticket = this.listCloudTickets(tenantId).find(item => item.ticketId === ticketId)
    if (ticket === undefined) throw new ControlPlaneError(404, 'TICKET_NOT_FOUND', ticketId)
    const events = (this.#db.prepare('SELECT event_json FROM cloud_ticket_events WHERE ticket_id = ? ORDER BY seq').all(ticketId) as Array<{ event_json: string }>)
      .map(row => JSON.parse(row.event_json) as unknown)
    return { ...ticket, events }
  }

  /** Mark cloud tickets whose process died as failed instead of leaving them running forever. */
  private reconcileCloudTickets(): number {
    const rows = this.#db.prepare("SELECT ticket_id, (SELECT COALESCE(MAX(seq) + 1, 0) FROM cloud_ticket_events e WHERE e.ticket_id = cloud_tickets.ticket_id) AS next_seq FROM cloud_tickets WHERE state NOT IN ('reported','cancelled','failed')").all() as Array<{ ticket_id: string; next_seq: number }>
    for (const row of rows) {
      const report = { kind: 'failed', summary: 'cloud executor interrupted', reason: 'control-plane restarted before the assignment reported' }
      const stage = deriveTicketStage({ deliveryFailing: false, pendingInput: false, latest: { state: 'reported', reportKind: 'failed' } })
      this.#db.prepare("UPDATE cloud_tickets SET state = 'reported', report_json = ?, stage = ?, updated_at = ? WHERE ticket_id = ?")
        .run(JSON.stringify(report), stage, this.#now(), row.ticket_id)
      this.#db.prepare('INSERT OR REPLACE INTO cloud_ticket_events (ticket_id, seq, event_json) VALUES (?, ?, ?)')
        .run(row.ticket_id, row.next_seq, JSON.stringify({ type: 'report', seq: row.next_seq, at: new Date(this.#now()).toISOString(), report }))
    }
    return rows.length
  }

  /** Reload the process read model from PostgreSQL. */
  async refreshCache(): Promise<void> {
    if (this.#storage === undefined) return
    const tenants = await this.#storage.query<{ id: string; name: string; idp_issuer: string; status: 'active' | 'suspended'; created_at: string | number }>('SELECT id, name, idp_issuer, status, created_at FROM tenants ORDER BY created_at, id')
    const users = await this.#storage.query<{ id: string; tenant_id: string; email: string; role: Role; created_at: string | number }>('SELECT id, tenant_id, email, role, created_at FROM users ORDER BY created_at, id')
    this.#tenantCache.clear(); this.#userCache.clear()
    for (const row of tenants.rows) this.#tenantCache.set(row.id, { id: row.id, name: row.name, idpIssuer: row.idp_issuer, createdAt: Number(row.created_at), status: row.status })
    for (const row of users.rows) this.#userCache.set(row.id, { id: row.id, tenantId: row.tenant_id, email: row.email, role: row.role, createdAt: Number(row.created_at) })
    const settings = await this.#storage.query<{ tenant_id: string; native_conversation_enabled: number | string; byok_enabled: number | string; local_execution_enabled: number | string }>('SELECT * FROM settings')
    const quotas = await this.#storage.query<{ tenant_id: string; max_users: number | string; max_devices: number | string; max_cloud_tickets_per_day: number | string; max_device_tickets_per_day: number | string }>('SELECT * FROM tenant_quotas')
    this.#settingsCache.clear(); this.#quotaCache.clear()
    for (const row of settings.rows) this.#settingsCache.set(row.tenant_id, { nativeConversationEnabled: Number(row.native_conversation_enabled) === 1, byokEnabled: Number(row.byok_enabled) === 1, localExecutionEnabled: Number(row.local_execution_enabled) === 1 })
    for (const row of quotas.rows) this.#quotaCache.set(row.tenant_id, { maxUsers: Number(row.max_users), maxDevices: Number(row.max_devices), maxCloudTicketsPerDay: Number(row.max_cloud_tickets_per_day), maxDeviceTicketsPerDay: Number(row.max_device_tickets_per_day) })
    this.#cacheReady = true
  }

  async initialize(): Promise<void> { await this.refreshCache(); await this.rebuildModelRouterConfig() }

  async startCacheInvalidation(): Promise<void> {
    if (this.#storage?.listen === undefined || this.#cacheStop !== undefined) return
    this.#cacheStop = await this.#storage.listen('siriusx_cache_change', () => { void this.refreshCache().catch(() => undefined) })
  }

  async stopCacheInvalidation(): Promise<void> {
    const stop = this.#cacheStop
    this.#cacheStop = undefined
    if (stop !== undefined) await stop()
  }

  async #notifyCacheChange(): Promise<void> {
    if (this.#storage !== undefined) await this.#storage.query("SELECT pg_notify('siriusx_cache_change', '1')")
  }

  ready(): { database: 'ok' } {
    this.#db.prepare('SELECT 1').get()
    return { database: 'ok' }
  }

  metrics(): { tenants: number; users: number; devices: number; deviceTickets: number; cloudTickets: number } {
    const count = (table: string): number => (this.#db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count
    return { tenants: count('tenants'), users: count('users'), devices: count('devices'), deviceTickets: count('device_tickets'), cloudTickets: count('cloud_tickets') }
  }

  cloudTicketTarget(tenantId: string, ticketId: string): { ticketId: string } | undefined {
    const row = this.#db.prepare('SELECT ticket_id FROM cloud_tickets WHERE ticket_id = ? AND tenant_id = ?').get(ticketId, tenantId) as { ticket_id: string } | undefined
    return row === undefined ? undefined : { ticketId: row.ticket_id }
  }

  cancelCloudTicket(session: Session, ticketId: string): void {
    const row = this.#db.prepare('SELECT tenant_id, assignment_id FROM cloud_tickets WHERE ticket_id = ? AND tenant_id = ?').get(ticketId, session.tenantId) as { tenant_id: string; assignment_id: string } | undefined
    if (row === undefined) throw new ControlPlaneError(404, 'TICKET_NOT_FOUND', ticketId)
    const executor = this.#cloud
    if (executor !== undefined) {
      const input: CancelAssignment = {
        tenantId: session.tenantId, assignmentId: row.assignment_id, mode: 'kill', reason: 'user_stop',
        clientContext: { operatorId: `app:${session.userId}`, channel: 'app', platform: 'web' },
      }
      void executor.cancelAssignment(input).catch(() => undefined)
    }
    this.recordCloudAssignment(ticketId, row.assignment_id, 'cancelled', undefined, [])
  }

  createPersonalBotTicket(session: Session, botId: string, deviceId: string, input: { path: string; prompt: string }): {
    ticketId: string
    assignment: Record<string, unknown>
  } {
    const bot = this.#db.prepare('SELECT id FROM bots WHERE id = ? AND tenant_id = ? AND owner_user_id = ?').get(botId, session.tenantId, session.userId)
    if (bot === undefined) throw new ControlPlaneError(404, 'BOT_NOT_FOUND', botId)
    const device = this.#db.prepare('SELECT id, user_id, revoked FROM devices WHERE id = ? AND tenant_id = ?').get(deviceId, session.tenantId) as
      | { id: string; user_id: string; revoked: number } | undefined
    if (device === undefined) throw new ControlPlaneError(404, 'DEVICE_NOT_FOUND', deviceId)
    if (device.user_id !== session.userId) throw new ControlPlaneError(403, 'DEVICE_NOT_OWNED', 'personal Bot can only use the member\'s own device')
    if (device.revoked === 1) throw new ControlPlaneError(410, 'DEVICE_REVOKED', deviceId)
    return this.createDeviceTicket(session, deviceId, { ...input, botId })
  }

  private listDeviceTickets(tenantId: string): Array<{
    ticketId: string; title: string; stage: TicketStage; closed: boolean; pendingInputs: number;
    latestAssignment?: { assignmentId: string; state: string; report?: unknown }
  }> {
    const rows = this.#db.prepare('SELECT * FROM device_tickets WHERE tenant_id = ? ORDER BY created_at, rowid').all(tenantId) as Array<{
      ticket_id: string; prompt: string; stage: string; latest_state: string | null; report_json: string | null
    }>
    return rows.map(row => {
      const report = row.report_json === null ? undefined : JSON.parse(row.report_json) as unknown
      const latestState = row.latest_state ?? 'preparing'
      return {
        ticketId: row.ticket_id,
        title: row.prompt.slice(0, 120),
        stage: row.stage as TicketStage,
        closed: row.stage === 'idle',
        pendingInputs: 0,
        latestAssignment: {
          assignmentId: row.ticket_id,
          state: latestState,
          ...(report === undefined ? {} : { report }),
        },
      }
    })
  }

  private getDeviceTicket(tenantId: string, ticketId: string): unknown {
    const ticket = this.listDeviceTickets(tenantId).find(item => item.ticketId === ticketId)
    if (ticket === undefined) throw new ControlPlaneError(404, 'TICKET_NOT_FOUND', ticketId)
    const events = (this.#db.prepare('SELECT event_json FROM device_ticket_events WHERE ticket_id = ? ORDER BY seq').all(ticketId) as Array<{ event_json: string }>)
      .map(row => JSON.parse(row.event_json) as unknown)
    return { ...ticket, events }
  }

  private async botRuntime(tenantId: string): Promise<BotService> {
    const existing = this.#runtimes.get(tenantId)
    if (existing !== undefined) return existing
    this.tenantRow(tenantId)
    const dir = join(this.#dataDir, 'tenants', tenantId)
    mkdirSync(dir, { recursive: true })
    const kernel = new FakeKernel({
      defaultScenario: this.#botScenario === 'waiting'
        ? { steps: [{ kind: 'delta', text: '```siriusx-report\n{"kind":"waiting","summary":"approval required","reason":"waiting for tool approval"}\n```' }] }
        : { steps: [{ kind: 'delta', text: '```siriusx-report\n{"kind":"ready","summary":"tenant-local Bot runtime finished"}\n```' }] },
    })
    const executor = new LocalExecutor({ tenantId, backend: kernel })
    const runtime = new BotService({ dbPath: join(dir, 'bot.sqlite'), executor })
    await runtime.initialize()
    this.#runtimes.set(tenantId, runtime)
    return runtime
  }

  async createTicket(session: Session, input: { path: string; prompt: string }): Promise<{ ticketId: string }> {
    if (!this.getSettings(session.tenantId).localExecutionEnabled) {
      throw new ControlPlaneError(403, 'LOCAL_EXECUTION_DISABLED', 'local execution is disabled')
    }
    const runtime = await this.botRuntime(session.tenantId)
    const ticketId = await runtime.createTicket({
      tenantId: session.tenantId,
      workspace: { kind: 'local_dir', deviceId: 'local-device', path: input.path },
      prompt: input.prompt,
    })
    void runtime.dispatch(ticketId).catch(() => undefined)
    return { ticketId }
  }

  async listTickets(session: Session): Promise<unknown[]> {
    return [...await (await this.botRuntime(session.tenantId)).listTickets(), ...this.listDeviceTickets(session.tenantId), ...this.listCloudTickets(session.tenantId)]
  }

  async ticketDetail(session: Session, ticketId: string): Promise<unknown> {
    const runtime = await this.botRuntime(session.tenantId)
    try {
      return { ...await runtime.getTicket(ticketId), events: await runtime.eventsForTicket(ticketId) }
    } catch {
      try { return this.getDeviceTicket(session.tenantId, ticketId) } catch { return this.getCloudTicket(session.tenantId, ticketId) }
    }
  }

  async resumeTicketFromApproval(tenantId: string, ticketId: string, approvalId: string, status: 'approved' | 'rejected'): Promise<boolean> {
    try {
      await (await this.botRuntime(tenantId)).getTicket(ticketId)
    } catch {
      return false
    }
    await (await this.botRuntime(tenantId)).sendInput(ticketId, `Approval ${approvalId} was ${status}. Continue the ticket from the previous report.`, 'tool-gateway:approval')
    return true
  }

  async sendTicketInput(session: Session, ticketId: string, text: string): Promise<unknown> {
    return (await this.botRuntime(session.tenantId)).sendInput(ticketId, text, `app:${session.userId}`)
  }

  async cancelTicket(session: Session, ticketId: string): Promise<unknown> {
    return (await this.botRuntime(session.tenantId)).cancelTicket(ticketId)
  }
}

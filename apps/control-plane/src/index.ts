/** SiriusX control plane: tenants, users, devices, bots, settings, and per-tenant Bot runtimes. */
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { BotService } from '@siriusx/autobot/bot-service'
import { FakeKernel } from '@siriusx/fake-kernel'
import { LocalExecutor } from '@siriusx/executor-local'
import { AssignmentEventSchema, type AssignmentEvent } from '@siriusx/contracts/executor'
import { deriveTicketStage, type TicketStage } from '@siriusx/contracts/ticket-stage'

export type Role = 'admin' | 'member'

export interface ControlPlaneOptions {
  readonly dbPath: string
  readonly dataDir: string
  readonly sessionSecret?: string
  readonly now?: () => number
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
  readonly #dataDir: string
  readonly #secret: string
  readonly #now: () => number
  readonly #runtimes = new Map<string, BotService>()

  constructor(options: ControlPlaneOptions) {
    mkdirSync(options.dataDir, { recursive: true })
    this.#db = new DatabaseSync(options.dbPath)
    this.#db.exec(SCHEMA)
    this.#dataDir = options.dataDir
    this.#secret = options.sessionSecret ?? randomBytes(32).toString('base64url')
    this.#now = options.now ?? Date.now
  }

  close(): void {
    for (const runtime of this.#runtimes.values()) runtime.close()
    this.#runtimes.clear()
    this.#db.close()
  }

  private tenantRow(tenantId: string): { id: string; name: string; idp_issuer: string; created_at: number } {
    const row = this.#db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId) as
      | { id: string; name: string; idp_issuer: string; created_at: number }
      | undefined
    if (row === undefined) throw new ControlPlaneError(404, 'TENANT_NOT_FOUND', tenantId)
    return row
  }

  provisionTenant(input: { name: string; idpIssuer: string; adminEmail: string; tenantId?: string }): Tenant {
    const id = input.tenantId ?? randomUUID()
    const now = this.#now()
    this.#db.exec('BEGIN')
    try {
      this.#db.prepare('INSERT INTO tenants (id, name, idp_issuer, created_at) VALUES (?, ?, ?, ?)')
        .run(id, input.name, input.idpIssuer, now)
      this.#db.prepare('INSERT INTO settings (tenant_id) VALUES (?)').run(id)
      this.#db.prepare('INSERT INTO users (id, tenant_id, email, role, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(randomUUID(), id, input.adminEmail, 'admin', now)
      this.#db.exec('COMMIT')
    } catch (error) {
      this.#db.exec('ROLLBACK')
      throw error
    }
    return { id, name: input.name, idpIssuer: input.idpIssuer, createdAt: now }
  }

  listTenants(): Tenant[] {
    return (this.#db.prepare('SELECT * FROM tenants ORDER BY created_at, rowid').all() as Array<{
      id: string; name: string; idp_issuer: string; created_at: number
    }>).map(row => ({ id: row.id, name: row.name, idpIssuer: row.idp_issuer, createdAt: row.created_at }))
  }

  findTenantByIssuer(issuer: string): Tenant | undefined {
    const row = this.#db.prepare('SELECT * FROM tenants WHERE idp_issuer = ?').get(issuer) as
      | { id: string; name: string; idp_issuer: string; created_at: number } | undefined
    return row === undefined ? undefined : { id: row.id, name: row.name, idpIssuer: row.idp_issuer, createdAt: row.created_at }
  }

  findUserByEmail(tenantId: string, email: string): { id: string; role: Role } | undefined {
    const row = this.#db.prepare('SELECT id, role FROM users WHERE tenant_id = ? AND email = ?').get(tenantId, email) as { id: string; role: Role } | undefined
    return row
  }

  addUser(input: { tenantId: string; email: string; role?: Role }): { userId: string } {
    this.tenantRow(input.tenantId)
    const userId = randomUUID()
    this.#db.prepare('INSERT INTO users (id, tenant_id, email, role, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(userId, input.tenantId, input.email, input.role ?? 'member', this.#now())
    return { userId }
  }

  issueSession(input: { tenantId: string; userId: string; role: Role }): string {
    const user = this.#db.prepare('SELECT id, role FROM users WHERE id = ? AND tenant_id = ?').get(input.userId, input.tenantId) as
      | { id: string; role: string } | undefined
    if (user === undefined) throw new ControlPlaneError(401, 'USER_NOT_FOUND', 'user is not a member of this tenant')
    const payload = Buffer.from(JSON.stringify({ tenantId: input.tenantId, userId: input.userId, role: input.role })).toString('base64url')
    const signature = createHmac('sha256', this.#secret).update(payload).digest('base64url')
    return `${payload}.${signature}`
  }

  verifySession(token: string): Session {
    const [payload, signature] = token.split('.')
    if (payload === undefined || signature === undefined) throw new ControlPlaneError(401, 'UNAUTHORIZED', 'invalid session token')
    const expected = createHmac('sha256', this.#secret).update(payload).digest('base64url')
    if (!safeEqual(signature, expected)) throw new ControlPlaneError(401, 'UNAUTHORIZED', 'invalid session token')
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<Session>
    if (typeof value.tenantId !== 'string' || typeof value.userId !== 'string' || (value.role !== 'admin' && value.role !== 'member')) {
      throw new ControlPlaneError(401, 'UNAUTHORIZED', 'invalid session claims')
    }
    const user = this.#db.prepare('SELECT role FROM users WHERE id = ? AND tenant_id = ?').get(value.userId, value.tenantId) as { role: Role } | undefined
    if (user === undefined) throw new ControlPlaneError(401, 'UNAUTHORIZED', 'user no longer exists')
    return { tenantId: value.tenantId, userId: value.userId, role: user.role }
  }

  getSettings(tenantId: string): { nativeConversationEnabled: boolean; byokEnabled: boolean; localExecutionEnabled: boolean } {
    this.tenantRow(tenantId)
    const row = this.#db.prepare('SELECT * FROM settings WHERE tenant_id = ?').get(tenantId) as {
      native_conversation_enabled: number; byok_enabled: number; local_execution_enabled: number
    }
    return {
      nativeConversationEnabled: row.native_conversation_enabled === 1,
      byokEnabled: row.byok_enabled === 1,
      localExecutionEnabled: row.local_execution_enabled === 1,
    }
  }

  updateSettings(session: Session, patch: Partial<{ nativeConversationEnabled: boolean; byokEnabled: boolean; localExecutionEnabled: boolean }>): void {
    if (session.role !== 'admin') throw new ControlPlaneError(403, 'ADMIN_REQUIRED', 'admin role required')
    const current = this.getSettings(session.tenantId)
    this.#db.prepare('UPDATE settings SET native_conversation_enabled = ?, byok_enabled = ?, local_execution_enabled = ? WHERE tenant_id = ?')
      .run(
        (patch.nativeConversationEnabled ?? current.nativeConversationEnabled) ? 1 : 0,
        (patch.byokEnabled ?? current.byokEnabled) ? 1 : 0,
        (patch.localExecutionEnabled ?? current.localExecutionEnabled) ? 1 : 0,
        session.tenantId,
      )
  }

  startPairing(session: Session, deviceName: string): { code: string; expiresAt: number } {
    if (!this.getSettings(session.tenantId).localExecutionEnabled) {
      throw new ControlPlaneError(403, 'LOCAL_EXECUTION_DISABLED', 'local execution is disabled')
    }
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
    const row = this.#db.prepare('SELECT * FROM pairing_codes WHERE code = ? AND tenant_id = ? AND user_id = ?').get(code, session.tenantId, session.userId) as
      | { device_id: string; expires_at: number; consumed_at: number | null } | undefined
    if (row === undefined) throw new ControlPlaneError(404, 'PAIRING_NOT_FOUND', code)
    if (row.consumed_at !== null) throw new ControlPlaneError(409, 'PAIRING_USED', code)
    if (row.expires_at < this.#now()) throw new ControlPlaneError(410, 'PAIRING_EXPIRED', code)
    const token = randomBytes(32).toString('base64url')
    this.#db.prepare('UPDATE pairing_codes SET consumed_at = ? WHERE code = ?').run(this.#now(), code)
    this.#db.prepare('UPDATE devices SET token_hash = ?, last_seen_at = ? WHERE id = ?').run(tokenHash(token), this.#now(), row.device_id)
    return { deviceId: row.device_id, token }
  }

  listDevices(session: Session): Device[] {
    const rows = this.#db.prepare('SELECT * FROM devices WHERE tenant_id = ? ORDER BY rowid').all(session.tenantId) as Array<{
      id: string; tenant_id: string; user_id: string; name: string; revoked: number; last_seen_at: number | null
    }>
    return rows.map(row => ({
      id: row.id, tenantId: row.tenant_id, userId: row.user_id, name: row.name,
      revoked: row.revoked === 1, lastSeenAt: row.last_seen_at,
    }))
  }

  revokeDevice(session: Session, deviceId: string): void {
    if (session.role !== 'admin') throw new ControlPlaneError(403, 'ADMIN_REQUIRED', 'admin role required')
    const result = this.#db.prepare('UPDATE devices SET revoked = 1 WHERE id = ? AND tenant_id = ?').run(deviceId, session.tenantId)
    if (result.changes === 0) throw new ControlPlaneError(404, 'DEVICE_NOT_FOUND', deviceId)
  }

  verifyDeviceToken(token: string): { tenantId: string; userId: string; deviceId: string } {
    const row = this.#db.prepare('SELECT id, tenant_id, user_id FROM devices WHERE token_hash = ? AND revoked = 0').get(tokenHash(token)) as
      | { id: string; tenant_id: string; user_id: string } | undefined
    if (row === undefined) throw new ControlPlaneError(401, 'DEVICE_UNAUTHORIZED', 'device token is invalid or revoked')
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

  createDeviceTicket(session: Session, deviceId: string, input: { path: string; prompt: string }): {
    ticketId: string
    assignment: Record<string, unknown>
  } {
    if (!this.getSettings(session.tenantId).localExecutionEnabled) {
      throw new ControlPlaneError(403, 'LOCAL_EXECUTION_DISABLED', 'local execution is disabled')
    }
    this.deviceRow(session.tenantId, deviceId)
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
    }
    this.#db.prepare('INSERT INTO device_tickets (ticket_id, tenant_id, device_id, path, prompt, stage, delivery_failing, assignment_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)')
      .run(ticketId, session.tenantId, deviceId, input.path, input.prompt, stage, JSON.stringify(assignment), this.#now(), this.#now())
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

  pendingDeviceAssignments(tenantId: string, deviceId: string): Array<{ ticketId: string; assignment: unknown }> {
    const rows = this.#db.prepare('SELECT ticket_id, assignment_json FROM device_tickets WHERE tenant_id = ? AND device_id = ? AND delivered_at IS NULL')
      .all(tenantId, deviceId) as Array<{ ticket_id: string; assignment_json: string | null }>
    return rows.flatMap(row => row.assignment_json === null ? [] : [{ ticketId: row.ticket_id, assignment: JSON.parse(row.assignment_json) as unknown }])
  }

  recordDeviceEvent(tenantId: string, ticketId: string, value: unknown): void {
    const event = AssignmentEventSchema.parse(value) as AssignmentEvent
    const row = this.#db.prepare('SELECT * FROM device_tickets WHERE ticket_id = ? AND tenant_id = ?').get(ticketId, tenantId) as
      | { latest_state: string | null; report_kind: string | null; report_json: string | null } | undefined
    if (row === undefined) throw new ControlPlaneError(404, 'TICKET_NOT_FOUND', ticketId)
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
    this.#db.prepare('UPDATE device_tickets SET latest_state = ?, report_kind = ?, report_json = ?, stage = ?, updated_at = ? WHERE ticket_id = ?')
      .run(latestState, reportKind, reportJson, stage, this.#now(), ticketId)
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

  private botRuntime(tenantId: string): BotService {
    const existing = this.#runtimes.get(tenantId)
    if (existing !== undefined) return existing
    this.tenantRow(tenantId)
    const dir = join(this.#dataDir, 'tenants', tenantId)
    mkdirSync(dir, { recursive: true })
    const kernel = new FakeKernel({
      defaultScenario: { steps: [{ kind: 'delta', text: '```siriusx-report\n{"kind":"ready","summary":"tenant-local Bot runtime finished"}\n```' }] },
    })
    const executor = new LocalExecutor({ tenantId, backend: kernel })
    const runtime = new BotService({ dbPath: join(dir, 'bot.sqlite'), executor })
    this.#runtimes.set(tenantId, runtime)
    return runtime
  }

  createTicket(session: Session, input: { path: string; prompt: string }): { ticketId: string } {
    if (!this.getSettings(session.tenantId).localExecutionEnabled) {
      throw new ControlPlaneError(403, 'LOCAL_EXECUTION_DISABLED', 'local execution is disabled')
    }
    const runtime = this.botRuntime(session.tenantId)
    const ticketId = runtime.createTicket({
      tenantId: session.tenantId,
      workspace: { kind: 'local_dir', deviceId: 'local-device', path: input.path },
      prompt: input.prompt,
    })
    void runtime.dispatch(ticketId).catch(() => undefined)
    return { ticketId }
  }

  listTickets(session: Session): unknown[] {
    return [...this.botRuntime(session.tenantId).listTickets(), ...this.listDeviceTickets(session.tenantId)]
  }

  ticketDetail(session: Session, ticketId: string): unknown {
    const runtime = this.botRuntime(session.tenantId)
    try {
      return { ...runtime.getTicket(ticketId), events: runtime.eventsForTicket(ticketId) }
    } catch {
      return this.getDeviceTicket(session.tenantId, ticketId)
    }
  }

  async sendTicketInput(session: Session, ticketId: string, text: string): Promise<unknown> {
    return this.botRuntime(session.tenantId).sendInput(ticketId, text, `app:${session.userId}`)
  }

  async cancelTicket(session: Session, ticketId: string): Promise<unknown> {
    return this.botRuntime(session.tenantId).cancelTicket(ticketId)
  }
}

/** Fail-closed tool gateway with policy, approval cards, audit and connector credentials. */
import { createHash, randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import type { Storage } from '@siriusx/storage'
import { z } from 'zod'
import type { CredentialProvider } from './credentials.ts'

export const ActionRequestSchema = z.object({
  tenantId: z.string().min(1),
  botId: z.string().min(1),
  ticketId: z.string().min(1),
  operatorId: z.string().min(1),
  system: z.string().min(1),
  actionClass: z.string().min(1),
  target: z.string().min(1),
  content: z.string().max(100_000).optional(),
  mandate: z.object({ actions: z.array(z.string()).default([]) }).default({ actions: [] }),
})
export type ActionRequest = z.infer<typeof ActionRequestSchema>

export interface ToolContext {
  readonly tenantId: string
  readonly botId: string
  readonly ticketId: string
  readonly userId: string
  readonly operatorId: string
  readonly approverId?: string
  readonly role: 'member' | 'admin'
}

export interface Connector {
  execute(request: ActionRequest, credential: string | undefined): Promise<{ result: unknown }>
}

export interface ToolGatewayOptions {
  readonly dbPath: string
  readonly storage?: Storage
  readonly connectors: Readonly<Record<string, Connector>>
  readonly credentials?: Readonly<Record<string, string>>
  readonly credentialProvider?: CredentialProvider
  readonly policyEnabled?: boolean
  readonly approvalTtlMs?: number
  readonly now?: () => number
  readonly onApprovalDecided?: (event: {
    readonly approvalId: string
    readonly tenantId: string
    readonly ticketId: string
    readonly status: 'approved' | 'rejected'
    readonly request: ActionRequest
  }) => void | Promise<void>
}

export type PolicyDecision =
  | { readonly kind: 'allow'; readonly reason: string }
  | { readonly kind: 'approval'; readonly reason: string; readonly risk: 'low' | 'medium' | 'high' }
  | { readonly kind: 'deny'; readonly reason: string }

const BUILTIN_DENY = new Set(['delete_repository', 'change_permissions', 'transfer_funds'])

/** Pure policy decision; the caller must treat exceptions as deny. */
export function decidePolicy(request: ActionRequest): PolicyDecision {
  if (BUILTIN_DENY.has(request.actionClass)) return { kind: 'deny', reason: 'built-in baseline denies this action' }
  const mandate = new Set(request.mandate.actions)
  if (mandate.has(`${request.system}:${request.actionClass}`) || mandate.has(`${request.system}:*`)) {
    return { kind: 'allow', reason: 'within Mandate' }
  }
  if (request.actionClass.startsWith('read')) return { kind: 'allow', reason: 'read action' }
  if (request.actionClass === 'reply' || request.actionClass === 'comment') return { kind: 'allow', reason: 'thread reply' }
  if (request.actionClass === 'push' || request.actionClass === 'open_change_request') {
    return { kind: 'allow', reason: 'mandate-class repository action' }
  }
  return { kind: 'approval', reason: 'write/send/delete outside Mandate', risk: 'medium' }
}

export class ToolGatewayError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ToolGatewayError'
    this.status = status
    this.code = code
  }
}

interface ApprovalRow extends Record<string, unknown> {
  readonly id: string
  readonly tenant_id: string
  readonly ticket_id: string
  readonly request_json: string
  readonly status: string
  readonly risk: string
  readonly expires_at: number
  readonly approver_id: string | null
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  request_json TEXT NOT NULL,
  status TEXT NOT NULL,
  risk TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  approver_id TEXT,
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);
CREATE TABLE IF NOT EXISTS tenant_tool_policies (
  tenant_id TEXT NOT NULL,
  action_class TEXT NOT NULL,
  effect TEXT NOT NULL CHECK (effect IN ('approval', 'deny')),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, action_class)
);
CREATE TABLE IF NOT EXISTS audit (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  action_class TEXT NOT NULL,
  system TEXT NOT NULL,
  decision TEXT NOT NULL,
  approval_id TEXT,
  approver_id TEXT,
  result_json TEXT,
  created_at INTEGER NOT NULL,
  prev_hash TEXT,
  hash TEXT
);
`

export class ToolGateway {
  readonly #db: DatabaseSync
  readonly #storage: Storage | undefined
  #initialized = false
  readonly #options: { dbPath: string; connectors: Readonly<Record<string, Connector>>; policyEnabled: boolean; approvalTtlMs: number; credentials?: Readonly<Record<string, string>>; credentialProvider?: CredentialProvider; onApprovalDecided?: (event: { approvalId: string; tenantId: string; ticketId: string; status: 'approved' | 'rejected'; request: ActionRequest }) => void | Promise<void> }
  readonly #now: () => number
  #lastAuditHash: string | undefined
  readonly #executed: ActionRequest[] = []

  constructor(options: ToolGatewayOptions) {
    this.#db = new DatabaseSync(options.dbPath)
    this.#db.exec(SCHEMA)
    this.#storage = options.storage
    this.#options = {
      dbPath: options.dbPath,
      connectors: options.connectors,
      ...(options.credentials === undefined ? {} : { credentials: options.credentials }),
      ...(options.credentialProvider === undefined ? {} : { credentialProvider: options.credentialProvider }),
      policyEnabled: options.policyEnabled ?? true,
      approvalTtlMs: options.approvalTtlMs ?? 15 * 60 * 1000,
      ...(options.onApprovalDecided === undefined ? {} : { onApprovalDecided: options.onApprovalDecided }),
    }
    this.#now = options.now ?? Date.now
    const auditColumns = this.#db.prepare('PRAGMA table_info(audit)').all() as Array<{ name: string }>
    if (!auditColumns.some(column => column.name === 'prev_hash')) this.#db.exec('ALTER TABLE audit ADD COLUMN prev_hash TEXT')
    if (!auditColumns.some(column => column.name === 'hash')) this.#db.exec('ALTER TABLE audit ADD COLUMN hash TEXT')
    const last = this.#db.prepare('SELECT hash FROM audit ORDER BY created_at DESC, rowid DESC LIMIT 1').get() as { hash: string | null } | undefined
    this.#lastAuditHash = last?.hash ?? undefined
  }

  async initialize(): Promise<void> {
    if (this.#storage === undefined) { this.#initialized = true; return }
    const last = await this.#storage.query<{ hash: string | null }>('SELECT hash FROM tg_audit ORDER BY created_at DESC, id DESC LIMIT 1')
    this.#lastAuditHash = last.rows[0]?.hash ?? undefined
    this.#initialized = true
  }

  async ready(): Promise<{ database: 'ok' }> {
    if (this.#storage === undefined) this.#db.prepare('SELECT 1').get()
    else await this.#storage.query('SELECT 1')
    return { database: 'ok' }
  }

  async metrics(): Promise<{ approvalsPending: number; approvalsTotal: number; audits: number; auditChainValid: boolean }> {
    if (this.#storage !== undefined) {
      const count = async (sql: string): Promise<number> => Number((await this.#storage!.query<{ count: string | number }>(sql)).rows[0]?.count ?? 0)
      return {
        approvalsPending: await count("SELECT COUNT(*) AS count FROM tg_approvals WHERE status = 'pending'"),
        approvalsTotal: await count('SELECT COUNT(*) AS count FROM tg_approvals'),
        audits: await count('SELECT COUNT(*) AS count FROM tg_audit'),
        auditChainValid: (await this.verifyAuditChain()).valid,
      }
    }
    const count = (sql: string, ...parameters: Array<string>): number => (this.#db.prepare(sql).get(...parameters) as { count: number }).count
    return {
      approvalsPending: count("SELECT COUNT(*) AS count FROM approvals WHERE status = 'pending'"),
      approvalsTotal: count('SELECT COUNT(*) AS count FROM approvals'),
      audits: count('SELECT COUNT(*) AS count FROM audit'),
      auditChainValid: (await this.verifyAuditChain()).valid,
    }
  }

  close(): void { this.#db.close() }

  private assertTenant(request: ActionRequest, context: ToolContext): void {
    if (request.tenantId !== context.tenantId) throw new ToolGatewayError(403, 'TENANT_MISMATCH', 'request tenant does not match authenticated tenant')
  }

  private async audit(request: ActionRequest, decision: string, result: unknown, approvalId?: string, approverId?: string): Promise<void> {
    const id = randomUUID()
    const createdAt = this.#now()
    const resultJson = result === undefined ? null : JSON.stringify(result)
    const prevHash = this.#lastAuditHash ?? ''
    const hash = createHash('sha256').update(prevHash).update(JSON.stringify({ id, tenantId: request.tenantId, ticketId: request.ticketId, actionClass: request.actionClass, system: request.system, decision, approvalId: approvalId ?? null, approverId: approverId ?? null, resultJson, createdAt })).digest('hex')
    if (this.#storage !== undefined) {
      await this.#storage.query('INSERT INTO tg_audit (id, tenant_id, ticket_id, action_class, system, decision, approval_id, approver_id, result_json, created_at, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [id, request.tenantId, request.ticketId, request.actionClass, request.system, decision, approvalId ?? null, approverId ?? null, resultJson, createdAt, prevHash, hash])
      this.#lastAuditHash = hash
      return
    }
    this.#db.prepare('INSERT INTO audit (id, tenant_id, ticket_id, action_class, system, decision, approval_id, approver_id, result_json, created_at, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, request.tenantId, request.ticketId, request.actionClass, request.system, decision,
        approvalId ?? null, approverId ?? null, resultJson, createdAt, prevHash, hash)
    this.#lastAuditHash = hash
  }

  /** Verify the append-only audit hash chain. */
  async verifyAuditChain(): Promise<{ valid: boolean; checked: number; brokenAt?: string }> {
    const rows = this.#storage !== undefined
      ? (await this.#storage.query<Record<string, unknown>>('SELECT * FROM tg_audit ORDER BY created_at, id')).rows
      : this.#db.prepare('SELECT * FROM audit ORDER BY created_at, rowid').all() as Array<Record<string, unknown>>
    let previous = ''
    for (const row of rows) {
      const expected = createHash('sha256').update(previous).update(JSON.stringify({
        id: row.id, tenantId: row.tenant_id, ticketId: row.ticket_id, actionClass: row.action_class, system: row.system,
        decision: row.decision, approvalId: row.approval_id ?? null, approverId: row.approver_id ?? null,
        resultJson: row.result_json ?? null, createdAt: Number(row.created_at),
      })).digest('hex')
      if (row.prev_hash !== previous || row.hash !== expected) return { valid: false, checked: rows.length, brokenAt: String(row.id) }
      previous = expected
    }
    return { valid: true, checked: rows.length }
  }

  async propose(requestInput: ActionRequest, context: ToolContext): Promise<{
    status: 'executed' | 'pending'
    approvalId?: string
    result?: unknown
  }> {
    const request = ActionRequestSchema.parse(requestInput)
    this.assertTenant(request, context)
    if (!this.#options.policyEnabled) {
      await this.audit(request, 'deny:policy-unavailable', undefined)
      throw new ToolGatewayError(503, 'POLICY_UNAVAILABLE', 'policy service unavailable; action denied')
    }
    let decision = decidePolicy(request)
    let tenantPolicy: 'approval' | 'deny' | undefined
    if (this.#storage !== undefined) {
      tenantPolicy = (await this.#storage.query<{ effect: 'approval' | 'deny' }>('SELECT effect FROM tg_tenant_tool_policies WHERE tenant_id = ? AND action_class = ?', [request.tenantId, request.actionClass])).rows[0]?.effect
    } else {
      tenantPolicy = (this.#db.prepare('SELECT effect FROM tenant_tool_policies WHERE tenant_id = ? AND action_class = ?').get(request.tenantId, request.actionClass) as { effect: 'approval' | 'deny' } | undefined)?.effect
    }
    if (tenantPolicy === 'deny') decision = { kind: 'deny', reason: 'tenant_policy' }
    else if (tenantPolicy === 'approval' && decision.kind !== 'deny') decision = { kind: 'approval', reason: 'tenant_policy', risk: 'high' }
    if (decision.kind === 'deny') {
      await this.audit(request, `deny:${decision.reason}`, undefined)
      throw new ToolGatewayError(403, 'POLICY_DENIED', decision.reason)
    }
    if (decision.kind === 'approval') {
      const approvalId = randomUUID()
      if (this.#storage !== undefined) {
        await this.#storage.query('INSERT INTO tg_approvals (id, tenant_id, ticket_id, request_json, status, risk, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [approvalId, request.tenantId, request.ticketId, JSON.stringify(request), 'pending', decision.risk, this.#now() + this.#options.approvalTtlMs, this.#now()])
      } else {
        this.#db.prepare('INSERT INTO approvals (id, tenant_id, ticket_id, request_json, status, risk, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(approvalId, request.tenantId, request.ticketId, JSON.stringify(request), 'pending', decision.risk, this.#now() + this.#options.approvalTtlMs, this.#now())
      }
      await this.audit(request, `pending:${decision.reason}`, undefined, approvalId)
      return { status: 'pending', approvalId }
    }
    const result = await this.execute(request)
    await this.audit(request, `allow:${decision.reason}`, result)
    return { status: 'executed', result }
  }

  async listToolPolicies(tenantId: string): Promise<Array<{ actionClass: string; effect: 'approval' | 'deny' }>> {
    const rows: Array<{ action_class: string; effect: 'approval' | 'deny' }> = this.#storage !== undefined
      ? (await this.#storage.query<{ action_class: string; effect: 'approval' | 'deny' }>('SELECT action_class, effect FROM tg_tenant_tool_policies WHERE tenant_id = ? ORDER BY action_class', [tenantId])).rows
      : this.#db.prepare('SELECT action_class, effect FROM tenant_tool_policies WHERE tenant_id = ? ORDER BY action_class').all(tenantId) as Array<{ action_class: string; effect: 'approval' | 'deny' }>
    return rows.map(row => ({ actionClass: row.action_class, effect: row.effect }))
  }

  async setToolPolicy(tenantId: string, actionClass: string, effect: 'approval' | 'deny'): Promise<void> {
    if (this.#storage !== undefined) {
      await this.#storage.query('INSERT INTO tg_tenant_tool_policies (tenant_id, action_class, effect, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (tenant_id, action_class) DO UPDATE SET effect = EXCLUDED.effect, updated_at = EXCLUDED.updated_at', [tenantId, actionClass, effect, this.#now()])
      return
    }
    this.#db.prepare('INSERT OR REPLACE INTO tenant_tool_policies (tenant_id, action_class, effect, updated_at) VALUES (?, ?, ?, ?)').run(tenantId, actionClass, effect, this.#now())
  }

  async deleteToolPolicy(tenantId: string, actionClass: string): Promise<void> {
    if (this.#storage !== undefined) {
      await this.#storage.query('DELETE FROM tg_tenant_tool_policies WHERE tenant_id = ? AND action_class = ?', [tenantId, actionClass])
      return
    }
    this.#db.prepare('DELETE FROM tenant_tool_policies WHERE tenant_id = ? AND action_class = ?').run(tenantId, actionClass)
  }

  private async execute(request: ActionRequest): Promise<unknown> {
    const connector = this.#options.connectors[request.system]
    if (connector === undefined) throw new ToolGatewayError(404, 'CONNECTOR_NOT_FOUND', request.system)
    const credential = this.#options.credentialProvider === undefined
      ? this.#options.credentials?.[request.system]
      : await this.#options.credentialProvider.get(request.system)
    const result = await connector.execute(request, credential)
    this.#executed.push(request)
    return result
  }

  async listApprovals(tenantId: string): Promise<Array<{
    approvalId: string; ticketId: string; title: string; detail: string; risk: string; status: string; expiresAt: string
  }>> {
    let rows: ApprovalRow[]
    if (this.#storage !== undefined) {
      await this.#storage.query("UPDATE tg_approvals SET status = 'expired', decided_at = ? WHERE tenant_id = ? AND status = 'pending' AND expires_at < ?", [this.#now(), tenantId, this.#now()])
      rows = (await this.#storage.query<ApprovalRow>('SELECT * FROM tg_approvals WHERE tenant_id = ? ORDER BY created_at, id', [tenantId])).rows
    } else {
      this.#db.prepare("UPDATE approvals SET status = 'expired', decided_at = ? WHERE tenant_id = ? AND status = 'pending' AND expires_at < ?").run(this.#now(), tenantId, this.#now())
      rows = this.#db.prepare('SELECT * FROM approvals WHERE tenant_id = ? ORDER BY created_at, rowid').all(tenantId) as unknown as ApprovalRow[]
    }
    return rows.map(row => {
      const request = JSON.parse(row.request_json) as ActionRequest
      return {
        approvalId: row.id,
        ticketId: row.ticket_id,
        title: `${request.system}: ${request.actionClass}`,
        detail: `${request.target}${request.content === undefined ? '' : `\n${request.content}`}`,
        risk: row.risk,
        status: row.status,
        expiresAt: new Date(Number(row.expires_at)).toISOString(),
      }
    })
  }

  async decide(approvalId: string, approved: boolean, context: ToolContext): Promise<{ status: string; result?: unknown }> {
    const row = this.#storage !== undefined
      ? (await this.#storage.query<ApprovalRow>('SELECT * FROM tg_approvals WHERE id = ? AND tenant_id = ?', [approvalId, context.tenantId])).rows[0]
      : this.#db.prepare('SELECT * FROM approvals WHERE id = ? AND tenant_id = ?').get(approvalId, context.tenantId) as unknown as ApprovalRow | undefined
    if (row === undefined) throw new ToolGatewayError(404, 'APPROVAL_NOT_FOUND', approvalId)
    if (row.status !== 'pending') throw new ToolGatewayError(409, 'APPROVAL_SETTLED', row.status)
    if (Number(row.expires_at) < this.#now()) {
      if (this.#storage !== undefined) await this.#storage.query('UPDATE tg_approvals SET status = ?, decided_at = ? WHERE id = ?', ['expired', this.#now(), approvalId])
      else this.#db.prepare('UPDATE approvals SET status = ?, decided_at = ? WHERE id = ?').run('expired', this.#now(), approvalId)
      return { status: 'expired' }
    }
    if (context.role === 'member' && row.approver_id !== null && row.approver_id !== context.approverId) {
      throw new ToolGatewayError(403, 'APPROVER_NOT_ALLOWED', 'another member owns this approval')
    }
    const request = JSON.parse(row.request_json) as ActionRequest
    if (!approved) {
      if (this.#storage !== undefined) await this.#storage.query('UPDATE tg_approvals SET status = ?, approver_id = ?, decided_at = ? WHERE id = ?', ['rejected', context.approverId ?? context.operatorId, this.#now(), approvalId])
      else this.#db.prepare('UPDATE approvals SET status = ?, approver_id = ?, decided_at = ? WHERE id = ?').run('rejected', context.approverId ?? context.operatorId, this.#now(), approvalId)
      await this.audit(request, 'rejected:human', undefined, approvalId, context.approverId ?? context.operatorId)
      await this.#options.onApprovalDecided?.({ approvalId, tenantId: request.tenantId, ticketId: request.ticketId, status: 'rejected', request })
      return { status: 'rejected' }
    }
    const result = await this.execute(request)
    if (this.#storage !== undefined) await this.#storage.query('UPDATE tg_approvals SET status = ?, approver_id = ?, decided_at = ? WHERE id = ?', ['approved', context.approverId ?? context.operatorId, this.#now(), approvalId])
    else this.#db.prepare('UPDATE approvals SET status = ?, approver_id = ?, decided_at = ? WHERE id = ?').run('approved', context.approverId ?? context.operatorId, this.#now(), approvalId)
    await this.audit(request, 'approved:human', result, approvalId, context.approverId ?? context.operatorId)
    await this.#options.onApprovalDecided?.({ approvalId, tenantId: request.tenantId, ticketId: request.ticketId, status: 'approved', request })
    return { status: 'approved', result }
  }

  async auditForTenant(tenantId: string): Promise<unknown[]> {
    const rows: Array<Record<string, unknown>> = this.#storage !== undefined
      ? (await this.#storage.query<Record<string, unknown>>('SELECT * FROM tg_audit WHERE tenant_id = ? ORDER BY created_at, id', [tenantId])).rows
      : this.#db.prepare('SELECT * FROM audit WHERE tenant_id = ? ORDER BY created_at, rowid').all(tenantId) as Array<Record<string, unknown>>
    return rows.map(row => ({ ...row }))
  }

  async auditSummary(tenantId: string): Promise<{ total: number; decisions: Record<string, number> }> {
    const rows: Array<{ decision: string; count: number }> = this.#storage !== undefined
      ? (await this.#storage.query<{ decision: string; count: string | number }>('SELECT decision, COUNT(*) AS count FROM tg_audit WHERE tenant_id = ? GROUP BY decision', [tenantId])).rows.map(row => ({ decision: row.decision, count: Number(row.count) }))
      : this.#db.prepare('SELECT decision, COUNT(*) AS count FROM audit WHERE tenant_id = ? GROUP BY decision').all(tenantId) as Array<{ decision: string; count: number }>
    const decisions: Record<string, number> = {}
    for (const row of rows) decisions[row.decision] = row.count
    return { total: rows.reduce((sum, row) => sum + row.count, 0), decisions }
  }

  async auditForTicket(ticketId: string, tenantId?: string): Promise<unknown[]> {
    const rows = this.#storage !== undefined
      ? (await this.#storage.query<Record<string, unknown>>(tenantId === undefined ? 'SELECT * FROM tg_audit WHERE ticket_id = ? ORDER BY created_at, id' : 'SELECT * FROM tg_audit WHERE ticket_id = ? AND tenant_id = ? ORDER BY created_at, id', tenantId === undefined ? [ticketId] : [ticketId, tenantId])).rows
      : tenantId === undefined
        ? this.#db.prepare('SELECT * FROM audit WHERE ticket_id = ? ORDER BY created_at, rowid').all(ticketId)
        : this.#db.prepare('SELECT * FROM audit WHERE ticket_id = ? AND tenant_id = ? ORDER BY created_at, rowid').all(ticketId, tenantId)
    return (rows as Array<Record<string, unknown>>).map(row => ({ ...row }))
  }

  executed(): readonly ActionRequest[] { return this.#executed }
}

/**
 * Single-tenant Bot service.
 *
 * SQLite remains the offline/single-box backend. When `storage` is supplied,
 * ticket/assignment/event/input/outbox reads and writes go to PostgreSQL.
 */
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import type { Storage } from '@siriusx/storage'
import {
  type Assignment,
  type AssignmentEvent,
  type CreateAssignment,
  type Workspace,
} from '@siriusx/contracts/executor'
import { deriveTicketStage, readyNeedsReview, type TicketStage } from '@siriusx/contracts/ticket-stage'
import type { LocalExecutor } from '@siriusx/executor-local'
import type { AnalyticsCollector, AnalyticsEvent } from '@siriusx/analytics'

export interface CreateTicketInput {
  readonly tenantId: string
  readonly workspace: Workspace
  readonly prompt: string
  readonly modelId?: string
  readonly now?: number
}

export interface TicketView {
  readonly ticketId: string
  readonly title: string
  readonly stage: TicketStage
  readonly closed: boolean
  readonly latestAssignment: Assignment | undefined
  readonly pendingInputs: number
}

interface TicketRow extends Record<string, unknown> {
  readonly id: string
  readonly tenant_id: string
  readonly workspace_json: string
  readonly prompt: string
  readonly model_id: string
  readonly closed: number
  readonly created_at: number | string
}

interface AssignmentRow extends Record<string, unknown> {
  readonly id: string
  readonly tenant_id: string
  readonly ticket_id: string
  readonly kind: 'start' | 'resume'
  readonly workdir_key: string
  readonly state: Assignment['state']
  readonly report_json: string | null
  readonly last_seq: number | string
  readonly created_at: number | string
}

interface InputRow extends Record<string, unknown> {
  readonly id: string
  readonly ticket_id: string
  readonly text: string
  readonly author: string
  readonly consumed_by: string | null
  readonly created_at: number | string
}

const TERMINAL_STATES = new Set<Assignment['state']>(['reported', 'cancelled', 'lost'])
export const BOT_SCHEMA = `
CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  workspace_json TEXT NOT NULL,
  prompt TEXT NOT NULL,
  model_id TEXT NOT NULL,
  closed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS assignments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL REFERENCES tickets(id),
  kind TEXT NOT NULL,
  workdir_key TEXT NOT NULL,
  state TEXT NOT NULL,
  report_json TEXT,
  last_seq INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS assignments_ticket ON assignments(ticket_id, created_at);
CREATE TABLE IF NOT EXISTS assignment_events (
  assignment_id TEXT NOT NULL REFERENCES assignments(id),
  seq INTEGER NOT NULL,
  event_json TEXT NOT NULL,
  PRIMARY KEY (assignment_id, seq)
);
CREATE TABLE IF NOT EXISTS pending_inputs (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id),
  text TEXT NOT NULL,
  author TEXT NOT NULL,
  consumed_by TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pending_ticket ON pending_inputs(ticket_id, consumed_by, created_at);
CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id),
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  delivered_at INTEGER
);
`

function parseWorkspace(row: TicketRow): Workspace {
  return JSON.parse(row.workspace_json) as Workspace
}

function parseReport(row: AssignmentRow): Assignment['report'] | undefined {
  return row.report_json === null ? undefined : JSON.parse(row.report_json) as Assignment['report']
}

function toAssignment(row: AssignmentRow): Assignment {
  const report = parseReport(row)
  return {
    tenantId: row.tenant_id,
    assignmentId: row.id as never,
    ticketId: row.ticket_id,
    workdirKey: row.workdir_key,
    kernel: 'dsh',
    state: row.state,
    lastSeq: Number(row.last_seq),
    ...(report === undefined ? {} : { report }),
  }
}

export interface BotServiceOptions {
  readonly dbPath: string
  readonly storage?: Storage
  readonly executor: LocalExecutor
  readonly now?: () => number
  /** Sliding input window in milliseconds; 0 flushes synchronously for tests. */
  readonly inputDebounceMs?: number
  /** Hard cap from the first input in a debounce burst. */
  readonly inputDebounceMaxWaitMs?: number
  readonly analytics?: AnalyticsCollector
  readonly analyticsBotId?: string
  /** Retry tickets whose latest assignment was reconciled as lost. */
  readonly autoRetryLost?: boolean
}

export class BotService {
  readonly #db: DatabaseSync
  readonly #storage: Storage | undefined
  readonly #executor: LocalExecutor
  readonly #now: () => number
  readonly #inFlight = new Map<string, Promise<TicketView>>()
  readonly #active = new Map<string, string>()
  readonly #debounce = new Map<string, { timer: ReturnType<typeof setTimeout>; maxTimer: ReturnType<typeof setTimeout> }>()
  readonly #inputDebounceMs: number
  readonly #inputDebounceMaxWaitMs: number
  readonly #analytics: AnalyticsCollector | undefined
  readonly #analyticsBotId: string
  readonly #autoRetryLost: boolean
  #analyticsSeq = 0
  readonly #analyticsSeen = new Set<string>()
  readonly #analyticsStates = new Map<string, Assignment['state']>()
  readonly #retriedLost = new Set<string>()

  constructor(options: BotServiceOptions) {
    this.#db = new DatabaseSync(options.dbPath)
    this.#db.exec(BOT_SCHEMA)
    this.#storage = options.storage
    this.#executor = options.executor
    this.#now = options.now ?? Date.now
    this.#inputDebounceMs = options.inputDebounceMs ?? 0
    this.#inputDebounceMaxWaitMs = options.inputDebounceMaxWaitMs ?? 60_000
    this.#analytics = options.analytics
    this.#analyticsBotId = options.analyticsBotId ?? 'bot-local'
    this.#autoRetryLost = options.autoRetryLost === true
  }

  async initialize(): Promise<void> {
    await this.reconcile()
    if (this.#autoRetryLost) await this.retryLost()
  }

  close(): void {
    for (const entry of this.#debounce.values()) {
      clearTimeout(entry.timer)
      clearTimeout(entry.maxTimer)
    }
    this.#debounce.clear()
    this.#db.close()
  }

  #storageSql(sql: string): string {
    if (this.#storage === undefined) return sql
    return sql
      .replace(/\bassignment_events\b/gu, 'autobot_assignment_events')
      .replace(/\bpending_inputs\b/gu, 'autobot_pending_inputs')
      .replace(/\bassignments\b/gu, 'autobot_assignments')
      .replace(/\btickets\b/gu, 'autobot_tickets')
      .replace(/\boutbox\b/gu, 'autobot_outbox')
  }

  private async rows<Row extends Record<string, unknown>>(sql: string, parameters: readonly unknown[] = []): Promise<Row[]> {
    if (this.#storage !== undefined) return (await this.#storage.query<Row>(this.#storageSql(sql), parameters)).rows
    return this.#db.prepare(sql).all(...(parameters as never[])) as Row[]
  }

  private async first<Row extends Record<string, unknown>>(sql: string, parameters: readonly unknown[] = []): Promise<Row | undefined> {
    if (this.#storage !== undefined) return (await this.#storage.query<Row>(this.#storageSql(sql), parameters)).rows[0]
    return this.#db.prepare(sql).get(...(parameters as never[])) as Row | undefined
  }

  private async run(sql: string, parameters: readonly unknown[] = []): Promise<number> {
    if (this.#storage !== undefined) return (await this.#storage.query(this.#storageSql(sql), parameters)).rowCount
    return Number(this.#db.prepare(sql).run(...(parameters as never[])).changes)
  }

  /** Retry open tickets whose newest assignment was reconciled as lost. */
  async retryLost(): Promise<string[]> {
    const rows = await this.rows<{ id: string }>('SELECT id FROM tickets WHERE closed = 0 ORDER BY created_at, id')
    const retried: string[] = []
    for (const row of rows) {
      if (this.#retriedLost.has(row.id) || this.#inFlight.has(row.id)) continue
      if ((await this.latestAssignmentRow(row.id))?.state !== 'lost') continue
      this.#retriedLost.add(row.id)
      retried.push(row.id)
      await this.dispatch(row.id).catch(() => undefined)
    }
    return retried
  }

  /** Mark assignments that no longer have an Executor owner as lost. */
  async reconcile(): Promise<number> {
    const rows = await this.rows<AssignmentRow>("SELECT * FROM assignments WHERE state NOT IN ('reported','cancelled','lost')")
    for (const row of rows) {
      await this.run('UPDATE assignments SET state = ? WHERE id = ?', ['lost', row.id])
      await this.run('INSERT INTO outbox (id, ticket_id, kind, payload_json, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING', [randomUUID(), row.ticket_id, 'assignment-lost', JSON.stringify({ assignmentId: row.id }), this.#now()])
    }
    return rows.length
  }

  async createTicket(input: CreateTicketInput): Promise<string> {
    const id = randomUUID()
    await this.run('INSERT INTO tickets (id, tenant_id, workspace_json, prompt, model_id, closed, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)', [id, input.tenantId, JSON.stringify(input.workspace), input.prompt, input.modelId ?? 'siriusx-mock', input.now ?? this.#now()])
    return id
  }

  async getTicket(ticketId: string): Promise<TicketView> {
    const ticket = await this.first<TicketRow>('SELECT * FROM tickets WHERE id = ?', [ticketId])
    if (ticket === undefined) throw new Error(`ticket ${ticketId} not found`)
    const latest = await this.latestAssignmentRow(ticketId)
    const pending = await this.pendingInputRows(ticketId)
    const latestState = latest === undefined ? undefined : {
      state: latest.state,
      reportKind: parseReport(latest)?.kind,
    }
    const stage = Number(ticket.closed) === 1 ? 'idle' : deriveTicketStage({
      deliveryFailing: false,
      ...(latestState === undefined ? {} : { latest: latestState }),
      pendingInput: pending.length > 0,
    })
    return {
      ticketId,
      title: ticket.prompt.slice(0, 120),
      stage,
      closed: Number(ticket.closed) === 1,
      latestAssignment: latest === undefined ? undefined : toAssignment(latest),
      pendingInputs: pending.length,
    }
  }

  async listTickets(): Promise<TicketView[]> {
    const rows = await this.rows<{ id: string }>('SELECT id FROM tickets ORDER BY created_at, id')
    return Promise.all(rows.map(row => this.getTicket(row.id)))
  }

  async eventsForTicket(ticketId: string): Promise<AssignmentEvent[]> {
    const latest = await this.latestAssignmentRow(ticketId)
    if (latest === undefined) return []
    const rows = await this.rows<{ event_json: string }>('SELECT event_json FROM assignment_events WHERE assignment_id = ? ORDER BY seq', [latest.id])
    return rows.map(row => JSON.parse(row.event_json) as AssignmentEvent)
  }

  async cancelTicket(ticketId: string): Promise<TicketView> {
    const latest = await this.latestAssignmentRow(ticketId)
    if (latest !== undefined && !TERMINAL_STATES.has(latest.state)) {
      await this.#executor.cancelAssignment(latest.id, 'graceful')
      await this.recordAssignment(this.#executor.getAssignment(latest.id), this.#executor.streamEventsForBot(latest.id, 0).events)
    }
    return this.getTicket(ticketId)
  }

  private async latestAssignmentRow(ticketId: string): Promise<AssignmentRow | undefined> {
    return this.first<AssignmentRow>('SELECT * FROM assignments WHERE ticket_id = ? ORDER BY created_at DESC, id DESC LIMIT 1', [ticketId])
  }

  private async pendingInputRows(ticketId: string): Promise<InputRow[]> {
    return this.rows<InputRow>('SELECT * FROM pending_inputs WHERE ticket_id = ? AND consumed_by IS NULL ORDER BY created_at, id', [ticketId])
  }

  private async assignmentCount(ticketId: string): Promise<number> {
    const row = await this.first<{ count: number | string }>('SELECT COUNT(*) AS count FROM assignments WHERE ticket_id = ?', [ticketId])
    return Number(row?.count ?? 0)
  }

  private async emitAnalytics(input: {
    ticketId: string
    assignmentId?: string
    schema: AnalyticsEvent['schema']
    source: AnalyticsEvent['source']
    payload: Record<string, unknown>
    workspaceKind?: 'local_dir' | 'cloud_project'
  }): Promise<void> {
    if (this.#analytics === undefined) return
    const ticket = await this.first<{ tenant_id: string }>('SELECT tenant_id FROM tickets WHERE id = ?', [input.ticketId])
    if (ticket === undefined) return
    const seq = this.#analyticsSeq++
    const event: AnalyticsEvent = {
      eventId: randomUUID(),
      schema: input.schema,
      schemaVersion: 1,
      occurredAt: new Date(this.#now()).toISOString(),
      seq,
      tenantId: ticket.tenant_id,
      botId: this.#analyticsBotId,
      ticketId: input.ticketId,
      ...(input.assignmentId === undefined ? {} : { assignmentId: input.assignmentId }),
      traceId: input.ticketId,
      spanId: `span-${seq}`,
      source: input.source,
      ...(input.workspaceKind === undefined ? {} : { workspaceKind: input.workspaceKind }),
      variant: {
        promptVersion: 's3',
        policyVersion: 's3',
        model: 'unknown',
        kernel: 'dsh',
        kernelVersion: '0.2.2',
        featureFlags: {},
      },
      payload: input.payload,
    }
    void this.#analytics.record(event).catch(() => undefined)
  }

  private async emitAssignmentAnalytics(assignment: Assignment, events: readonly AssignmentEvent[]): Promise<void> {
    for (const event of events) {
      const dedupe = `${assignment.assignmentId}:${event.seq}:${event.type}`
      if (this.#analyticsSeen.has(dedupe)) continue
      this.#analyticsSeen.add(dedupe)
      if (event.type === 'state') {
        const from = this.#analyticsStates.get(assignment.assignmentId) ?? 'preparing'
        this.#analyticsStates.set(assignment.assignmentId, event.state)
        await this.emitAnalytics({ ticketId: assignment.ticketId, assignmentId: assignment.assignmentId, schema: 'assignment.state_changed', source: 'executor', payload: { from, to: event.state, reasonClass: 'executor' } })
      } else if (event.type === 'report') {
        await this.emitAnalytics({ ticketId: assignment.ticketId, assignmentId: assignment.assignmentId, schema: 'report.produced', source: 'executor', payload: { reportKind: event.report.kind, ...(event.report.kind === 'ready' ? { filesChanged: event.report.diffStats.filesChanged, insertions: event.report.diffStats.insertions, deletions: event.report.diffStats.deletions, hasChangeRequest: event.report.changeRequest !== undefined } : {}) } })
      } else if (event.type === 'activity') {
        if (event.kind === 'tool') {
          await this.emitAnalytics({ ticketId: assignment.ticketId, assignmentId: assignment.assignmentId, schema: 'tool.called', source: 'executor', payload: { toolName: event.name, durationMs: event.durationMs, resultClass: event.resultClass, ...(event.inputBytes === undefined ? {} : { inputBytes: event.inputBytes }), ...(event.outputBytes === undefined ? {} : { outputBytes: event.outputBytes }) } })
        } else {
          await this.emitAnalytics({ ticketId: assignment.ticketId, assignmentId: assignment.assignmentId, schema: 'model.called', source: 'executor', payload: { model: 'unknown', provider: 'executor', durationMs: event.durationMs, resultClass: event.resultClass, ...(event.usage === undefined ? {} : { inputTokens: event.usage.inputTokens, outputTokens: event.usage.outputTokens, ...(event.usage.cachedTokens === undefined ? {} : { cachedTokens: event.usage.cachedTokens }) }) } })
        }
      }
    }
  }

  private async recordAssignment(assignment: Assignment, events: readonly AssignmentEvent[]): Promise<void> {
    await this.run(`
      INSERT INTO assignments (id, tenant_id, ticket_id, kind, workdir_key, state, report_json, last_seq, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET state = excluded.state, report_json = excluded.report_json, last_seq = excluded.last_seq
    `, [assignment.assignmentId, assignment.tenantId, assignment.ticketId, (await this.assignmentCount(assignment.ticketId)) === 0 ? 'start' : 'resume', assignment.workdirKey, assignment.state, assignment.report === undefined ? null : JSON.stringify(assignment.report), assignment.lastSeq, this.#now()])
    for (const event of events) {
      await this.run('INSERT INTO assignment_events (assignment_id, seq, event_json) VALUES (?, ?, ?) ON CONFLICT (assignment_id, seq) DO NOTHING', [assignment.assignmentId, event.seq, JSON.stringify(event)])
    }
    await this.emitAssignmentAnalytics(assignment, events)
  }

  private buildAssignment(ticketId: string, ticket: TicketRow, kind: 'start' | 'resume', followUps: readonly InputRow[]): CreateAssignment {
    const workspace = parseWorkspace(ticket)
    return {
      tenantId: ticket.tenant_id,
      assignmentId: randomUUID(),
      ticketId,
      kind,
      priority: 'human',
      workspace,
      model: { source: workspace.kind === 'local_dir' ? 'local' : 'tenant', id: ticket.model_id },
      workdirKey: ticketId,
      input: {
        prompt: kind === 'start' ? ticket.prompt : 'Continue the ticket from the previous report.',
        followUps: followUps.map(input => ({ source: 'human', author: input.author, text: input.text, triggerId: input.id })),
      },
      secretRefs: [],
      traceId: ticketId,
      clientContext: { operatorId: 'app:local-user', channel: 'app', platform: 'desktop' },
    }
  }

  async dispatch(ticketId: string): Promise<TicketView> {
    const pending = this.#inFlight.get(ticketId)
    if (pending !== undefined) return pending
    const latest = await this.latestAssignmentRow(ticketId)
    if (latest !== undefined && !TERMINAL_STATES.has(latest.state)) return this.getTicket(ticketId)
    const promise = this.#dispatch(ticketId).finally(() => { this.#inFlight.delete(ticketId) })
    this.#inFlight.set(ticketId, promise)
    return promise
  }

  async #dispatch(ticketId: string): Promise<TicketView> {
    const ticket = await this.first<TicketRow>('SELECT * FROM tickets WHERE id = ?', [ticketId])
    if (ticket === undefined) throw new Error(`ticket ${ticketId} not found`)
    if (Number(ticket.closed) === 1) return this.getTicket(ticketId)
    const pending = await this.pendingInputRows(ticketId)
    const kind = (await this.assignmentCount(ticketId)) === 0 ? 'start' : 'resume'
    const request = this.buildAssignment(ticketId, ticket, kind, pending)
    const assignment = await this.#executor.createAssignment(request)
    this.#active.set(ticketId, assignment.assignmentId)
    await this.recordAssignment(assignment, this.#executor.streamEventsForBot(assignment.assignmentId, 0).events)
    for (const input of pending) await this.run('UPDATE pending_inputs SET consumed_by = ? WHERE id = ?', [assignment.assignmentId, input.id])
    const completed = await this.#executor.wait(assignment.assignmentId)
    await this.recordAssignment(completed, this.#executor.streamEventsForBot(assignment.assignmentId, 0).events)
    this.#active.delete(ticketId)
    if (completed.report !== undefined) {
      await this.run('INSERT INTO outbox (id, ticket_id, kind, payload_json, created_at) VALUES (?, ?, ?, ?, ?)', [randomUUID(), ticketId, 'report', JSON.stringify(completed.report), this.#now()])
      if (completed.report.kind === 'ready' && !readyNeedsReview({ changeRequest: completed.report.changeRequest !== undefined, filesChanged: completed.report.diffStats.filesChanged, livePreviews: 0 })) {
        await this.run('UPDATE tickets SET closed = 1 WHERE id = ?', [ticketId])
      }
    }
    return this.getTicket(ticketId)
  }

  async sendInput(ticketId: string, text: string, author = 'app:local-user'): Promise<TicketView> {
    const ticket = await this.first<TicketRow>('SELECT * FROM tickets WHERE id = ?', [ticketId])
    if (ticket === undefined) throw new Error(`ticket ${ticketId} not found`)
    await this.emitAnalytics({ ticketId, schema: 'human.input', source: 'app', payload: { kind: 'input', state: 'received', textLength: text.length } })
    const inputId = randomUUID()
    await this.run('INSERT INTO pending_inputs (id, ticket_id, text, author, consumed_by, created_at) VALUES (?, ?, ?, ?, NULL, ?)', [inputId, ticketId, text, author, this.#now()])
    if (this.#inputDebounceMs <= 0) return this.flushInput(ticketId)
    const previous = this.#debounce.get(ticketId)
    if (previous !== undefined) clearTimeout(previous.timer)
    const timer = setTimeout(() => { void this.flushInput(ticketId).catch(() => undefined) }, this.#inputDebounceMs)
    const maxTimer = previous?.maxTimer ?? setTimeout(() => { void this.flushInput(ticketId).catch(() => undefined) }, this.#inputDebounceMaxWaitMs)
    this.#debounce.set(ticketId, { timer, maxTimer })
    return this.getTicket(ticketId)
  }

  /** Cancel the active Assignment (if any), then dispatch one resume. */
  async flushInput(ticketId: string): Promise<TicketView> {
    const entry = this.#debounce.get(ticketId)
    if (entry !== undefined) {
      clearTimeout(entry.timer)
      clearTimeout(entry.maxTimer)
      this.#debounce.delete(ticketId)
    }
    const latest = await this.latestAssignmentRow(ticketId)
    if (latest !== undefined && !TERMINAL_STATES.has(latest.state)) {
      await this.#executor.cancelAssignment(latest.id, 'graceful')
      await this.recordAssignment(this.#executor.getAssignment(latest.id), this.#executor.streamEventsForBot(latest.id, 0).events)
    }
    const inFlight = this.#inFlight.get(ticketId)
    if (inFlight !== undefined) await inFlight.catch(() => undefined)
    return this.dispatch(ticketId)
  }
}

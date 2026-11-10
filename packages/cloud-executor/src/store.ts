/** Durable assignment/event store for the CloudExecutor watchdog. */
import { DatabaseSync } from 'node:sqlite'
import { AssignmentSchema, type Assignment, type AssignmentEvent } from '@siriusx/contracts/executor'

export interface StoredAssignment {
  readonly assignment: Assignment
  readonly events: readonly AssignmentEvent[]
  readonly sandboxId?: string
}

export interface AssignmentStore {
  create(assignment: Assignment, sandboxId?: string): void
  update(assignment: Assignment, sandboxId?: string): void
  get(assignmentId: string): StoredAssignment | undefined
  list(): StoredAssignment[]
  appendEvent(assignmentId: string, event: AssignmentEvent): void
  close(): void
}

interface Row {
  readonly assignment_json: string
  readonly sandbox_id: string | null
  readonly event_json: string
}

function decode(row: Pick<Row, 'assignment_json'>): Assignment {
  return AssignmentSchema.parse(JSON.parse(row.assignment_json))
}

export class MemoryAssignmentStore implements AssignmentStore {
  readonly #rows = new Map<string, { assignment: Assignment; sandboxId?: string; events: AssignmentEvent[] }>()

  create(assignment: Assignment, sandboxId?: string): void {
    this.#rows.set(assignment.assignmentId, { assignment, ...(sandboxId === undefined ? {} : { sandboxId }), events: [] })
  }

  update(assignment: Assignment, sandboxId?: string): void {
    const row = this.#rows.get(assignment.assignmentId)
    if (row === undefined) throw new Error('assignment not found')
    row.assignment = assignment
    if (sandboxId !== undefined) row.sandboxId = sandboxId
  }

  get(assignmentId: string): StoredAssignment | undefined {
    const row = this.#rows.get(assignmentId)
    return row === undefined ? undefined : { assignment: row.assignment, events: [...row.events], ...(row.sandboxId === undefined ? {} : { sandboxId: row.sandboxId }) }
  }

  list(): StoredAssignment[] {
    return [...this.#rows.values()].map(row => ({ assignment: row.assignment, events: [...row.events], ...(row.sandboxId === undefined ? {} : { sandboxId: row.sandboxId }) }))
  }

  appendEvent(assignmentId: string, event: AssignmentEvent): void {
    const row = this.#rows.get(assignmentId)
    if (row === undefined) throw new Error('assignment not found')
    row.events.push(event)
  }

  close(): void {}
}

export class SqliteAssignmentStore implements AssignmentStore {
  readonly #db: DatabaseSync

  constructor(path: string) {
    this.#db = new DatabaseSync(path)
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS assignments (
        assignment_id TEXT PRIMARY KEY,
        assignment_json TEXT NOT NULL,
        sandbox_id TEXT,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS assignment_events (
        assignment_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        event_json TEXT NOT NULL,
        PRIMARY KEY (assignment_id, seq)
      );
    `)
  }

  create(assignment: Assignment, sandboxId?: string): void {
    this.#db.prepare('INSERT INTO assignments (assignment_id, assignment_json, sandbox_id, updated_at) VALUES (?, ?, ?, ?)')
      .run(assignment.assignmentId, JSON.stringify(assignment), sandboxId ?? null, Date.now())
  }

  update(assignment: Assignment, sandboxId?: string): void {
    this.#db.prepare('UPDATE assignments SET assignment_json = ?, updated_at = ?, sandbox_id = COALESCE(?, sandbox_id) WHERE assignment_id = ?')
      .run(JSON.stringify(assignment), Date.now(), sandboxId ?? null, assignment.assignmentId)
  }

  appendEvent(assignmentId: string, event: AssignmentEvent): void {
    this.#db.prepare('INSERT OR REPLACE INTO assignment_events (assignment_id, seq, event_json) VALUES (?, ?, ?)')
      .run(assignmentId, event.seq, JSON.stringify(event))
  }

  get(assignmentId: string): StoredAssignment | undefined {
    const row = this.#db.prepare('SELECT assignment_json, sandbox_id FROM assignments WHERE assignment_id = ?').get(assignmentId) as
      | { assignment_json: string; sandbox_id: string | null } | undefined
    if (row === undefined) return undefined
    const events = (this.#db.prepare('SELECT event_json FROM assignment_events WHERE assignment_id = ? ORDER BY seq').all(assignmentId) as Array<{ event_json: string }>)
      .map(event => JSON.parse(event.event_json) as AssignmentEvent)
    return { assignment: decode(row), events, ...(row.sandbox_id === null ? {} : { sandboxId: row.sandbox_id }) }
  }

  list(): StoredAssignment[] {
    const rows = this.#db.prepare('SELECT assignment_id FROM assignments ORDER BY updated_at').all() as Array<{ assignment_id: string }>
    return rows.map(row => this.get(row.assignment_id)!).filter(Boolean)
  }

  close(): void { this.#db.close() }
}

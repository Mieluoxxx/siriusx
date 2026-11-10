/**
 * In-memory Executor used by BG1 scenarios. It implements the observable
 * contract state machine and never starts a process, command, container or
 * model call.
 */
import {
  AssignmentEventSchema,
  AssignmentSchema,
  CreateAssignmentSchema,
  workspaceMismatch,
  type Assignment,
  type AssignmentEvent,
  type CreateAssignment,
  type ExecutorErrorCode,
  type Workspace,
} from '@siriusx/contracts/executor'

export class ContractError extends Error {
  readonly code: ExecutorErrorCode

  constructor(code: ExecutorErrorCode, message: string) {
    super(message)
    this.name = 'ContractError'
    this.code = code
  }
}

export interface FakeFile {
  readonly path: string
  readonly type: 'file' | 'dir' | 'symlink'
  readonly size?: number
  readonly binary?: boolean
  readonly sensitive?: boolean
  readonly content?: string
  readonly modified?: boolean
  readonly ignored?: boolean
}

export interface FakePreview {
  readonly previewId: string
  readonly workdirKey: string
  readonly port: number
  readonly url: string
  readonly pid: number
  readonly startedAt: string
  readonly lastAccessAt?: string
}

export interface FakeExecutorOptions {
  readonly capacity?: number
  readonly humanExtraSlots?: number
  readonly localOnline?: boolean
  readonly logLimitPerAssignment?: number
  readonly maxReadBytes?: number
  readonly pageSize?: number
  readonly files?: readonly FakeFile[]
  readonly now?: () => number
}

type EventInput =
  | { readonly type: 'state'; readonly state: Assignment['state'] }
  | { readonly type: 'report'; readonly report: NonNullable<Assignment['report']> }
  | { readonly type: 'log'; readonly stream: 'stdout' | 'stderr' | 'agent'; readonly chunk: string }
  | {
    readonly type: 'activity'
    readonly kind: 'tool' | 'model'
    readonly name: string
    readonly nameClass: 'builtin' | 'custom'
    readonly durationMs: number
    readonly resultClass: 'ok' | 'error' | 'denied' | 'timeout' | 'cancelled'
    readonly inputBytes?: number
    readonly outputBytes?: number
    readonly usage?: { readonly inputTokens: number; readonly outputTokens: number; readonly cachedTokens?: number }
  }

interface AssignmentRecord {
  assignment: Assignment
  readonly workspace: Workspace
  readonly events: AssignmentEvent[]
  nextSeq: number
  droppedLogs: number
  oldestLogSeq?: number
}

interface WorkdirRecord {
  readonly workspace: Workspace
  leaseExpiresAt: number
  readonly createdAt: number
}

function isTerminal(state: Assignment['state']): boolean {
  return state === 'reported' || state === 'cancelled' || state === 'lost'
}

function normalizeRelative(path: string): string {
  if (path.startsWith('/') || path.includes('\0')) throw new ContractError('PATH_OUTSIDE_WORKDIR', path)
  const normalized = path.split('/').filter(part => part !== '' && part !== '.').join('/')
  if (normalized.split('/').includes('..')) throw new ContractError('PATH_OUTSIDE_WORKDIR', path)
  return normalized
}

export class FakeExecutor {
  readonly #options: Required<Omit<FakeExecutorOptions, 'files' | 'now'>>
  readonly #now: () => number
  readonly #assignments = new Map<string, AssignmentRecord>()
  readonly #workdirs = new Map<string, WorkdirRecord>()
  readonly #previews = new Map<string, FakePreview[]>()
  readonly #files = new Map<string, FakeFile>()

  constructor(options: FakeExecutorOptions = {}) {
    this.#options = {
      capacity: options.capacity ?? 10,
      humanExtraSlots: options.humanExtraSlots ?? 1,
      localOnline: options.localOnline ?? true,
      logLimitPerAssignment: options.logLimitPerAssignment ?? 10_000,
      maxReadBytes: options.maxReadBytes ?? 1024 * 1024,
      pageSize: options.pageSize ?? 1000,
    }
    this.#now = options.now ?? Date.now
    for (const file of options.files ?? []) this.#files.set(normalizeRelative(file.path), file)
  }

  get now(): number { return this.#now() }

  private countNonTerminal(): number {
    return [...this.#assignments.values()].filter(record => !isTerminal(record.assignment.state)).length
  }

  private record(id: string): AssignmentRecord {
    const found = this.#assignments.get(id)
    if (found === undefined) throw new ContractError('ASSIGNMENT_NOT_FOUND', id)
    return found
  }

  private emit(id: string, input: EventInput): AssignmentEvent {
    const record = this.record(id)
    const seq = record.nextSeq++
    const event = AssignmentEventSchema.parse({
      ...input,
      seq,
      at: new Date(this.#now()).toISOString(),
    })
    if (event.type === 'log') {
      const logs = record.events.filter(item => item.type === 'log')
      if (logs.length >= this.#options.logLimitPerAssignment) {
        const oldest = logs[0]
        if (oldest !== undefined) {
          const index = record.events.indexOf(oldest)
          if (index >= 0) record.events.splice(index, 1)
          record.oldestLogSeq = oldest.seq
          record.droppedLogs++
        }
      }
    }
    record.events.push(event)
    record.assignment = AssignmentSchema.parse({
      ...record.assignment,
      state: event.type === 'state' ? event.state : record.assignment.state,
      report: event.type === 'report' ? event.report : record.assignment.report,
      lastSeq: seq,
    })
    return event
  }

  async create(request: CreateAssignment): Promise<Assignment> {
    const parsed = CreateAssignmentSchema.parse(request)
    const existing = this.#assignments.get(parsed.assignmentId)
    if (existing !== undefined) return existing.assignment

    if (parsed.workspace.kind === 'local_dir' && !this.#options.localOnline) {
      throw new ContractError('EXECUTOR_OFFLINE', 'local executor is offline')
    }
    const live = this.countNonTerminal()
    if (live >= this.#options.capacity + (parsed.priority === 'human' ? this.#options.humanExtraSlots : 0)) {
      throw new ContractError('NO_CAPACITY', 'executor slots are full')
    }

    const workdir = this.#workdirs.get(parsed.workdirKey)
    if (workdir !== undefined) {
      const mismatch = workspaceMismatch(workdir.workspace, parsed.workspace)
      if (mismatch !== undefined) throw new ContractError(mismatch, `workspace changed for ${parsed.workdirKey}`)
    }
    for (const record of this.#assignments.values()) {
      if (record.assignment.workdirKey === parsed.workdirKey && !isTerminal(record.assignment.state)) {
        throw new ContractError('WORKDIR_BUSY', parsed.workdirKey)
      }
    }
    if (workdir === undefined) {
      this.#workdirs.set(parsed.workdirKey, {
        workspace: parsed.workspace,
        createdAt: this.#now(),
        leaseExpiresAt: this.#now() + 7 * 24 * 60 * 60 * 1000,
      })
    }
    const assignment: Assignment = AssignmentSchema.parse({
      tenantId: parsed.tenantId,
      assignmentId: parsed.assignmentId,
      ticketId: parsed.ticketId,
      workdirKey: parsed.workdirKey,
      kernel: parsed.kernel ?? 'dsh',
      state: 'preparing',
      lastSeq: 0,
    })
    const record: AssignmentRecord = { assignment, workspace: parsed.workspace, events: [], nextSeq: 0, droppedLogs: 0 }
    this.#assignments.set(parsed.assignmentId, record)
    this.emit(parsed.assignmentId, { type: 'state', state: 'preparing' })
    return this.#assignments.get(parsed.assignmentId)!.assignment
  }

  get(assignmentId: string): Assignment {
    return this.record(assignmentId).assignment
  }

  transition(assignmentId: string, state: Assignment['state']): Assignment {
    const record = this.record(assignmentId)
    if (isTerminal(record.assignment.state)) {
      throw new ContractError('INVALID_PAYLOAD', 'terminal assignment cannot transition')
    }
    this.emit(assignmentId, { type: 'state', state })
    return record.assignment
  }

  report(assignmentId: string, report: NonNullable<Assignment['report']>): Assignment {
    const record = this.record(assignmentId)
    if (isTerminal(record.assignment.state)) {
      throw new ContractError('INVALID_PAYLOAD', 'terminal assignment cannot report')
    }
    this.#assignments.get(assignmentId)!.assignment = AssignmentSchema.parse({
      ...record.assignment,
      state: 'reported',
      report,
    })
    this.emit(assignmentId, { type: 'report', report })
    return record.assignment
  }

  cancel(assignmentId: string, mode: 'graceful' | 'kill'): Assignment {
    const record = this.record(assignmentId)
    if (isTerminal(record.assignment.state)) return record.assignment
    if (mode === 'graceful') this.emit(assignmentId, { type: 'log', stream: 'agent', chunk: 'graceful cancel' })
    this.emit(assignmentId, { type: 'state', state: 'cancelled' })
    return record.assignment
  }

  lost(assignmentId: string): Assignment {
    const record = this.record(assignmentId)
    if (isTerminal(record.assignment.state)) return record.assignment
    this.emit(assignmentId, { type: 'state', state: 'lost' })
    return record.assignment
  }

  activity(assignmentId: string, input: Extract<EventInput, { type: 'activity' }>): AssignmentEvent {
    return this.emit(assignmentId, input)
  }

  log(assignmentId: string, chunk: string): AssignmentEvent {
    return this.emit(assignmentId, { type: 'log', stream: 'stdout', chunk })
  }

  events(assignmentId: string): readonly AssignmentEvent[] {
    return [...this.record(assignmentId).events]
  }

  streamEvents(assignmentId: string, fromSeq: number): {
    events: readonly AssignmentEvent[]
    logsTruncated: boolean
    oldestLogSeq?: number
  } {
    const record = this.record(assignmentId)
    const events = record.events.filter(event => event.seq >= fromSeq)
    const truncated = record.oldestLogSeq !== undefined && fromSeq < record.oldestLogSeq
    return {
      events,
      logsTruncated: truncated,
      ...(truncated ? { oldestLogSeq: record.oldestLogSeq } : {}),
    }
  }

  touchWorkdir(workdirKey: string): { workdirKey: string; leaseExpiresAt: string } {
    const workdir = this.#workdirs.get(workdirKey)
    if (workdir === undefined) throw new ContractError('WORKDIR_NOT_FOUND', workdirKey)
    workdir.leaseExpiresAt = this.#now() + 7 * 24 * 60 * 60 * 1000
    return { workdirKey, leaseExpiresAt: new Date(workdir.leaseExpiresAt).toISOString() }
  }

  destroyWorkdir(workdirKey: string): { destroyed: boolean } {
    const busy = [...this.#assignments.values()].some(record =>
      record.assignment.workdirKey === workdirKey && !isTerminal(record.assignment.state))
    if (busy) throw new ContractError('WORKDIR_BUSY', workdirKey)
    this.#previews.delete(workdirKey)
    return { destroyed: this.#workdirs.delete(workdirKey) }
  }

  startPreview(workdirKey: string, port = 4173): FakePreview {
    if (!this.#workdirs.has(workdirKey)) throw new ContractError('WORKDIR_NOT_FOUND', workdirKey)
    const previews = this.#previews.get(workdirKey) ?? []
    const preview: FakePreview = {
      previewId: `preview-${previews.length + 1}`,
      workdirKey,
      port,
      url: `http://127.0.0.1:${port}`,
      pid: 1000 + previews.length,
      startedAt: new Date(this.#now()).toISOString(),
    }
    previews.push(preview)
    this.#previews.set(workdirKey, previews)
    return preview
  }

  listPreviews(workdirKey: string): readonly FakePreview[] {
    return [...(this.#previews.get(workdirKey) ?? [])]
  }

  stopPreviews(workdirKey: string, previewId?: string): { stopped: string[] } {
    const current = this.#previews.get(workdirKey) ?? []
    const stopped = previewId === undefined
      ? current.map(preview => preview.previewId)
      : current.filter(preview => preview.previewId === previewId).map(preview => preview.previewId)
    this.#previews.set(workdirKey, current.filter(preview => !stopped.includes(preview.previewId)))
    return { stopped }
  }

  listFiles(workdirKey: string, path = '', cursor?: string): {
    entries: Array<{
      name: string
      path: string
      type: 'file' | 'dir' | 'symlink'
      size?: number
      modified: boolean
      ignored: boolean
      sensitive: boolean
    }>
    nextCursor?: string
  } {
    if (!this.#workdirs.has(workdirKey)) throw new ContractError('WORKDIR_NOT_FOUND', workdirKey)
    const dir = normalizeRelative(path)
    const prefix = dir === '' ? '' : `${dir}/`
    const entries = [...this.#files.values()]
      .filter(file => file.path.startsWith(prefix) && file.path !== dir)
      .filter(file => !file.path.slice(prefix.length).includes('/'))
      .map(file => ({
        name: file.path.slice(prefix.length),
        path: file.path,
        type: file.type,
        ...(file.size === undefined ? {} : { size: file.size }),
        modified: file.modified ?? false,
        ignored: file.ignored ?? false,
        sensitive: file.sensitive ?? false,
      }))
    const offset = cursor === undefined ? 0 : Number.parseInt(cursor, 10)
    if (!Number.isSafeInteger(offset) || offset < 0) throw new ContractError('INVALID_PAYLOAD', 'bad cursor')
    const page = entries.slice(offset, offset + this.#options.pageSize)
    return {
      entries: page,
      ...(offset + page.length < entries.length ? { nextCursor: String(offset + page.length) } : {}),
    }
  }

  readFile(workdirKey: string, path: string): {
    path: string
    size: number
    binary: boolean
    redacted: boolean
    content?: string
  } {
    if (!this.#workdirs.has(workdirKey)) throw new ContractError('WORKDIR_NOT_FOUND', workdirKey)
    const key = normalizeRelative(path)
    const file = this.#files.get(key)
    if (file === undefined || file.type !== 'file') throw new ContractError('FILE_NOT_FOUND', path)
    const size = file.size ?? Buffer.byteLength(file.content ?? '')
    if (size > this.#options.maxReadBytes) throw new ContractError('FILE_TOO_LARGE', path)
    if (file.sensitive === true) return { path: key, size, binary: false, redacted: true }
    if (file.binary === true) return { path: key, size, binary: true, redacted: false }
    return { path: key, size, binary: false, redacted: false, content: file.content ?? '' }
  }

  assertStreamValid(assignmentId: string): void {
    for (const event of this.events(assignmentId)) AssignmentEventSchema.parse(event)
  }
}

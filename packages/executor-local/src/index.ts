/**
 * Local Executor for `workspace.kind = local_dir`.
 *
 * It never deletes the user's directory. It drives a kernel through the
 * AgentBackend contract, maps kernel events to Executor events, and computes
 * diffStats from the recorded diff basis.
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { copyFile, lstat, mkdir, readFile, readdir, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import {
  AssignmentEventSchema,
  AssignmentSchema,
  CreateAssignmentSchema,
  assertTenantMatches,
  workspaceMismatch,
  type Assignment,
  type AssignmentEvent,
  type CreateAssignment,
  type ExecutorErrorCode,
  type Workspace,
} from '@siriusx/contracts/executor'
import type {
  AgentBackend,
  AgentEvent,
  AgentSession,
  BackendHost,
  OpenTarget,
} from '@siriusx/kernel-api'

const execFileAsync = promisify(execFile)

export class LocalExecutorError extends Error {
  readonly code: ExecutorErrorCode

  constructor(code: ExecutorErrorCode, message: string) {
    super(message)
    this.name = 'LocalExecutorError'
    this.code = code
  }
}

export interface LocalExecutorOptions {
  readonly tenantId: string
  readonly backend: AgentBackend
  readonly capacity?: number
  readonly maxReadBytes?: number
  readonly logLimitPerAssignment?: number
  readonly maxFilesPerPage?: number
  readonly assignmentTimeoutMs?: number
  readonly uploadDir?: string
  readonly previewTtlMs?: number
  readonly now?: () => number
}

interface WorkdirState {
  readonly workspace: Extract<Workspace, { kind: 'local_dir' }>
  readonly path: string
  readonly startHead?: string
  readonly startSnapshot?: ReadonlyMap<string, SnapshotFile>
  kernelSessionId?: string
  leaseExpiresAt: number
}

interface SnapshotFile {
  readonly size: number
  readonly lines: number
  readonly sha256: string
}

interface ResolvedLocalExecutorOptions {
  readonly tenantId: string
  readonly capacity: number
  readonly maxReadBytes: number
  readonly logLimitPerAssignment: number
  readonly maxFilesPerPage: number
  readonly assignmentTimeoutMs: number
  readonly uploadDir?: string
  readonly previewTtlMs: number
}

interface AssignmentRecord {
  readonly request: CreateAssignment
  assignment: Assignment
  readonly events: AssignmentEvent[]
  readonly workdir: WorkdirState
  readonly completion: PromiseWithResolvers<void>
  session?: AgentSession
  cancelRequested: boolean
  nextSeq: number
  oldestLogSeq?: number
  droppedLogs: number
}

export interface PreviewView {
  readonly previewId: string
  readonly workdirKey: string
  readonly port: number
  readonly url: string
  readonly pid: number
  readonly startedAt: string
  readonly lastAccessAt: string
}

interface PreviewState {
  readonly previewId: string
  readonly workdirKey: string
  readonly port: number
  readonly url: string
  readonly pid: number
  readonly startedAt: number
  lastAccessAt: number
  readonly child: ChildProcess
}

type EventInput =
  | { readonly type: 'state'; readonly state: Assignment['state'] }
  | { readonly type: 'report'; readonly report: NonNullable<Assignment['report']> }
  | { readonly type: 'log'; readonly stream: 'stdout' | 'stderr' | 'agent'; readonly chunk: string }
  | Omit<Extract<AssignmentEvent, { type: 'activity' }>, 'seq' | 'at'>

const SENSITIVE = /(^\.env(?:\.|$)|\.pem$|\.key$|(?:^|\/)id_rsa|(?:^|\/)id_ed25519|(?:^|\/)\.npmrc$|(?:^|\/)\.pypirc$|(?:^|\/)\.netrc$|(?:^|\/)\.git-credentials$|(?:^|\/)\.git\/config$)/u
const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'out', '.next', '.turbo'])

function isTerminal(state: Assignment['state']): boolean {
  return state === 'reported' || state === 'cancelled' || state === 'lost'
}

function snapshotLineCount(text: string): number {
  if (text === '') return 0
  const lines = text.split('\n')
  return text.endsWith('\n') ? lines.length - 1 : lines.length
}

function safePath(root: string, path: string): string {
  if (isAbsolute(path)) throw new LocalExecutorError('PATH_OUTSIDE_WORKDIR', path)
  const base = resolve(root)
  const target = resolve(base, path)
  if (target !== base && !target.startsWith(base + sep)) {
    throw new LocalExecutorError('PATH_OUTSIDE_WORKDIR', path)
  }
  return target
}

async function git(cwd: string, args: readonly string[]): Promise<string | undefined> {
  try {
    const result = await execFileAsync('git', args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
    return result.stdout
  } catch {
    return undefined
  }
}

function parseNumstat(output: string): { filesChanged: number; insertions: number; deletions: number } {
  let filesChanged = 0
  let insertions = 0
  let deletions = 0
  for (const line of output.split('\n')) {
    if (line.trim() === '') continue
    const [added, removed] = line.split('\t')
    if (added === undefined || removed === undefined) continue
    filesChanged++
    insertions += added === '-' ? 0 : Number.parseInt(added, 10) || 0
    deletions += removed === '-' ? 0 : Number.parseInt(removed, 10) || 0
  }
  return { filesChanged, insertions, deletions }
}

async function snapshotDirectory(root: string, ignore = IGNORED_DIRS): Promise<ReadonlyMap<string, SnapshotFile>> {
  const result = new Map<string, SnapshotFile>()
  const visit = async (dir: string, prefix: string): Promise<void> => {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (ignore.has(entry.name)) continue
      const path = join(dir, entry.name)
      const relativePath = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) {
        await visit(path, relativePath)
        continue
      }
      if (!entry.isFile()) continue
      let body: Buffer
      try {
        body = await readFile(path)
      } catch {
        continue
      }
      result.set(relativePath, {
        size: body.byteLength,
        lines: snapshotLineCount(body.toString('utf8')),
        sha256: createHash('sha256').update(body).digest('hex'),
      })
    }
  }
  await visit(root, '')
  return result
}

async function computeDiff(
  workdir: WorkdirState,
  workspace: Extract<Workspace, { kind: 'local_dir' }>,
): Promise<{ filesChanged: number; insertions: number; deletions: number; basis: 'baseRef' | 'ticketStart' | 'none' }> {
  const head = workdir.startHead
  if (head !== undefined) {
    const ref = workspace.baseRef ?? head
    const numstat = await git(workdir.path, ['diff', '--numstat', ref])
    if (numstat !== undefined) {
      const stats = parseNumstat(numstat)
      const untracked = await git(workdir.path, ['ls-files', '--others', '--exclude-standard', '-z'])
      for (const path of (untracked ?? '').split('\0').filter(Boolean)) {
        stats.filesChanged++
        try {
          const body = await readFile(join(workdir.path, path), 'utf8')
          stats.insertions += snapshotLineCount(body)
        } catch {
          // A disappearing untracked file contributes no line count.
        }
      }
      return { ...stats, basis: workspace.baseRef === undefined ? 'ticketStart' : 'baseRef' }
    }
  }

  if (workdir.startSnapshot === undefined) return { filesChanged: 0, insertions: 0, deletions: 0, basis: 'none' }
  const current = await snapshotDirectory(workdir.path)
  let filesChanged = 0
  let insertions = 0
  let deletions = 0
  for (const [path, before] of workdir.startSnapshot) {
    const after = current.get(path)
    if (after === undefined) {
      filesChanged++
      deletions += before.lines
    } else if (after.sha256 !== before.sha256) {
      filesChanged++
      insertions += Math.max(0, after.lines - before.lines)
      deletions += Math.max(0, before.lines - after.lines)
    }
  }
  for (const path of current.keys()) {
    if (!workdir.startSnapshot.has(path)) {
      filesChanged++
      insertions += current.get(path)?.lines ?? 0
    }
  }
  return { filesChanged, insertions, deletions, basis: 'ticketStart' }
}

function parseReport(text: string, stats: { filesChanged: number; insertions: number; deletions: number }, basis: 'baseRef' | 'ticketStart' | 'none'): NonNullable<Assignment['report']> {
  const match = /```siriusx-report\s*([\s\S]*?)```/u.exec(text)
  if (match?.[1] !== undefined) {
    try {
      const parsed = JSON.parse(match[1]) as Record<string, unknown>
      const summary = typeof parsed.summary === 'string' ? parsed.summary : text.slice(0, 4000)
      switch (parsed.kind) {
        case 'answer':
          return { kind: 'answer', summary, question: String(parsed.question ?? 'Please provide input.') }
        case 'blocked':
          return { kind: 'blocked', summary, reason: String(parsed.reason ?? 'blocked') }
        case 'failed':
          return { kind: 'failed', summary, reason: String(parsed.reason ?? 'failed') }
        case 'waiting':
          return { kind: 'waiting', summary, reason: String(parsed.reason ?? 'waiting') }
        case 'ready':
        default:
          return {
            kind: 'ready',
            summary,
            diffStats: stats,
            diffBasis: basis,
            ...(parsed.changeRequest === undefined ? {} : { changeRequest: parsed.changeRequest as never }),
          }
      }
    } catch {
      // A malformed report marker falls back to a normal ready report.
    }
  }
  return { kind: 'ready', summary: text.trim().slice(0, 4000) || 'Executor finished.', diffStats: stats, diffBasis: basis }
}

function reportInstruction(): string {
  return [
    '',
    '---',
    'SiriusX Executor requirement: when the work is finished, emit exactly one fenced block in the final assistant message:',
    '```siriusx-report',
    '{"kind":"ready","summary":"one paragraph"}',
    '```',
    'Allowed kinds: ready | answer | blocked | failed | waiting. For answer add "question"; for blocked/failed/waiting add "reason".',
    'For ready, the Executor computes diffStats itself; do not invent numbers.',
  ].join('\n')
}

export class LocalExecutor {
  readonly #options: ResolvedLocalExecutorOptions
  readonly #backend: AgentBackend
  readonly #now: () => number
  readonly #records = new Map<string, AssignmentRecord>()
  readonly #workdirs = new Map<string, WorkdirState>()
  readonly #previews = new Map<string, PreviewState>()

  constructor(options: LocalExecutorOptions) {
    this.#backend = options.backend
    this.#options = {
      tenantId: options.tenantId,
      capacity: options.capacity ?? 2,
      maxReadBytes: options.maxReadBytes ?? 1024 * 1024,
      logLimitPerAssignment: options.logLimitPerAssignment ?? 10_000,
      maxFilesPerPage: options.maxFilesPerPage ?? 1000,
      assignmentTimeoutMs: options.assignmentTimeoutMs ?? 30 * 60 * 1000,
      previewTtlMs: options.previewTtlMs ?? 30 * 60 * 1000,
      ...(options.uploadDir === undefined ? {} : { uploadDir: options.uploadDir }),
    }
    this.#now = options.now ?? Date.now
  }

  get tenantId(): string { return this.#options.tenantId }

  private countNonTerminal(): number {
    return [...this.#records.values()].filter(record => !isTerminal(record.assignment.state)).length
  }

  private record(id: string): AssignmentRecord {
    const found = this.#records.get(id)
    if (found === undefined) throw new LocalExecutorError('ASSIGNMENT_NOT_FOUND', id)
    return found
  }

  private emit(record: AssignmentRecord, input: EventInput): AssignmentEvent {
    const seq = record.nextSeq++
    const event = AssignmentEventSchema.parse({ ...input, seq, at: new Date(this.#now()).toISOString() })
    if (event.type === 'log') {
      const logs = record.events.filter(item => item.type === 'log')
      if (logs.length >= this.#options.logLimitPerAssignment) {
        const oldest = logs[0]!
        const index = record.events.indexOf(oldest)
        if (index >= 0) record.events.splice(index, 1)
        record.oldestLogSeq = oldest.seq
        record.droppedLogs++
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

  private setState(record: AssignmentRecord, state: Assignment['state']): void {
    if (isTerminal(record.assignment.state) || record.assignment.state === state) return
    this.emit(record, { type: 'state', state })
  }

  private finish(record: AssignmentRecord, report: NonNullable<Assignment['report']>): void {
    if (isTerminal(record.assignment.state)) return
    record.assignment = AssignmentSchema.parse({ ...record.assignment, state: 'reported', report })
    this.emit(record, { type: 'report', report })
    this.emit(record, { type: 'state', state: 'reported' })
    record.completion.resolve()
  }

  private finishCancelled(record: AssignmentRecord): void {
    if (isTerminal(record.assignment.state)) return
    this.emit(record, { type: 'state', state: 'cancelled' })
    record.completion.resolve()
  }

  private host(): BackendHost {
    return {
      cwd: this.#workdirs.values().next().value?.path ?? process.cwd(),
      locale: () => 'en',
      debug: () => {},
      warn: () => {},
    }
  }

  private mapKernelEvent(record: AssignmentRecord, event: AgentEvent, toolStarts: Map<string, number>, lastText: { value: string }): void {
    switch (event.type) {
      case 'assistant.message':
        lastText.value = event.blocks.map(block => block.text ?? '').join('')
        break
      case 'tool.call':
        toolStarts.set(event.callId, this.#now())
        break
      case 'tool.result': {
        const start = toolStarts.get(event.callId) ?? this.#now()
        this.emit(record, {
          type: 'activity',
          kind: 'tool',
          name: 'tool',
          nameClass: 'custom',
          durationMs: Math.max(0, this.#now() - start),
          resultClass: event.isError ? 'error' : 'ok',
          ...(event.text.length > 0 ? { outputBytes: Buffer.byteLength(event.text) } : {}),
        })
        if (event.text !== '') this.emit(record, { type: 'log', stream: 'agent', chunk: `${event.text}\n` })
        break
      }
      case 'task.start':
        if (record.assignment.state === 'running') this.setState(record, 'backgrounded')
        break
      case 'turn.end':
        if (event.usage !== undefined) {
          this.emit(record, {
            type: 'activity',
            kind: 'model',
            name: 'model',
            nameClass: 'builtin',
            durationMs: 0,
            resultClass: event.reason.kind === 'error' ? 'error' : 'ok',
            usage: {
              inputTokens: event.usage.input ?? 0,
              outputTokens: event.usage.output ?? 0,
              ...(event.usage.cacheRead === undefined ? {} : { cachedTokens: event.usage.cacheRead }),
            },
          })
        }
        break
      default:
        break
    }
  }

  private async run(record: AssignmentRecord): Promise<void> {
    const workdir = record.workdir
    let session: AgentSession | undefined
    let unsubscribe: (() => void) | undefined
    const toolStarts = new Map<string, number>()
    const lastText = { value: '' }
    try {
      const target: OpenTarget = record.request.kind === 'resume' && workdir.kernelSessionId !== undefined
        ? { kind: 'resume', sessionId: workdir.kernelSessionId, cwd: workdir.path }
        : { kind: 'create', cwd: workdir.path }
      session = await this.#backend.open(target, this.host())
      record.session = session
      workdir.kernelSessionId ??= session.ref.sessionId
      if (record.cancelRequested) {
        await session.dispose()
        this.finishCancelled(record)
        return
      }
      this.setState(record, 'running')

      const turnDone = Promise.withResolvers<void>()
      const turnFailed = Promise.withResolvers<never>()
      unsubscribe = session.subscribe(batch => {
        for (const event of batch) {
          this.mapKernelEvent(record, event, toolStarts, lastText)
          if (event.type === 'turn.end') {
            if (event.reason.kind === 'error') turnFailed.reject(new Error(event.reason.message))
            else turnDone.resolve()
          }
        }
      })
      await session.submit(
        { text: `${record.request.input.prompt}\n\n${record.request.input.followUps.map(item => item.text).join('\n')}${reportInstruction()}`, clientMessageId: record.request.assignmentId },
        'turn',
      )
      await Promise.race([
        turnDone.promise,
        turnFailed.promise,
        new Promise<never>((_, reject) => setTimeout(() => { reject(new Error('assignment timeout')) }, this.#options.assignmentTimeoutMs)),
      ])
      if (record.cancelRequested) {
        this.finishCancelled(record)
        return
      }
      const stats = await computeDiff(workdir, workdir.workspace)
      this.finish(record, parseReport(lastText.value, stats, stats.basis))
    } catch (error) {
      if (record.cancelRequested) this.finishCancelled(record)
      else this.finish(record, { kind: 'failed', summary: 'Executor failed.', reason: error instanceof Error ? error.message : String(error) })
    } finally {
      unsubscribe?.()
      // A Local Executor must not dispose a session that a UI may share.
      if (session !== undefined && record.cancelRequested) {
        // Cancellation is an explicit terminal action; the kernel session may stay
        // alive for a later resume, so disposal is intentionally not automatic.
      }
    }
  }

  async createAssignment(request: CreateAssignment): Promise<Assignment> {
    const parsed = CreateAssignmentSchema.parse(request)
    assertTenantMatches(parsed.tenantId, { tenantId: this.#options.tenantId, principal: 'local-executor' })
    const existing = this.#records.get(parsed.assignmentId)
    if (existing !== undefined) return existing.assignment
    if (parsed.workspace.kind !== 'local_dir') throw new LocalExecutorError('WORKSPACE_UNSUPPORTED', parsed.workspace.kind)
    if (this.countNonTerminal() >= this.#options.capacity) throw new LocalExecutorError('NO_CAPACITY', 'local slots are full')
    if (!isAbsolute(parsed.workspace.path)) throw new LocalExecutorError('WORKSPACE_PATH_MISMATCH', 'local_dir.path must be absolute')
    try {
      if (!(await stat(parsed.workspace.path)).isDirectory()) throw new Error('not a directory')
    } catch {
      throw new LocalExecutorError('WORKDIR_NOT_FOUND', parsed.workspace.path)
    }

    const existingWorkdir = this.#workdirs.get(parsed.workdirKey)
    if (existingWorkdir !== undefined) {
      const mismatch = workspaceMismatch(existingWorkdir.workspace, parsed.workspace)
      if (mismatch !== undefined) throw new LocalExecutorError(mismatch, `workspace changed for ${parsed.workdirKey}`)
    }
    for (const other of this.#records.values()) {
      if (other.assignment.workdirKey === parsed.workdirKey && !isTerminal(other.assignment.state)) {
        throw new LocalExecutorError('WORKDIR_BUSY', parsed.workdirKey)
      }
    }

    let workdir = existingWorkdir
    if (workdir === undefined) {
      const head = await git(parsed.workspace.path, ['rev-parse', 'HEAD'])
      workdir = {
        workspace: parsed.workspace,
        path: parsed.workspace.path,
        leaseExpiresAt: this.#now() + 7 * 24 * 60 * 60 * 1000,
        ...(head === undefined ? { startSnapshot: await snapshotDirectory(parsed.workspace.path) } : { startHead: head.trim() }),
      }
      this.#workdirs.set(parsed.workdirKey, workdir)
    }

    const assignment: Assignment = AssignmentSchema.parse({
      tenantId: parsed.tenantId,
      assignmentId: parsed.assignmentId,
      ticketId: parsed.ticketId,
      workdirKey: parsed.workdirKey,
      kernel: 'dsh',
      state: 'preparing',
      lastSeq: 0,
    })
    const record: AssignmentRecord = {
      request: parsed,
      assignment,
      events: [],
      workdir,
      completion: Promise.withResolvers<void>(),
      cancelRequested: false,
      nextSeq: 0,
      droppedLogs: 0,
    }
    this.#records.set(parsed.assignmentId, record)
    this.emit(record, { type: 'state', state: 'preparing' })
    void this.run(record)
    return record.assignment
  }

  getAssignment(assignmentId: string): Assignment {
    return this.record(assignmentId).assignment
  }

  wait(assignmentId: string): Promise<Assignment> {
    const record = this.record(assignmentId)
    return record.completion.promise.then(() => record.assignment)
  }

  streamEvents(assignmentId: string, fromSeq: number): {
    events: readonly AssignmentEvent[]
    logsTruncated: boolean
    oldestLogSeq?: number
  } {
    const record = this.record(assignmentId)
    const events = record.events.filter(event => event.seq >= fromSeq)
    const truncated = record.oldestLogSeq !== undefined && fromSeq < record.oldestLogSeq
    return { events, logsTruncated: truncated, ...(truncated ? { oldestLogSeq: record.oldestLogSeq } : {}) }
  }

  /**
   * Project events for the cloud Bot. local_dir content (logs) stays on the
   * device; only lifecycle, report and non-content activity cross the uplink.
   */
  streamEventsForBot(assignmentId: string, fromSeq: number): {
    events: readonly AssignmentEvent[]
    logsTruncated: boolean
    oldestLogSeq?: number
  } {
    const streamed = this.streamEvents(assignmentId, fromSeq)
    return {
      ...streamed,
      events: streamed.events.filter(event => event.type !== 'log'),
    }
  }

  async cancelAssignment(assignmentId: string, mode: 'graceful' | 'kill'): Promise<Assignment> {
    const record = this.record(assignmentId)
    if (isTerminal(record.assignment.state)) return record.assignment
    record.cancelRequested = true
    if (record.session !== undefined) {
      await record.session.cancel(mode === 'kill' ? 'interrupt' : 'user')
    }
    await Promise.race([
      record.completion.promise,
      new Promise<void>(resolve => setTimeout(resolve, 11_000)),
    ])
    if (!isTerminal(record.assignment.state)) this.finishCancelled(record)
    return record.assignment
  }

  async touchWorkdir(workdirKey: string): Promise<{ workdirKey: string; leaseExpiresAt: string }> {
    const workdir = this.#workdirs.get(workdirKey)
    if (workdir === undefined) throw new LocalExecutorError('WORKDIR_NOT_FOUND', workdirKey)
    workdir.leaseExpiresAt = this.#now() + 7 * 24 * 60 * 60 * 1000
    return { workdirKey, leaseExpiresAt: new Date(workdir.leaseExpiresAt).toISOString() }
  }

  async destroyWorkdir(workdirKey: string): Promise<{ destroyed: boolean }> {
    const busy = [...this.#records.values()].some(record => record.assignment.workdirKey === workdirKey && !isTerminal(record.assignment.state))
    if (busy) throw new LocalExecutorError('WORKDIR_BUSY', workdirKey)
    await this.stopPreviews(workdirKey)
    // Never remove the user's local_dir. Only our lease/state is cleaned.
    return { destroyed: this.#workdirs.delete(workdirKey) }
  }

  /** Start a registered preview process in a workdir. The caller owns the command; the Executor owns lifecycle/TTL. */
  async startPreview(workdirKey: string, command: string, args: readonly string[] = [], port: number): Promise<PreviewView> {
    const workdir = this.#workdirs.get(workdirKey)
    if (workdir === undefined) throw new LocalExecutorError('WORKDIR_NOT_FOUND', workdirKey)
    if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new LocalExecutorError('INVALID_PAYLOAD', `invalid preview port: ${port}`)
    await this.sweepPreviews()
    const child = spawn(command, [...args], { cwd: workdir.path, env: process.env, stdio: 'ignore' })
    if (child.pid === undefined) throw new Error(`preview process did not start: ${command}`)
    const previewId = randomUUID()
    const now = this.#now()
    const preview: PreviewState = {
      previewId, workdirKey, port, url: `http://127.0.0.1:${port}`, pid: child.pid,
      startedAt: now, lastAccessAt: now, child,
    }
    this.#previews.set(previewId, preview)
    child.once('exit', () => {
      if (this.#previews.get(previewId)?.child === child) this.#previews.delete(previewId)
    })
    return this.#previewView(preview)
  }

  #previewView(preview: PreviewState): PreviewView {
    return {
      previewId: preview.previewId, workdirKey: preview.workdirKey, port: preview.port, url: preview.url, pid: preview.pid,
      startedAt: new Date(preview.startedAt).toISOString(), lastAccessAt: new Date(preview.lastAccessAt).toISOString(),
    }
  }

  async touchPreview(workdirKey: string, previewId: string): Promise<PreviewView> {
    const preview = this.#previews.get(previewId)
    if (preview === undefined || preview.workdirKey !== workdirKey) throw new LocalExecutorError('PREVIEW_NOT_FOUND', previewId)
    preview.lastAccessAt = this.#now()
    return this.#previewView(preview)
  }

  async listPreviews(workdirKey: string): Promise<{ previews: PreviewView[] }> {
    if (!this.#workdirs.has(workdirKey)) throw new LocalExecutorError('WORKDIR_NOT_FOUND', workdirKey)
    await this.sweepPreviews()
    return { previews: [...this.#previews.values()].filter(preview => preview.workdirKey === workdirKey).map(preview => this.#previewView(preview)) }
  }

  async stopPreviews(workdirKey: string, previewId?: string): Promise<{ stopped: string[] }> {
    const stopped: string[] = []
    for (const preview of [...this.#previews.values()]) {
      if (preview.workdirKey !== workdirKey || (previewId !== undefined && preview.previewId !== previewId)) continue
      preview.child.kill('SIGTERM')
      const killTimer = setTimeout(() => { preview.child.kill('SIGKILL') }, 2000)
      killTimer.unref()
      this.#previews.delete(preview.previewId)
      stopped.push(preview.previewId)
    }
    return { stopped }
  }

  /** Stop previews whose last access exceeded the TTL. Exposed for a Host watchdog. */
  async sweepPreviews(): Promise<string[]> {
    const cutoff = this.#now() - this.#options.previewTtlMs
    const stale = [...this.#previews.values()].filter(preview => preview.lastAccessAt < cutoff)
    const stopped: string[] = []
    for (const preview of stale) {
      preview.child.kill('SIGTERM')
      this.#previews.delete(preview.previewId)
      stopped.push(preview.previewId)
    }
    return stopped
  }

  async listFiles(workdirKey: string, path = '', cursor?: string): Promise<{
    entries: Array<{ name: string; path: string; type: 'file' | 'dir' | 'symlink'; size?: number; modified: boolean; ignored: boolean; sensitive: boolean }>
    nextCursor?: string
  }> {
    const workdir = this.#workdirs.get(workdirKey)
    if (workdir === undefined) throw new LocalExecutorError('WORKDIR_NOT_FOUND', workdirKey)
    const target = safePath(workdir.path, path)
    let entries
    try {
      entries = await readdir(target, { withFileTypes: true })
    } catch {
      throw new LocalExecutorError('FILE_NOT_FOUND', path)
    }
    const offset = cursor === undefined ? 0 : Number.parseInt(cursor, 10)
    if (!Number.isSafeInteger(offset) || offset < 0) throw new LocalExecutorError('INVALID_PAYLOAD', 'bad cursor')
    const page = entries.slice(offset, offset + this.#options.maxFilesPerPage).map(entry => {
      const relativePath = path === '' ? entry.name : `${path}/${entry.name}`
      return {
        name: entry.name,
        path: relativePath,
        type: entry.isDirectory() ? 'dir' as const : entry.isSymbolicLink() ? 'symlink' as const : 'file' as const,
        modified: false,
        ignored: entry.name.startsWith('.'),
        sensitive: SENSITIVE.test(relativePath),
      }
    })
    return { entries: page, ...(offset + page.length < entries.length ? { nextCursor: String(offset + page.length) } : {}) }
  }

  async readFile(workdirKey: string, path: string): Promise<{ path: string; size: number; binary: boolean; redacted: boolean; content?: string }> {
    const workdir = this.#workdirs.get(workdirKey)
    if (workdir === undefined) throw new LocalExecutorError('WORKDIR_NOT_FOUND', workdirKey)
    const target = safePath(workdir.path, path)
    let info
    try {
      info = await lstat(target)
    } catch {
      throw new LocalExecutorError('FILE_NOT_FOUND', path)
    }
    if (!info.isFile()) throw new LocalExecutorError('FILE_NOT_FOUND', path)
    if (info.size > this.#options.maxReadBytes) throw new LocalExecutorError('FILE_TOO_LARGE', path)
    if (SENSITIVE.test(path)) return { path, size: info.size, binary: false, redacted: true }
    const body = await readFile(target)
    if (body.includes(0)) return { path, size: info.size, binary: true, redacted: false }
    return { path, size: info.size, binary: false, redacted: false, content: body.toString('utf8') }
  }

  async uploadLocalArtifacts(request: {
    tenantId: string
    workdirKey: string
    files: ReadonlyArray<{ path: string; size: number; sha256: string }>
    consent: { requestedBy: string }
  }): Promise<{ uploads: Array<{ uploadId: string; sourcePath: string; storedPath: string; size: number }> }> {
    assertTenantMatches(request.tenantId, { tenantId: this.#options.tenantId, principal: 'local-executor' })
    const workdir = this.#workdirs.get(request.workdirKey)
    if (workdir === undefined) throw new LocalExecutorError('WORKDIR_NOT_FOUND', request.workdirKey)
    if (this.#options.uploadDir === undefined || request.consent.requestedBy === '') {
      throw new LocalExecutorError('UPLOAD_REJECTED', 'explicit upload consent and a tenant upload volume are required')
    }
    const uploads = []
    for (const file of request.files) {
      const source = safePath(workdir.path, file.path)
      const body = await readFile(source)
      if (body.byteLength !== file.size || createHash('sha256').update(body).digest('hex') !== file.sha256) {
        throw new LocalExecutorError('UPLOAD_REJECTED', `hash or size mismatch for ${file.path}`)
      }
      const uploadId = `${request.workdirKey}-${createHash('sha256').update(file.path).digest('hex').slice(0, 16)}`
      const destination = join(this.#options.uploadDir, uploadId)
      await mkdir(this.#options.uploadDir, { recursive: true })
      await copyFile(source, destination)
      uploads.push({ uploadId, sourcePath: file.path, storedPath: destination, size: body.byteLength })
    }
    return { uploads }
  }
}

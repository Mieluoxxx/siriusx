/** Cloud Executor: sandbox lifecycle, per-ticket workdir volumes and recovery. */
import { randomUUID } from 'node:crypto'
import {
  AssignmentReportSchema,
  AssignmentSchema,
  CancelAssignmentSchema,
  CreateAssignmentSchema,
  type Assignment,
  type AssignmentEvent,
  type CreateAssignment,
} from '@siriusx/contracts/executor'
import type { z } from 'zod'
import { MemoryAssignmentStore, SqliteAssignmentStore, type AssignmentStore, type StoredAssignment } from './store.ts'

export type AssignmentReport = z.infer<typeof AssignmentReportSchema>
export type CancelAssignment = z.infer<typeof CancelAssignmentSchema>

export interface SandboxExecOptions {
  readonly timeoutMs?: number
  readonly env?: Readonly<Record<string, string>>
}

export interface SandboxExecResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

export interface SandboxProcess {
  readonly readable: ReadableStream<Uint8Array>
  readonly writable: WritableStream<Uint8Array>
  readonly exited: Promise<void>
  kill(): void
}

export interface Sandbox {
  readonly id: string
  readonly workdir: string
  exec(command: string, options?: SandboxExecOptions): Promise<SandboxExecResult>
  copyIn(localPath: string, remotePath: string): Promise<void>
  /** Start a long-lived stdio process inside the sandbox (ACP agents). */
  spawn(command: string, args?: readonly string[], options?: SandboxExecOptions): Promise<SandboxProcess>
  destroy(): Promise<void>
}

export interface SandboxCreateRequest {
  readonly tenantId: string
  readonly workdirKey: string
  /** `none` is the default; allowlist requires the deployment proxy. */
  readonly network: 'none' | 'allowlist'
  readonly image: string
}

export interface SandboxProvider {
  create(request: SandboxCreateRequest): Promise<Sandbox>
  /** Remove the durable home/workspace volumes for one ticket. */
  removeVolumes(tenantId: string, workdirKey: string): Promise<void>
  /** Best-effort recovery hook; providers without it leave the container to Docker GC. */
  destroySandbox?(sandboxId: string): Promise<void>
}

export interface CloudKernelContext {
  readonly assignment: CreateAssignment
  readonly sandbox: Sandbox
  /** Working directory after optional repository preparation. */
  readonly cwd: string
  emitActivity(event: Omit<Extract<AssignmentEvent, { type: 'activity' }>, 'seq' | 'at' | 'type'>): void
}

/** Optional first step after sandbox creation, e.g. clone the project repository. */
export type WorkspacePreparer = (request: CreateAssignment, sandbox: Sandbox) => Promise<string | undefined>

/** Clone a cloud_project workspace into a directory inside the sandbox. */
export class GitClonePreparer {
  readonly #target: string
  constructor(target = '/workspace/repo') { this.#target = target }

  async prepare(request: CreateAssignment, sandbox: Sandbox): Promise<string> {
    if (request.workspace.kind !== 'cloud_project') throw new Error('GitClonePreparer only accepts cloud_project')
    const quote = (value: string): string => `'${value.replace(/'/gu, `'\''`)}'`
    // Bind mounts may be owned by another uid; the sandbox is ephemeral and
    // already isolated, so mark the clone source as safe for git.
    await sandbox.exec("git config --global --add safe.directory '*'")
    await sandbox.exec(`rm -rf ${quote(this.#target)}`)
    const result = await sandbox.exec(`git clone --depth 1 --branch ${quote(request.workspace.baseRef)} ${quote(request.workspace.repo.cloneUrl)} ${quote(this.#target)}`)
    if (result.exitCode !== 0) throw new Error(`git clone failed: ${result.stderr.trim()}`)
    return this.#target
  }
}

export interface CloudKernel {
  run(context: CloudKernelContext): Promise<AssignmentReport>
}

export interface CloudExecutorOptions {
  readonly provider: SandboxProvider
  readonly kernel: CloudKernel
  readonly image?: string
  readonly network?: 'none' | 'allowlist'
  readonly now?: () => number
  readonly prepareWorkspace?: WorkspacePreparer
  readonly assignmentTimeoutMs?: number
  /** Durable store; when omitted the executor is process-local. */
  readonly store?: AssignmentStore
  readonly dbPath?: string
}

interface Entry {
  assignment: Assignment
  events: AssignmentEvent[]
  sandbox?: Sandbox
  sandboxId?: string
  cancelled: boolean
  done: Promise<void>
}

export class CloudExecutor {
  readonly #entries = new Map<string, Entry>()
  readonly #provider: SandboxProvider
  readonly #kernel: CloudKernel
  readonly #image: string
  readonly #network: 'none' | 'allowlist'
  readonly #now: () => number
  readonly #prepareWorkspace: WorkspacePreparer | undefined
  readonly #assignmentTimeoutMs: number
  readonly #store: AssignmentStore

  constructor(options: CloudExecutorOptions) {
    this.#provider = options.provider
    this.#kernel = options.kernel
    this.#image = options.image ?? 'debian:bookworm-slim'
    this.#network = options.network ?? 'none'
    this.#now = options.now ?? Date.now
    this.#prepareWorkspace = options.prepareWorkspace
    this.#assignmentTimeoutMs = options.assignmentTimeoutMs ?? 30 * 60 * 1000
    this.#store = options.store ?? (options.dbPath === undefined ? new MemoryAssignmentStore() : new SqliteAssignmentStore(options.dbPath))
  }

  /** Destroy live sandboxes, then close the assignment store. */
  async dispose(): Promise<void> {
    const entries = [...this.#entries.values()]
    await Promise.all(entries.map(async entry => {
      try { await this.#destroySandbox(entry) } catch { /* best effort during shutdown */ }
    }))
    this.#entries.clear()
    this.#store.close()
  }

  /** Synchronous compatibility shim used by older callers. */
  close(): void { void this.dispose().catch(() => undefined) }

  #entry(assignmentId: string): Entry {
    const existing = this.#entries.get(assignmentId)
    if (existing !== undefined) return existing
    const stored = this.#store.get(assignmentId)
    if (stored === undefined) throw new Error(`assignment ${assignmentId} not found`)
    const entry: Entry = {
      assignment: stored.assignment,
      events: [...stored.events],
      ...(stored.sandboxId === undefined ? {} : { sandboxId: stored.sandboxId }),
      cancelled: false,
      done: Promise.resolve(),
    }
    this.#entries.set(assignmentId, entry)
    return entry
  }

  async createAssignment(input: CreateAssignment): Promise<Assignment> {
    const request = CreateAssignmentSchema.parse(input)
    if (request.workspace.kind !== 'cloud_project') throw new Error('CloudExecutor only accepts cloud_project workspaces')
    const assignment: Assignment = {
      tenantId: request.tenantId,
      assignmentId: request.assignmentId,
      ticketId: request.ticketId,
      workdirKey: request.workdirKey,
      kernel: request.kernel ?? 'dsh',
      state: 'preparing',
      lastSeq: 0,
    }
    this.#store.create(assignment)
    const entry: Entry = { assignment, events: [], cancelled: false, done: Promise.resolve() }
    this.#entries.set(request.assignmentId, entry)
    this.#emit(entry, 'preparing')
    entry.done = this.#run(entry, request)
    return this.getAssignment(request.assignmentId)
  }

  async #run(entry: Entry, request: CreateAssignment): Promise<void> {
    try {
      const sandbox = await this.#provider.create({
        tenantId: request.tenantId,
        workdirKey: request.workdirKey,
        network: this.#network,
        image: this.#image,
      })
      entry.sandbox = sandbox
      entry.sandboxId = sandbox.id
      this.#store.update(entry.assignment, sandbox.id)
      if (entry.cancelled) { await sandbox.destroy(); return }
      const cwd = this.#prepareWorkspace === undefined ? undefined : await this.#prepareWorkspace(request, sandbox)
      if (entry.cancelled) { await sandbox.destroy(); return }
      entry.assignment.state = 'running'
      this.#emit(entry, 'running')
      let timeout: ReturnType<typeof setTimeout> | undefined
      const report = await Promise.race([
        this.#kernel.run({
        assignment: request,
        sandbox,
        cwd: cwd ?? sandbox.workdir,
          emitActivity: event => this.#emitActivity(entry, event),
        }),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('cloud assignment timeout')), this.#assignmentTimeoutMs)
          timeout.unref?.()
        }),
      ]).finally(() => { if (timeout !== undefined) clearTimeout(timeout) })
      if (entry.cancelled || this.#store.get(entry.assignment.assignmentId)?.assignment.state === 'lost') return
      entry.assignment.state = 'reported'
      entry.assignment.report = report
      this.#emit(entry, 'reported', report)
    } catch (error) {
      if (entry.cancelled) return
      entry.assignment.state = 'reported'
      entry.assignment.report = {
        kind: 'failed',
        summary: 'cloud executor failed',
        reason: error instanceof Error ? error.message : String(error),
      }
      this.#emit(entry, 'reported', entry.assignment.report)
    }
  }

  #append(entry: Entry, event: AssignmentEvent): void {
    entry.events.push(event)
    entry.assignment.lastSeq = event.seq
    this.#store.appendEvent(entry.assignment.assignmentId, event)
    this.#store.update(entry.assignment)
  }

  #emit(entry: Entry, state: Assignment['state'], report?: AssignmentReport): void {
    this.#append(entry, { type: 'state', seq: entry.events.length, at: new Date(this.#now()).toISOString(), state })
    if (report !== undefined) {
      this.#append(entry, { type: 'report', seq: entry.events.length, at: new Date(this.#now()).toISOString(), report })
    }
  }

  #emitActivity(entry: Entry, event: Omit<Extract<AssignmentEvent, { type: 'activity' }>, 'seq' | 'at' | 'type'>): void {
    this.#append(entry, { type: 'activity', seq: entry.events.length, at: new Date(this.#now()).toISOString(), ...event })
  }

  getAssignment(assignmentId: string): Assignment {
    return AssignmentSchema.parse(this.#entry(assignmentId).assignment)
  }

  async wait(assignmentId: string): Promise<Assignment> {
    await this.#entry(assignmentId).done
    return this.getAssignment(assignmentId)
  }

  streamEvents(assignmentId: string, fromSeq: number): { events: readonly AssignmentEvent[]; logsTruncated: boolean } {
    return { events: this.#entry(assignmentId).events.filter(event => event.seq >= fromSeq), logsTruncated: false }
  }

  streamEventsForBot(assignmentId: string, fromSeq: number): { events: readonly AssignmentEvent[]; logsTruncated: boolean } {
    const streamed = this.streamEvents(assignmentId, fromSeq)
    return { ...streamed, events: streamed.events.filter(event => event.type !== 'log') }
  }

  async cancelAssignment(input: CancelAssignment): Promise<Assignment> {
    const request = CancelAssignmentSchema.parse(input)
    const entry = this.#entry(request.assignmentId)
    if (entry.assignment.state === 'reported' || entry.assignment.state === 'cancelled' || entry.assignment.state === 'lost') return this.getAssignment(request.assignmentId)
    entry.cancelled = true
    await this.#destroySandbox(entry)
    entry.assignment.state = 'cancelled'
    this.#emit(entry, 'cancelled')
    return this.getAssignment(request.assignmentId)
  }

  async #destroySandbox(entry: Entry): Promise<void> {
    if (entry.sandbox !== undefined) {
      await entry.sandbox.destroy()
      return
    }
    if (entry.sandboxId !== undefined) await this.#provider.destroySandbox?.(entry.sandboxId)
  }

  async recoverOrphans(): Promise<readonly string[]> {
    const recovered: string[] = []
    for (const stored of this.#store.list()) {
      const entry = this.#entry(stored.assignment.assignmentId)
      if (entry.assignment.state === 'preparing' || entry.assignment.state === 'running' || entry.assignment.state === 'backgrounded') {
        entry.cancelled = true
        await this.#destroySandbox(entry)
        entry.assignment.state = 'lost'
        this.#emit(entry, 'lost')
        recovered.push(entry.assignment.assignmentId)
      }
    }
    return recovered
  }

  async destroyWorkdir(tenantId: string, assignmentId: string): Promise<void> {
    const entry = this.#entry(assignmentId)
    if (entry.assignment.tenantId !== tenantId) throw new Error('assignment not found')
    await this.#destroySandbox(entry)
  }

  async removeWorkdir(tenantId: string, workdirKey: string): Promise<void> {
    await this.#provider.removeVolumes(tenantId, workdirKey)
  }
}

/** A test/private-deployment provider that keeps volumes in memory. */
export { DockerSandboxProvider, type DockerSandboxProviderOptions } from './docker.ts'

export class MemorySandboxProvider implements SandboxProvider {
  readonly #volumes = new Map<string, Map<string, string>>()
  readonly #sandboxes = new Map<string, { workdir: string; destroyed: boolean; files: Map<string, string> }>()

  async create(request: SandboxCreateRequest): Promise<Sandbox> {
    const key = `${request.tenantId}/${request.workdirKey}`
    const volume = this.#volumes.get(key) ?? new Map<string, string>()
    this.#volumes.set(key, volume)
    const id = randomUUID()
    const state = { workdir: `/workspace/${request.workdirKey}`, destroyed: false, files: volume }
    this.#sandboxes.set(id, state)
    return {
      id,
      workdir: state.workdir,
      exec: async (command) => {
        if (state.destroyed) throw new Error('sandbox destroyed')
        if (command.startsWith('write:')) { state.files.set(command.slice(6), 'written'); return { stdout: '', stderr: '', exitCode: 0 } }
        if (command.startsWith('read:')) {
          const value = state.files.get(command.slice(5))
          return value === undefined ? { stdout: '', stderr: 'not found', exitCode: 1 } : { stdout: value, stderr: '', exitCode: 0 }
        }
        return { stdout: '', stderr: '', exitCode: 0 }
      },
      copyIn: async (localPath, remotePath) => { state.files.set(remotePath, localPath) },
      spawn: async () => { throw new Error('MemorySandboxProvider does not run stdio processes') },
      destroy: async () => { state.destroyed = true },
    }
  }

  async removeVolumes(tenantId: string, workdirKey: string): Promise<void> {
    this.#volumes.delete(`${tenantId}/${workdirKey}`)
  }

  async destroySandbox(sandboxId: string): Promise<void> {
    const sandbox = this.#sandboxes.get(sandboxId)
    if (sandbox !== undefined) sandbox.destroyed = true
  }

  activeSandboxIds(): string[] { return [...this.#sandboxes.entries()].filter(([, state]) => !state.destroyed).map(([id]) => id) }

  volumeFor(tenantId: string, workdirKey: string): ReadonlyMap<string, string> | undefined {
    return this.#volumes.get(`${tenantId}/${workdirKey}`)
  }
}

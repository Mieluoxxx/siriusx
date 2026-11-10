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
}

export interface CloudKernelContext {
  readonly assignment: CreateAssignment
  readonly sandbox: Sandbox
  emitActivity(event: Omit<Extract<AssignmentEvent, { type: 'activity' }>, 'seq' | 'at' | 'type'>): void
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
}

interface Entry {
  assignment: Assignment
  events: AssignmentEvent[]
  sandbox?: Sandbox
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

  constructor(options: CloudExecutorOptions) {
    this.#provider = options.provider
    this.#kernel = options.kernel
    this.#image = options.image ?? 'debian:bookworm-slim'
    this.#network = options.network ?? 'none'
    this.#now = options.now ?? Date.now
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
    const entry: Entry = { assignment, events: [], cancelled: false, done: Promise.resolve() }
    this.#emit(entry, 'preparing')
    this.#entries.set(request.assignmentId, entry)
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
      if (entry.cancelled) { await sandbox.destroy(); return }
      entry.assignment.state = 'running'
      this.#emit(entry, 'running')
      const report = await this.#kernel.run({
        assignment: request,
        sandbox,
        emitActivity: event => this.#emitActivity(entry, event),
      })
      if (entry.cancelled) return
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

  #emit(entry: Entry, state: Assignment['state'], report?: AssignmentReport): void {
    entry.assignment.lastSeq = entry.events.length
    entry.events.push({ type: 'state', seq: entry.assignment.lastSeq, at: new Date(this.#now()).toISOString(), state })
    if (report !== undefined) {
      entry.events.push({ type: 'report', seq: entry.events.length, at: new Date(this.#now()).toISOString(), report })
    }
    entry.assignment.lastSeq = entry.events.length - 1
  }

  #emitActivity(entry: Entry, event: Omit<Extract<AssignmentEvent, { type: 'activity' }>, 'seq' | 'at' | 'type'>): void {
    entry.events.push({ type: 'activity', seq: entry.events.length, at: new Date(this.#now()).toISOString(), ...event })
    entry.assignment.lastSeq = entry.events.length - 1
  }

  getAssignment(assignmentId: string): Assignment {
    const entry = this.#entries.get(assignmentId)
    if (entry === undefined) throw new Error(`assignment ${assignmentId} not found`)
    return AssignmentSchema.parse(entry.assignment)
  }

  async wait(assignmentId: string): Promise<Assignment> {
    const entry = this.#entries.get(assignmentId)
    if (entry === undefined) throw new Error(`assignment ${assignmentId} not found`)
    await entry.done
    return this.getAssignment(assignmentId)
  }

  streamEvents(assignmentId: string, fromSeq: number): { events: readonly AssignmentEvent[]; logsTruncated: boolean } {
    const entry = this.#entries.get(assignmentId)
    if (entry === undefined) throw new Error(`assignment ${assignmentId} not found`)
    return { events: entry.events.filter(event => event.seq >= fromSeq), logsTruncated: false }
  }

  streamEventsForBot(assignmentId: string, fromSeq: number): { events: readonly AssignmentEvent[]; logsTruncated: boolean } {
    const streamed = this.streamEvents(assignmentId, fromSeq)
    return { ...streamed, events: streamed.events.filter(event => event.type !== 'log') }
  }

  async cancelAssignment(input: CancelAssignment): Promise<Assignment> {
    const request = CancelAssignmentSchema.parse(input)
    const entry = this.#entries.get(request.assignmentId)
    if (entry === undefined) throw new Error(`assignment ${request.assignmentId} not found`)
    if (entry.assignment.state === 'reported' || entry.assignment.state === 'cancelled' || entry.assignment.state === 'lost') return this.getAssignment(request.assignmentId)
    entry.cancelled = true
    await entry.sandbox?.destroy()
    entry.assignment.state = 'cancelled'
    this.#emit(entry, 'cancelled')
    return this.getAssignment(request.assignmentId)
  }

  async recoverOrphans(): Promise<readonly string[]> {
    const recovered: string[] = []
    for (const [assignmentId, entry] of this.#entries) {
      if (entry.assignment.state === 'preparing' || entry.assignment.state === 'running' || entry.assignment.state === 'backgrounded') {
        entry.cancelled = true
        await entry.sandbox?.destroy()
        entry.assignment.state = 'lost'
        this.#emit(entry, 'lost')
        recovered.push(assignmentId)
      }
    }
    return recovered
  }

  async destroyWorkdir(tenantId: string, assignmentId: string): Promise<void> {
    const entry = this.#entries.get(assignmentId)
    if (entry === undefined || entry.assignment.tenantId !== tenantId) throw new Error('assignment not found')
    await entry.sandbox?.destroy()
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

  volumeFor(tenantId: string, workdirKey: string): ReadonlyMap<string, string> | undefined {
    return this.#volumes.get(`${tenantId}/${workdirKey}`)
  }
}

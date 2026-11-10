/** ACP v1 client backend over a child-process stdio transport. */
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { Readable, Writable } from 'node:stream'
import {
  ClientSideConnection,
  ndJsonStream,
  type Agent,
  type Client,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
  type SessionUpdate,
} from '@agentclientprotocol/sdk'
import type {
  AgentBackend,
  AgentEvent,
  AgentInput,
  AgentSession,
  AgentSessionStatus,
  BackendDetection,
  BackendHost,
  CancelCause,
  CancelReceipt,
  OpenTarget,
  PermissionDecision,
  PermissionRequestView,
  SessionCapabilities,
} from '@siriusx/kernel-api'

export interface AcpProcessSpec {
  readonly id: string
  readonly label: string
  readonly command: string
  readonly args?: readonly string[]
  readonly env?: Readonly<Record<string, string>>
}

export interface AcpTransport {
  readonly readable: ReadableStream<Uint8Array>
  readonly writable: WritableStream<Uint8Array>
  readonly exited: Promise<void>
  kill(): void
}

/** Spawn one ACP agent process and expose its NDJSON stdio as Web streams. */
export function spawnAcpTransport(spec: AcpProcessSpec, cwd: string, onStderr?: (line: string) => void): AcpTransport {
  const child = spawn(spec.command, [...(spec.args ?? [])], {
    cwd,
    env: { ...process.env, ...(spec.env ?? {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split('\n')) if (line !== '') onStderr?.(line)
  })
  const exited = new Promise<void>(resolve => { child.once('exit', () => resolve()) })
  return {
    readable: Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>,
    writable: Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>,
    exited,
    kill: () => { child.kill('SIGTERM') },
  }
}

function textOf(content: unknown): string {
  if (typeof content !== 'object' || content === null) return ''
  if ('type' in content && content.type === 'text' && 'text' in content && typeof content.text === 'string') return content.text
  return JSON.stringify(content)
}

export class AcpSession implements AgentSession {
  readonly ref: { readonly backendId: string; readonly sessionId: string }
  readonly cwd: string
  #status: AgentSessionStatus = 'starting'
  readonly capabilities: SessionCapabilities
  readonly #connection: ClientSideConnection
  readonly #transport: AcpTransport
  readonly #listeners = new Set<(batch: readonly AgentEvent[], meta: { replay: boolean }) => void>()
  readonly #history: AgentEvent[] = []
  #seq = 0
  #turn = 0
  #attemptId: string | undefined
  #attemptText = ''
  #pendingPermission: { requestId: string; resolve: (decision: PermissionDecision) => void; reject: (error: Error) => void } | undefined

  constructor(input: {
    backendId: string
    sessionId: string
    cwd: string
    connection: ClientSideConnection
    transport: AcpTransport
  }) {
    this.ref = { backendId: input.backendId, sessionId: input.sessionId }
    this.cwd = input.cwd
    this.#connection = input.connection
    this.#transport = input.transport
    this.capabilities = {
      native: {},
      permissions: {
        respond: (requestId, decision) => {
          const pending = this.#pendingPermission
          if (pending === undefined || pending.requestId !== requestId) return
          this.#pendingPermission = undefined
          pending.resolve(decision)
        },
        pending: () => [],
      },
    }
    this.#status = 'idle'
    this.#emit([{ type: 'session.ready', sessionId: input.sessionId, cwd: input.cwd, model: 'acp' }])
  }

  get status(): AgentSessionStatus { return this.#status }

  async history(): Promise<readonly AgentEvent[]> { return [...this.#history] }

  subscribe(listener: (batch: readonly AgentEvent[], meta: { replay: boolean }) => void): () => void {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  #emit(events: readonly AgentEvent[]): void {
    this.#history.push(...events)
    for (const listener of this.#listeners) listener(events, { replay: false })
  }

  async submit(input: AgentInput, placement: 'turn' | 'steer' | 'followup' | 'now'): Promise<{ accepted: boolean; reason?: string; dropped?: boolean }> {
    if (placement !== 'turn' || this.#status === 'running') return { accepted: false, reason: 'acp backend accepts one turn at a time', dropped: true }
    this.#status = 'running'
    this.#turn++
    this.#seq++
    this.#attemptId = randomUUID()
    this.#attemptText = ''
    const turn = this.#turn
    const attemptId = this.#attemptId
    this.#emit([
      { type: 'user.message', id: input.clientMessageId, anchor: input.clientMessageId, seq: this.#seq, turn, time: Date.now(), source: 'user', text: input.text, blocks: [{ type: 'text', text: input.text }] },
      { type: 'turn.start', turn, origin: 'user', userMessageId: input.clientMessageId, time: Date.now() },
      { type: 'assistant.attempt.start', attemptId, turn, step: 1, model: 'acp' },
    ])
    void this.#prompt(input.text, turn, attemptId)
    return { accepted: true }
  }

  async #prompt(text: string, turn: number, attemptId: string): Promise<void> {
    try {
      const response = await this.#connection.prompt({ sessionId: this.ref.sessionId, prompt: [{ type: 'text', text }] })
      this.#seq++
      this.#emit([
        { type: 'assistant.attempt.end', attemptId, outcome: 'committed' },
        { type: 'assistant.message', seq: this.#seq, anchor: `${this.ref.sessionId}:${turn}`, turn, step: 1, attemptId, time: Date.now(), model: 'acp', blocks: [{ type: 'text', text: this.#attemptText }], canonical: true },
        {
          type: 'turn.end',
          turn,
          time: Date.now(),
          reason: response.stopReason === 'end_turn' ? { kind: 'completed' }
            : response.stopReason === 'cancelled' ? { kind: 'interrupted' }
              : response.stopReason === 'refusal' ? { kind: 'blocked', detail: 'refusal' }
                : { kind: 'other', label: response.stopReason },
          ...(response.usage === undefined || response.usage === null ? {} : { usage: { input: response.usage.inputTokens, output: response.usage.outputTokens } }),
        },
      ])
      this.#status = 'idle'
    } catch (error) {
      this.#seq++
      this.#emit([
        { type: 'assistant.attempt.end', attemptId, outcome: 'aborted' },
        { type: 'turn.end', turn, time: Date.now(), reason: { kind: 'error', message: error instanceof Error ? error.message : String(error) } },
      ])
      this.#status = 'idle'
    }
  }

  handleUpdate(notification: SessionNotification): void {
    const update = notification.update
    if (update.sessionUpdate === 'agent_message_chunk') {
      const text = textOf(update.content)
      this.#attemptText += text
      if (this.#attemptId !== undefined) this.#emit([{ type: 'assistant.delta', attemptId: this.#attemptId, index: 0, time: Date.now(), delta: { kind: 'text', text } }])
      return
    }
    if (update.sessionUpdate === 'agent_thought_chunk') {
      if (this.#attemptId !== undefined) this.#emit([{ type: 'assistant.delta', attemptId: this.#attemptId, index: 0, time: Date.now(), delta: { kind: 'reasoning', text: textOf(update.content) } }])
      return
    }
    if (update.sessionUpdate === 'tool_call') {
      this.#seq++
      this.#emit([{ type: 'tool.call', seq: this.#seq, turn: this.#turn, step: 1, callId: update.toolCallId, name: update.name ?? update.title, argsJson: JSON.stringify(update.rawInput ?? {}), time: Date.now() }])
      return
    }
    if (update.sessionUpdate === 'tool_call_update' && (update.status === 'completed' || update.status === 'failed')) {
      this.#seq++
      const text = update.content === undefined || update.content === null ? JSON.stringify(update.rawOutput ?? '') : update.content.map(textOf).join('\n')
      this.#emit([{ type: 'tool.result', seq: this.#seq, turn: this.#turn, step: 1, callId: update.toolCallId, isError: update.status === 'failed', time: Date.now(), content: [{ type: 'text', text }], text, ...(update.status === 'failed' ? { errorText: text } : {}) }])
      return
    }
    if (update.sessionUpdate === 'usage_update' && this.#attemptId !== undefined) {
      // ACP usage is cumulative for the session; keep it on the turn-end event only.
      return
    }
  }

  async handlePermission(request: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    const requestId = randomUUID()
    const options = request.options.map(option => ({
      id: option.optionId,
      kind: option.kind === 'allow_once' ? 'allow-once' as const
        : option.kind === 'allow_always' ? 'allow-always' as const
          : 'reject' as const,
      label: option.name,
    }))
    const view: PermissionRequestView = {
      requestId,
      toolName: request.toolCall.name ?? request.toolCall.title ?? 'tool',
      ...(request.toolCall.toolCallId === undefined ? {} : { callId: request.toolCall.toolCallId }),
      ...(request.toolCall.rawInput === undefined ? {} : { input: request.toolCall.rawInput as Record<string, unknown> }),
      options,
    }
    this.#status = 'requires-action'
    this.#emit([{ type: 'permission.request', request: view }])
    const decision = await new Promise<PermissionDecision>((resolve, reject) => { this.#pendingPermission = { requestId, resolve, reject } })
    this.#status = 'running'
    this.#emit([{ type: 'permission.settled', requestId, outcome: decision.kind === 'reject' ? 'rejected' : decision.kind }])
    if (decision.kind === 'reject') return { outcome: { outcome: 'cancelled' } }
    const wanted = decision.kind === 'allow-always' ? ['allow_always', 'allow_once'] : ['allow_once']
    const option = options.find(candidate => wanted.includes(candidate.kind)) ?? options[0]
    return option === undefined ? { outcome: { outcome: 'cancelled' } } : { outcome: { outcome: 'selected', optionId: option.id } }
  }

  async cancel(_cause: CancelCause): Promise<CancelReceipt> {
    await this.#connection.cancel({ sessionId: this.ref.sessionId })
    this.#status = 'idle'
    return { stillQueued: [], outcome: 'confirmed' }
  }

  async dispose(): Promise<void> {
    this.#status = 'disposed'
    this.#transport.kill()
    await this.#transport.exited
  }
}

export async function openAcpSession(input: {
  backendId: string
  cwd: string
  transport: AcpTransport
}): Promise<AcpSession> {
  const stream = ndJsonStream(input.transport.writable, input.transport.readable)
  let session: AcpSession | undefined
  const clientHandler: Client = {
    sessionUpdate: async (notification: SessionNotification) => { session?.handleUpdate(notification) },
    requestPermission: async (request: RequestPermissionRequest) => {
      if (session === undefined) return { outcome: { outcome: 'cancelled' } }
      return session.handlePermission(request)
    },
  }
  const connection = new ClientSideConnection(() => clientHandler, stream)
  await connection.initialize({
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    clientInfo: { name: 'siriusx-kernel-acp', version: '0.0.0' },
  })
  const created = await connection.newSession({ cwd: input.cwd, mcpServers: [] })
  session = new AcpSession({ backendId: input.backendId, sessionId: created.sessionId, cwd: input.cwd, connection, transport: input.transport })
  return session
}

export class AcpBackend implements AgentBackend {
  readonly id: string
  readonly descriptor: { label: string }
  readonly #spec: AcpProcessSpec

  constructor(spec: AcpProcessSpec) {
    this.id = spec.id
    this.descriptor = { label: spec.label }
    this.#spec = spec
  }

  async detect(_host: BackendHost): Promise<BackendDetection> {
    const probe = spawnSync(this.#spec.command, [...(this.#spec.args ?? []), '--version'], { encoding: 'utf8', timeout: 5000 })
    if (probe.error !== undefined) return { installed: false, auth: 'unknown', hint: `install ${this.#spec.command}` }
    return { installed: true, auth: 'unknown', ...(probe.stdout.trim() === '' ? {} : { version: probe.stdout.trim().split('\n')[0]! }) }
  }

  async open(target: OpenTarget, host: BackendHost): Promise<AcpSession> {
    if (target.kind !== 'create') throw new Error('AcpBackend resume is not implemented')
    const transport = spawnAcpTransport(this.#spec, target.cwd, line => host.stderr?.(line))
    return openAcpSession({ backendId: this.id, cwd: target.cwd, transport })
  }
}

/** A CloudKernel that runs an ACP agent inside a CloudExecutor sandbox. */
export interface AcpCloudKernelOptions {
  readonly command: string
  readonly args?: readonly string[]
  readonly permission?: 'allow-once' | 'reject'
  readonly timeoutMs?: number
  /** Test/deployment hook: keep the sandbox running before the first prompt. */
  readonly startDelayMs?: number
  /** Copy one local executable/script into the sandbox before spawning it. */
  readonly copyIn?: { readonly localPath: string; readonly remotePath: string }
  readonly onEvent?: (event: AgentEvent) => void
}

function parseDiffStats(output: string): { filesChanged: number; insertions: number; deletions: number } {
  let filesChanged = 0
  let insertions = 0
  let deletions = 0
  for (const line of output.split('\n')) {
    const [added, removed, file] = line.split('\t')
    if (file === undefined || added === undefined || removed === undefined) continue
    filesChanged++
    if (added !== '-') insertions += Number(added)
    if (removed !== '-') deletions += Number(removed)
  }
  return { filesChanged, insertions, deletions }
}

export class AcpCloudKernel {
  readonly #options: AcpCloudKernelOptions
  constructor(options: AcpCloudKernelOptions) { this.#options = options }

  async run(context: import('@siriusx/cloud-executor').CloudKernelContext): Promise<import('@siriusx/cloud-executor').AssignmentReport> {
    if (this.#options.copyIn !== undefined) await context.sandbox.copyIn(this.#options.copyIn.localPath, this.#options.copyIn.remotePath)
    if (this.#options.startDelayMs !== undefined && this.#options.startDelayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, this.#options.startDelayMs))
    }
    const process = await context.sandbox.spawn(this.#options.command, this.#options.args)
    const session = await openAcpSession({ backendId: 'acp:cloud', cwd: context.cwd, transport: process })
    const events: AgentEvent[] = []
    let finish: (() => void) | undefined
    const done = new Promise<void>(resolve => { finish = resolve })
    const unsubscribe = session.subscribe(batch => {
      events.push(...batch)
      for (const event of batch) {
        this.#options.onEvent?.(event)
        if (event.type === 'permission.request') {
          session.capabilities.permissions?.respond(event.request.requestId, { kind: this.#options.permission ?? 'allow-once' })
        }
        if (event.type === 'turn.end') finish?.()
      }
    })
    await session.submit({ text: context.assignment.input.prompt, clientMessageId: context.assignment.assignmentId }, 'turn')
    await Promise.race([
      done,
      new Promise<void>((_, reject) => setTimeout(() => reject(new Error('ACP cloud turn timed out')), this.#options.timeoutMs ?? 30 * 60 * 1000)),
    ])
    unsubscribe()
    await session.dispose()
    const final = [...events].reverse().find(event => event.type === 'assistant.message')
    const summary = final?.type === 'assistant.message'
      ? final.blocks.map(block => block.text ?? '').join('')
      : 'ACP turn finished without a final message'
    const diff = await context.sandbox.exec(`git -C ${context.cwd} diff --numstat`)
    return { kind: 'ready', summary, diffStats: diff.exitCode === 0 ? parseDiffStats(diff.stdout) : { filesChanged: 0, insertions: 0, deletions: 0 }, diffBasis: 'baseRef' }
  }
}

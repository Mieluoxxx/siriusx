/**
 * Deterministic fake kernel for contract and BG1 scenario tests.
 *
 * It implements the kernel-neutral AgentBackend contract from dsh-TUI. It has
 * no subprocess, filesystem, network, tool executor, or model dependency.
 */
import type {
  AgentBackend,
  AgentEvent,
  AgentEventMeta,
  AgentInput,
  AgentSession,
  AgentSessionRef,
  BackendHost,
  CancelCause,
  CancelReceipt,
  OpenTarget,
  SessionCapabilities,
  SubmitPlacement,
} from '@siriusx/kernel-api'

export type FakeScriptStep =
  | { readonly kind: 'delta'; readonly text: string }
  | { readonly kind: 'tool'; readonly name: string; readonly ok?: boolean }
  | { readonly kind: 'wait'; readonly millis: number }
  | { readonly kind: 'fail'; readonly message: string }
  | { readonly kind: 'permission'; readonly toolName: string; readonly requestId: string }

export interface FakeScenario {
  readonly steps: readonly FakeScriptStep[]
  readonly backgroundAfterTurn?: boolean
}

export interface FakeKernelOptions {
  readonly scenarios?: Readonly<Record<string, FakeScenario>>
  readonly defaultScenario?: FakeScenario
  readonly now?: () => number
  readonly sessionIdPrefix?: string
}

export interface FakeOpenTarget {
  readonly kind: 'create' | 'resume'
  readonly cwd: string
  readonly sessionId?: string
  readonly scenario?: string
}

interface Subscription {
  readonly listener: (batch: readonly AgentEvent[], meta: AgentEventMeta) => void
}

function meta(batch: readonly AgentEvent[], wake: AgentEventMeta['wake'] = 'sync'): AgentEventMeta {
  return { replay: false, wake }
}

export class FakeAgentSession implements AgentSession {
  readonly ref: AgentSessionRef
  readonly cwd: string
  readonly capabilities: SessionCapabilities = {
    native: {},
    permissions: {
      respond: (requestId, decision) => { this.answerPermission(requestId, decision.kind !== 'reject') },
      pending: () => this.#permissionQueue.map(requestId => ({ requestId, toolName: 'fake-tool', options: [] })),
    },
  }
  readonly #now: () => number
  readonly #scenario: FakeScenario
  readonly #history: AgentEvent[] = []
  readonly #subscriptions = new Set<Subscription>()
  readonly #queue: AgentInput[] = []
  #status: AgentSession['status'] = 'idle'
  #turn = 0
  #seq = 0
  #running: Promise<void> | undefined
  #cancelled = false
  #disposed = false
  #permissionQueue: string[] = []
  readonly #permissionWaiters = new Map<string, PromiseWithResolvers<boolean>>()

  constructor(ref: AgentSessionRef, cwd: string, scenario: FakeScenario, now: () => number) {
    this.ref = ref
    this.cwd = cwd
    this.#scenario = scenario
    this.#now = now
  }

  get status(): AgentSession['status'] {
    return this.#status
  }

  async history(): Promise<readonly AgentEvent[]> {
    return [...this.#history]
  }

  subscribe(listener: Subscription['listener']): () => void {
    const subscription = { listener }
    this.#subscriptions.add(subscription)
    return () => { this.#subscriptions.delete(subscription) }
  }

  private emit(...events: AgentEvent[]): void {
    for (const event of events) this.#history.push(event)
    if (events.length === 0 || this.#subscriptions.size === 0) return
    for (const subscription of this.#subscriptions) subscription.listener(events, meta(events))
  }

  private nextSeq(): number {
    return this.#seq++
  }

  private setStatus(status: AgentSession['status']): void {
    if (this.#status === status) return
    this.#status = status
    this.emit({
      type: 'session.status',
      status: status === 'requires-action' ? 'requires-action' : status,
    } as AgentEvent)
  }

  async submit(input: AgentInput, placement: SubmitPlacement): Promise<{ accepted: boolean; reason?: string; dropped?: boolean }> {
    if (this.#disposed) return { accepted: false, reason: 'disposed' }
    if (placement === 'followup' || (placement === 'turn' && this.#status === 'running')) {
      this.#queue.push(input)
      this.emit({ type: 'pending.changed', items: this.#queue.map(item => ({ id: item.clientMessageId, text: item.text, placement: 'followup' as const })) })
      return { accepted: true }
    }
    if (placement === 'now') {
      await this.cancel('interrupt')
      this.#queue.push(input)
      this.#drain()
      return { accepted: true }
    }
    this.#queue.push(input)
    this.#drain()
    return { accepted: true }
  }

  #drain(): void {
    if (this.#running !== undefined || this.#status === 'requires-action') return
    this.#running = this.#runNext().finally(() => {
      this.#running = undefined
      if (this.#queue.length > 0) this.#drain()
      else if (this.#status !== 'requires-action') this.setStatus('idle')
    })
  }

  async #runNext(): Promise<void> {
    const input = this.#queue.shift()
    if (input === undefined) return
    this.#turn += 1
    this.#cancelled = false
    this.setStatus('running')
    this.emit(
      { type: 'turn.start', turn: this.#turn, origin: 'user', userMessageId: input.clientMessageId, time: this.#now() },
      {
        type: 'user.message',
        id: input.clientMessageId as never,
        anchor: input.clientMessageId,
        seq: this.nextSeq(),
        turn: this.#turn,
        time: this.#now(),
        source: 'user',
        text: input.text,
        blocks: [{ type: 'text', text: input.text }],
      },
    )

    const step = this.#scenario.steps
    let text = ''
    try {
      for (const item of step) {
        if (this.#cancelled) break
        switch (item.kind) {
          case 'delta':
            text += item.text
            this.emit({ type: 'assistant.delta', turn: this.#turn, step: 1, attemptId: `attempt-${this.#turn}`, index: 0, time: this.#now(), delta: { kind: 'text', text: item.text } })
            break
          case 'wait':
            await new Promise<void>(resolve => setTimeout(resolve, item.millis))
            break
          case 'tool':
            this.emit({
              type: 'tool.call',
              seq: this.nextSeq(),
              callId: `call-${this.#turn}-${item.name}`,
              turn: this.#turn,
              step: 1,
              name: item.name,
              argsJson: '{"source":"fake"}',
              time: this.#now(),
            })
            const resultText = item.ok === false ? 'fake failure' : 'fake result'
            this.emit({
              type: 'tool.result',
              seq: this.nextSeq(),
              callId: `call-${this.#turn}-${item.name}`,
              turn: this.#turn,
              step: 1,
              isError: item.ok === false,
              content: [{ type: 'text', text: resultText }],
              text: resultText,
              ...(item.ok === false ? { errorText: resultText } : {}),
              time: this.#now(),
            })
            break
          case 'fail':
            throw new Error(item.message)
          case 'permission': {
            const waiter = Promise.withResolvers<boolean>()
            this.#permissionQueue.push(item.requestId)
            this.#permissionWaiters.set(item.requestId, waiter)
            this.setStatus('requires-action')
            this.emit({
              type: 'permission.request',
              request: {
                requestId: item.requestId,
                toolName: item.toolName,
                options: [{ id: 'allow-once', kind: 'allow-once' }, { id: 'reject', kind: 'reject' }],
              },
            })
            const allowed = await waiter.promise
            if (!allowed) {
              this.emit({ type: 'turn.end', turn: this.#turn, reason: { kind: 'blocked', detail: 'permission rejected' }, time: this.#now() })
              return
            }
            this.setStatus('running')
            break
          }
        }
      }
      if (this.#cancelled) {
        this.emit({ type: 'turn.end', turn: this.#turn, reason: { kind: 'interrupted' }, time: this.#now() })
        return
      }
      this.emit({
        type: 'assistant.message',
        seq: this.nextSeq(),
        anchor: `assistant-${this.#turn}`,
        turn: this.#turn,
        step: 1,
        attemptId: `attempt-${this.#turn}`,
        time: this.#now(),
        blocks: [{ type: 'text', text: text || 'fake reply' }],
        canonical: true,
      })
      this.emit({
        type: 'turn.end',
        turn: this.#turn,
        reason: this.#scenario.backgroundAfterTurn
          ? { kind: 'other', label: 'backgrounded' }
          : { kind: 'completed' },
        time: this.#now(),
      })
      if (this.#scenario.backgroundAfterTurn) {
        this.setStatus('running')
        this.emit({ type: 'task.start', taskId: `task-${this.#turn}`, kind: 'bash', description: 'fake background task', background: true, time: this.#now() })
      }
    } catch (error) {
      this.emit({
        type: 'turn.end',
        turn: this.#turn,
        reason: { kind: 'error', message: error instanceof Error ? error.message : String(error) },
        time: this.#now(),
      })
    }
  }

  async cancel(_cause: CancelCause): Promise<CancelReceipt> {
    const stillQueued = this.#queue.map(item => item.clientMessageId)
    this.#cancelled = true
    this.#queue.length = 0
    if (this.#status === 'requires-action') {
      for (const waiter of this.#permissionWaiters.values()) waiter.resolve(false)
      this.#permissionWaiters.clear()
      this.#permissionQueue.length = 0
      this.setStatus('idle')
    }
    return { stillQueued, outcome: 'confirmed' }
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    this.#cancelled = true
    this.#queue.length = 0
    for (const waiter of this.#permissionWaiters.values()) waiter.resolve(false)
    this.#permissionWaiters.clear()
    this.#subscriptions.clear()
    this.#status = 'disposed'
  }

  /** Test-only: answer a parked fake permission prompt. */
  answerPermission(requestId: string, allow: boolean): void {
    const waiter = this.#permissionWaiters.get(requestId)
    if (waiter === undefined) throw new Error(`unknown permission ${requestId}`)
    this.#permissionWaiters.delete(requestId)
    this.#permissionQueue = this.#permissionQueue.filter(item => item !== requestId)
    this.emit({
      type: 'permission.settled',
      requestId,
      outcome: allow ? 'allow-once' : 'rejected',
    })
    waiter.resolve(allow)
  }
}

/** A backend that can only create sessions; no catalog, install or resume. */
export class FakeKernel implements AgentBackend {
  readonly id: string
  readonly descriptor: { readonly label: string }
  readonly #options: FakeKernelOptions
  readonly #sessions = new Map<string, FakeAgentSession>()
  #next = 1

  constructor(options: FakeKernelOptions = {}) {
    this.#options = options
    this.id = options.sessionIdPrefix === undefined ? 'fake' : `fake-${options.sessionIdPrefix}`
    this.descriptor = { label: 'Fake Kernel' }
  }

  async detect(_host: BackendHost): Promise<{ installed: boolean }> {
    return { installed: true }
  }

  async open(target: OpenTarget, _host: BackendHost): Promise<AgentSession> {
    if (target.kind === 'resume') {
      const resumed = this.#sessions.get(target.sessionId)
      if (resumed === undefined || resumed.status === 'disposed') throw new Error('fake session not found')
      return resumed
    }
    const cwd = target.cwd
    const sessionId = `fake-session-${this.#next++}`
    const scenario = this.#options.scenarios?.default ?? this.#options.defaultScenario ?? {
      steps: [{ kind: 'delta', text: 'fake response' }],
    }
    const session = new FakeAgentSession(
      { backendId: this.id, sessionId },
      cwd,
      scenario,
      this.#options.now ?? Date.now,
    )
    this.#sessions.set(sessionId, session)
    return session
  }

  /** Test-only: retrieve a live fake session. */
  session(sessionId: string): FakeAgentSession | undefined {
    return this.#sessions.get(sessionId)
  }

  async close(): Promise<void> {
    await Promise.all([...this.#sessions.values()].map(session => session.dispose()))
    this.#sessions.clear()
  }
}

export function makeFakeInput(text: string, clientMessageId = `input-${text}`): AgentInput {
  return { text, clientMessageId }
}

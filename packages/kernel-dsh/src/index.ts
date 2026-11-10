/**
 * SiriusX's in-process DSH adapter.
 *
 * DSH is upstream-special: it is not an `AgentBackend`; its session is built
 * from a live `Agent`. This wrapper is ours. It reads DSH's public `Agent`
 * surface and durable `session/event` vocabulary, then emits the neutral
 * kernel events used by Executor.
 */
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, TurnEndReason as DshTurnEndReason } from '@deepseek-ai/dsh-session'
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
  TurnEndReason,
} from '@siriusx/kernel-api'

function firstText(content: readonly { readonly type: string; readonly text?: string }[] | undefined): string {
  for (const block of content ?? []) {
    if (block.type === 'text' && block.text !== undefined) return block.text
  }
  return ''
}

function blocks(content: readonly { readonly type: string; readonly text?: string }[] | undefined) {
  return (content ?? []).map(block => ({
    type: block.type,
    ...(block.text === undefined ? {} : { text: block.text }),
  }))
}

function mapTurnEnd(reason: DshTurnEndReason): TurnEndReason {
  switch (reason.kind) {
    case 'completed': return { kind: 'completed' }
    case 'aborted': return reason.reason.kind === 'user' ? { kind: 'interrupted' } : { kind: 'aborted' }
    case 'blocked': return { kind: 'blocked' }
    case 'error': return { kind: 'error', message: reason.error.message, category: reason.error.code }
    case 'interrupted': return { kind: 'interrupted' }
    case 'max-tokens': return { kind: 'other', label: 'max-tokens' }
    case 'forked': return { kind: 'other', label: 'forked' }
    default: return { kind: 'other', label: String((reason as { kind?: unknown }).kind ?? 'unknown') }
  }
}

function statusOf(agent: Agent): AgentSession['status'] {
  if (agent.status === 'running') return 'running'
  return 'idle'
}

export interface DshSessionOwner {
  /** Dispose the handle only when the adapter owns the Agent's lifetime. */
  readonly dispose?: () => Promise<void>
}

export interface DshSessionAdapterOptions extends DshSessionOwner {
  readonly backendId?: string
  readonly now?: () => number
}

/**
 * Adapt one live DSH Agent to AgentSession. The adapter does not dispose the
 * Agent unless `dispose` is supplied, because UI and Executor may share it.
 */
export class DshSessionAdapter implements AgentSession {
  readonly ref: AgentSessionRef
  readonly cwd: string
  readonly capabilities: SessionCapabilities
  readonly #agent: Agent
  readonly #owner: DshSessionOwner
  readonly #now: () => number
  readonly #listeners = new Set<(batch: readonly AgentEvent[], meta: AgentEventMeta) => void>()
  #disposed = false
  #unsubscribe: (() => void) | undefined

  constructor(agent: Agent, options: DshSessionAdapterOptions = {}) {
    this.#agent = agent
    this.#owner = options
    this.#now = options.now ?? Date.now
    this.ref = { backendId: options.backendId ?? 'dsh', sessionId: String(agent.id) }
    this.cwd = agent.session.header.cwd ?? process.cwd()
    this.capabilities = {
      native: { dsh: { kind: 'dsh' } },
    }
  }

  get status(): AgentSession['status'] {
    if (this.#disposed) return 'disposed'
    return statusOf(this.#agent)
  }

  #map(event: SessionEvent): AgentEvent | undefined {
    const seq = Number(event.seq)
    const time = event.time
    switch (event.type) {
      case 'turn/start':
        return { type: 'turn.start', turn: event.data.turn, origin: 'user', time }
      case 'turn/end':
        return { type: 'turn.end', turn: event.data.turn, reason: mapTurnEnd(event.data.reason), time }
      case 'step/start':
        return { type: 'step.start', turn: event.data.turn, step: event.data.step }
      case 'step/end':
        return { type: 'step.end', turn: event.data.turn, step: event.data.step }
      case 'user/message': {
        const message = event.data
        return {
          type: 'user.message',
          id: String(message.id),
          anchor: String(message.id),
          seq,
          time,
          source: message.source.kind === 'user' ? 'user' : 'injected',
          text: firstText(message.content),
          blocks: blocks(message.content),
        }
      }
      case 'assistant/message': {
        const message = event.data.message
        return {
          type: 'assistant.message',
          seq,
          anchor: String(message.id),
          turn: event.data.turn,
          step: event.data.step,
          attemptId: `dsh-${String(event.data.turn)}-${String(event.data.step)}`,
          time,
          blocks: blocks(message.content),
          canonical: true,
          ...(event.data.interrupted === true ? { interrupted: true as const } : {}),
          ...(event.data.usage === undefined ? {} : {
            usage: {
              input: event.data.usage.inputTokens,
              output: event.data.usage.outputTokens,
              ...(event.data.usage.cacheReadTokens === undefined ? {} : { cacheRead: event.data.usage.cacheReadTokens }),
            },
          }),
        }
      }
      case 'tool/call':
        return {
          type: 'tool.call',
          seq,
          turn: event.data.turn,
          step: event.data.step,
          callId: String(event.data.callId),
          name: event.data.name,
          argsJson: event.data.arguments,
          time,
        }
      case 'tool/result': {
        const message = event.data.message
        return {
          type: 'tool.result',
          seq,
          turn: event.data.turn,
          step: event.data.step,
          callId: String(message.toolCallId),
          isError: message.isError === true,
          time,
          content: blocks(message.content),
          text: firstText(message.content),
          ...(message.isError === true
            ? { errorText: event.data.error?.reason ?? firstText(message.content) }
            : {}),
        }
      }
      default:
        return undefined
    }
  }

  async history(): Promise<readonly AgentEvent[]> {
    const ready: AgentEvent = {
      type: 'session.ready',
      sessionId: this.ref.sessionId,
      cwd: this.cwd,
      model: String(this.#agent.options.model),
      ...(this.#agent.options.provider === undefined ? {} : { provider: this.#agent.options.provider }),
    }
    return [ready, ...this.#agent.session.snapshotEvents().flatMap(event => {
      const mapped = this.#map(event)
      return mapped === undefined ? [] : [mapped]
    })]
  }

  subscribe(listener: (batch: readonly AgentEvent[], meta: AgentEventMeta) => void): () => void {
    this.#listeners.add(listener)
    if (this.#unsubscribe === undefined) {
      this.#unsubscribe = this.#agent.ctx.on('session/event', (subject, event) => {
        if (subject !== this.#agent.session) return
        const mapped = this.#map(event)
        if (mapped !== undefined) {
          for (const current of this.#listeners) current([mapped], { replay: false, wake: 'sync' })
        }
      })
    }
    return () => {
      this.#listeners.delete(listener)
      if (this.#listeners.size === 0) {
        this.#unsubscribe?.()
        this.#unsubscribe = undefined
      }
    }
  }

  async submit(input: AgentInput, placement: SubmitPlacement): Promise<{ accepted: boolean; reason?: string }> {
    if (this.#disposed) return { accepted: false, reason: 'disposed' }
    const message = createUserMessage({
      content: [{ type: 'text', text: input.text }],
      source: { kind: 'user' },
    })
    if (placement === 'now') {
      this.#agent.cancel({ kind: 'user' })
      this.#agent.followup(message)
      return { accepted: true }
    }
    if (placement === 'steer') this.#agent.steer(message)
    else this.#agent.followup(message)
    return { accepted: true }
  }

  async cancel(cause: CancelCause): Promise<CancelReceipt> {
    const queued = [
      ...this.#agent.inbox.nextStep.map(message => String(message.id)),
      ...this.#agent.inbox.nextTurn.map(message => String(message.id)),
    ]
    this.#agent.cancel(
      cause === 'dispose' ? { kind: 'disposed' } : { kind: 'user' },
      { keepInbox: cause === 'user' },
    )
    return { stillQueued: cause === 'user' ? queued : [], outcome: 'confirmed' }
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    this.#unsubscribe?.()
    this.#unsubscribe = undefined
    this.#listeners.clear()
    await this.#owner.dispose?.()
  }
}

export interface DshBackendOptions {
  /** Create or resume the DSH Agent through the Host's public Agent registry. */
  readonly open: (target: OpenTarget, host: BackendHost) => Promise<{ agent: Agent; dispose?: () => Promise<void> }>
}

/** AgentBackend wrapper for DSH's always-available in-process kernel. */
export class DshBackend implements AgentBackend {
  readonly id = 'dsh'
  readonly descriptor = { label: 'DSH' }
  readonly #options: DshBackendOptions

  constructor(options: DshBackendOptions) {
    this.#options = options
  }

  async detect(_host: BackendHost): Promise<{ installed: boolean; auth: 'ok' }> {
    return { installed: true, auth: 'ok' }
  }

  async open(target: OpenTarget, host: BackendHost): Promise<AgentSession> {
    const opened = await this.#options.open(target, host)
    return new DshSessionAdapter(opened.agent, {
      ...(opened.dispose === undefined ? {} : { dispose: opened.dispose }),
    })
  }
}

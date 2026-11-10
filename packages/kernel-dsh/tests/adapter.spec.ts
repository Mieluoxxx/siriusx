import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { DshSessionAdapter } from '../src/index.ts'

function fakeAgent(events: SessionEvent[]) {
  let listener: ((subject: unknown, event: SessionEvent) => void) | undefined
  const followup = vi.fn()
  const steer = vi.fn()
  const cancel = vi.fn()
  const unsubscribe = vi.fn()
  const agent = {
    id: 'session-1',
    status: 'idle',
    options: { provider: 'mock', model: 'mock-model' },
    session: {
      id: 'session-1',
      header: { cwd: '/work/repo' },
      snapshotEvents: () => events,
    },
    ctx: {
      on: (_name: string, next: (subject: unknown, event: SessionEvent) => void) => {
        listener = next
        return unsubscribe
      },
    },
    inbox: { nextStep: [{ id: 'queued-step' }], nextTurn: [{ id: 'queued-turn' }] },
    followup,
    steer,
    cancel,
  }
  return { agent: agent as unknown as Agent, followup, steer, cancel, unsubscribe, emit: (event: SessionEvent) => listener?.(agent.session, event) }
}

const event = (value: object): SessionEvent => value as unknown as SessionEvent

describe('DSH in-process adapter', () => {
  it('maps durable DSH events to neutral AgentEvents', async () => {
    const h = fakeAgent([
      event({ type: 'turn/start', seq: 1, time: 10, data: { turn: 1 } }),
      event({
        type: 'user/message', seq: 2, time: 11,
        data: { id: 'user-1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }] },
      }),
      event({
        type: 'assistant/message', seq: 3, time: 12,
        data: {
          turn: 1, step: 1,
          message: { id: 'assistant-1', role: 'assistant', content: [{ type: 'text', text: 'world' }] },
          stream: [], usage: { inputTokens: 3, outputTokens: 2, cacheReadTokens: 1 },
        },
      }),
      event({ type: 'turn/end', seq: 4, time: 13, data: { turn: 1, reason: { kind: 'completed' } } }),
    ])
    const adapter = new DshSessionAdapter(h.agent)
    const history = await adapter.history()
    expect(history[0]?.type).toBe('session.ready')
    expect(history.map(item => item.type)).toEqual([
      'session.ready', 'turn.start', 'user.message', 'assistant.message', 'turn.end',
    ])
    const assistant = history.find(item => item.type === 'assistant.message')
    expect(assistant).toMatchObject({ canonical: true, usage: { input: 3, output: 2, cacheRead: 1 } })
  })

  it('maps live events and drives the DSH Agent', async () => {
    const h = fakeAgent([])
    const adapter = new DshSessionAdapter(h.agent)
    const seen: string[] = []
    const unsubscribe = adapter.subscribe(batch => seen.push(...batch.map(item => item.type)))
    h.emit(event({ type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } }))
    expect(seen).toEqual(['turn.start'])
    expect(await adapter.submit({ text: 'hi', clientMessageId: 'client-1' }, 'steer')).toEqual({ accepted: true })
    expect(h.steer).toHaveBeenCalledOnce()
    expect(h.followup).not.toHaveBeenCalled()
    const receipt = await adapter.cancel('interrupt')
    expect(receipt).toEqual({ stillQueued: [], outcome: 'confirmed' })
    expect(h.cancel).toHaveBeenCalledWith({ kind: 'user' }, { keepInbox: false })
    unsubscribe()
    expect(h.unsubscribe).toHaveBeenCalledOnce()
  })

  it('calls the owned dispose hook exactly once', async () => {
    const h = fakeAgent([])
    const dispose = vi.fn(async () => {})
    const adapter = new DshSessionAdapter(h.agent, { dispose })
    await adapter.dispose()
    await adapter.dispose()
    expect(dispose).toHaveBeenCalledOnce()
  })
})

import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '@siriusx/kernel-api'
import { FakeKernel, makeFakeInput } from '../src/index.ts'

const host = {
  cwd: '/tmp',
  locale: () => 'en' as const,
  debug: () => {},
  warn: () => {},
}

function collect(session: Awaited<ReturnType<FakeKernel['open']>>) {
  const events: AgentEvent[] = []
  session.subscribe(batch => events.push(...batch))
  return events
}

describe('fake kernel', () => {
  it('starts, emits a complete turn, and rejects real side effects', async () => {
    const kernel = new FakeKernel({ defaultScenario: { steps: [{ kind: 'delta', text: 'hello' }] } })
    const session = await kernel.open({ kind: 'create', cwd: '/tmp' }, host)
    const events = collect(session)
    await session.submit(makeFakeInput('hi'), 'turn')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(session.status).toBe('idle')
    expect(events.some(event => event.type === 'turn.start')).toBe(true)
    expect(events.some(event => event.type === 'assistant.message')).toBe(true)
    expect(events.some(event => event.type === 'turn.end')).toBe(true)
    const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/node:child_process|node:net|node:http|fetch\(/u)
  })

  it('queues a followup while a turn is running', async () => {
    const kernel = new FakeKernel({
      defaultScenario: { steps: [{ kind: 'wait', millis: 20 }, { kind: 'delta', text: 'done' }] },
    })
    const session = await kernel.open({ kind: 'create', cwd: '/tmp' }, host)
    const events = collect(session)
    await session.submit(makeFakeInput('first'), 'turn')
    await session.submit(makeFakeInput('second'), 'followup')
    await new Promise(resolve => setTimeout(resolve, 80))
    expect(events.filter(event => event.type === 'turn.start')).toHaveLength(2)
  })

  it('cancels a running turn without dropping a later fresh submit', async () => {
    const kernel = new FakeKernel({
      defaultScenario: { steps: [{ kind: 'wait', millis: 80 }, { kind: 'delta', text: 'late' }] },
    })
    const session = await kernel.open({ kind: 'create', cwd: '/tmp' }, host)
    const events = collect(session)
    await session.submit(makeFakeInput('first'), 'turn')
    const receipt = await session.cancel('interrupt')
    expect(receipt.outcome).toBe('confirmed')
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(events.some(event => event.type === 'turn.end' && event.reason.kind === 'interrupted')).toBe(true)
  })

  it('parks and resumes on a permission prompt through capabilities', async () => {
    const kernel = new FakeKernel({
      defaultScenario: { steps: [{ kind: 'permission', toolName: 'write', requestId: 'perm-1' }, { kind: 'delta', text: 'after' }] },
    })
    const session = await kernel.open({ kind: 'create', cwd: '/tmp' }, host)
    const events = collect(session)
    await session.submit(makeFakeInput('write'), 'turn')
    expect(session.status).toBe('requires-action')
    expect(session.capabilities.permissions?.pending()).toHaveLength(1)
    kernel.session(session.ref.sessionId)?.answerPermission('perm-1', true)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(events.some(event => event.type === 'permission.settled')).toBe(true)
    expect(events.some(event => event.type === 'assistant.message')).toBe(true)
  })
})

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentEvent, BackendHost } from '@siriusx/kernel-api'
import { AcpBackend } from '../src/index.ts'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/fake-acp-agent.mjs')

function host(cwd: string): BackendHost {
  return {
    cwd,
    locale: () => 'en',
    debug: () => {},
    warn: () => {},
  }
}

describe('ACP backend', () => {
  it('detects, opens, prompts, maps updates and permissions', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'siriusx-acp-'))
    roots.push(cwd)
    const backend = new AcpBackend({
      id: 'acp:fake', label: 'Fake ACP', command: process.execPath, args: [fixture],
    })
    expect(await backend.detect(host(cwd))).toMatchObject({ installed: true, version: 'fake-acp 1.0.0' })
    const session = await backend.open({ kind: 'create', cwd }, host(cwd))
    const events: AgentEvent[] = []
    session.subscribe(batch => { events.push(...batch) })
    // Permission asks are answered through the neutral capability.
    const permissionSeen = new Promise<void>(resolve => {
      const timer = setInterval(() => {
        const request = events.find(event => event.type === 'permission.request')
        if (request !== undefined) {
          clearInterval(timer)
          const requestId = request.type === 'permission.request' ? request.request.requestId : ''
          session.capabilities.permissions?.respond(requestId, { kind: 'allow-once' })
          resolve()
        }
      }, 5)
    })
    const accepted = await session.submit({ text: 'hello', clientMessageId: 'm1' }, 'turn')
    expect(accepted.accepted).toBe(true)
    await permissionSeen
    for (let index = 0; index < 100 && session.status !== 'idle'; index++) await new Promise(resolve => setTimeout(resolve, 20))
    expect(session.status).toBe('idle')
    expect(events.some(event => event.type === 'assistant.delta' && event.delta.kind === 'text' && event.delta.text.includes('fake reply: hello'))).toBe(true)
    const ended = events.find(event => event.type === 'turn.end')
    expect(ended).toMatchObject({ type: 'turn.end', reason: { kind: 'completed' } })
    await session.dispose()
  })
})

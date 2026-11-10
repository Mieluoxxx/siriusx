import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentEvent, BackendHost } from '@siriusx/kernel-api'
import { PiJsonBackend } from '../src/index.ts'

const roots: string[] = []
const children: Array<ReturnType<typeof spawn>> = []

afterEach(async () => {
  for (const child of children.splice(0)) child.kill('SIGKILL')
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('Pi JSON backend', () => {
  it('runs two turns through a real pi CLI and keeps the session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'siriusx-pi-'))
    roots.push(root)
    const agentDir = join(root, 'agent')
    const sessionDir = join(root, 'sessions')
    await mkdir(agentDir, { recursive: true })
    await mkdir(sessionDir, { recursive: true })
    const port = await new Promise<number>((resolve, reject) => {
      const probe = createServer()
      probe.once('error', reject)
      probe.listen(0, '127.0.0.1', () => {
        const address = probe.address()
        const chosen = typeof address === 'object' && address !== null ? address.port : 18082
        probe.close(error => { error === undefined ? resolve(chosen) : reject(error) })
      })
    })
    await writeFile(join(agentDir, 'models.json'), JSON.stringify({
      providers: {
        'siriusx-mock': { baseUrl: `http://127.0.0.1:${port}/v1`, api: 'openai-completions', apiKey: 'local-test', models: [{ id: 'siriusx-mock', name: 'SiriusX Mock' }] },
      },
    }))
    const mock = spawn(process.execPath, ['/root/siriusx/evidence/S1/02-conversation/mock-llm-server.mjs'], {
      env: { ...process.env, PORT: String(port), MOCK_LOG: join(root, 'mock.jsonl') }, stdio: ['ignore', 'pipe', 'pipe'],
    })
    children.push(mock)
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('mock server did not start')), 10_000)
      mock.stdout?.on('data', chunk => { if (chunk.toString().includes('"ready"')) { clearTimeout(timer); resolve() } })
      mock.once('error', reject)
    })
    const backend = new PiJsonBackend({
      provider: 'siriusx-mock', model: 'siriusx-mock', sessionDir,
      env: { PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: '1' }, allowTools: false,
    })
    const host: BackendHost = { cwd: root, locale: () => 'en', debug: () => {}, warn: () => {} }
    const session = await backend.open({ kind: 'create', cwd: root }, host)
    const events: AgentEvent[] = []
    session.subscribe(batch => { events.push(...batch) })
    expect((await session.submit({ text: 'first pi turn', clientMessageId: 'pi-1' }, 'turn')).accepted).toBe(true)
    for (let index = 0; index < 600 && !events.some(event => event.type === 'turn.end'); index++) await new Promise(resolve => setTimeout(resolve, 50))
    expect(events.some(event => event.type === 'assistant.delta' && event.delta.kind === 'text' && event.delta.text.includes('SiriusX offline mock reply'))).toBe(true)
    expect(events.find(event => event.type === 'turn.end')).toMatchObject({ type: 'turn.end', reason: { kind: 'completed' } })
    expect((await session.submit({ text: 'second pi turn', clientMessageId: 'pi-2' }, 'turn')).accepted).toBe(true)
    for (let index = 0; index < 600 && events.filter(event => event.type === 'assistant.message').length < 2; index++) await new Promise(resolve => setTimeout(resolve, 50))
    expect(events.filter(event => event.type === 'turn.end')).toHaveLength(2)
    expect(events.filter(event => event.type === 'assistant.message')).toHaveLength(2)
    await session.dispose()
  }, 90_000)
})

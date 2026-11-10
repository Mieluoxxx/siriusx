/** Headless conversation smoke: real Pi CLI + local OpenAI-compatible mock. */
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PiJsonBackend } from '../packages/kernel-pi/src/index.ts'
import type { AgentEvent, BackendHost } from '../packages/kernel-api/src/index.ts'

const root = await mkdtemp(join(tmpdir(), 'siriusx-pi-smoke-'))
const port = 18083
const mock = spawn(process.execPath, ['evidence/S1/02-conversation/mock-llm-server.mjs'], {
  env: { ...process.env, PORT: String(port), MOCK_REPLY: 'SiriusX clean-clone conversation OK.' }, stdio: ['ignore', 'pipe', 'pipe'],
})
await new Promise<void>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('mock server did not start')), 10_000)
  mock.stdout?.on('data', chunk => { if (chunk.toString().includes('"ready"')) { clearTimeout(timer); resolve() } })
  mock.once('error', reject)
})
try {
  const agentDir = join(root, 'agent')
  await mkdir(agentDir, { recursive: true })
  await writeFile(join(agentDir, 'models.json'), JSON.stringify({
    providers: {
      'siriusx-mock': { baseUrl: `http://127.0.0.1:${port}/v1`, api: 'openai-completions', apiKey: 'smoke', models: [{ id: 'siriusx-mock', name: 'SiriusX Mock' }] },
    },
  }))
  const backend = new PiJsonBackend({ provider: 'siriusx-mock', model: 'siriusx-mock', sessionDir: join(root, 'sessions'), env: { PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: '1' }, allowTools: false })
  const host: BackendHost = { cwd: root, locale: () => 'en', debug: () => {}, warn: () => {} }
  const session = await backend.open({ kind: 'create', cwd: root }, host)
  const events: AgentEvent[] = []
  session.subscribe(batch => { events.push(...batch) })
  await session.submit({ text: 'Reply with the clean-clone confirmation.', clientMessageId: 'clean-clone-1' }, 'turn')
  for (let index = 0; index < 600 && !events.some(event => event.type === 'turn.end'); index++) await new Promise(resolve => setTimeout(resolve, 50))
  const text = events.find(event => event.type === 'assistant.message')?.type === 'assistant.message'
    ? (events.find(event => event.type === 'assistant.message') as Extract<AgentEvent, { type: 'assistant.message' }>).blocks.map(block => block.text ?? '').join('')
    : ''
  console.log(JSON.stringify({ text, eventTypes: events.map(event => event.type) }, null, 2))
  if (!text.includes('clean-clone conversation OK')) process.exitCode = 1
  await session.dispose()
} finally {
  mock.kill('SIGKILL')
  await rm(root, { recursive: true, force: true })
}

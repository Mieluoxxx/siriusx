/** Prove the ACP client backend against the real DSH ACP server + local mock model. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentEvent, BackendHost } from '@siriusx/kernel-api'
import { AcpBackend } from '../../../packages/kernel-acp/src/index.ts'

const cwd = await mkdtemp(join(tmpdir(), 'siriusx-real-dsh-acp-'))
const backend = new AcpBackend({
  id: 'acp:dsh',
  label: 'DSH ACP',
  command: process.execPath,
  args: ['/root/siriusx/deepseek-harness/apps/cli/lib/bin.js', '--profile', 'dshacp'],
  env: {
    DSH_HOME: '/tmp/siriusx-s7-acp-home',
    SIRIUSX_MOCK_KEY: 'local-test',
    DSH_TELEMETRY_DISABLED: '1',
  },
})
const host: BackendHost = { cwd, locale: () => 'en', debug: () => {}, warn: () => {} }
const session = await backend.open({ kind: 'create', cwd }, host)
const events: AgentEvent[] = []
session.subscribe(batch => {
  events.push(...batch)
  for (const event of batch) {
    if (event.type === 'permission.request') session.capabilities.permissions?.respond(event.request.requestId, { kind: 'reject' })
  }
})
const accepted = await session.submit({ text: 'Reply with a short sentence.', clientMessageId: 'real-dsh-1' }, 'turn')
for (let index = 0; index < 600 && !events.some(event => event.type === 'turn.end'); index++) {
  await new Promise(resolve => setTimeout(resolve, 100))
}
const final = events.find(event => event.type === 'assistant.message')
const turnEnd = events.find(event => event.type === 'turn.end')
console.log(JSON.stringify({
  accepted,
  sessionId: session.ref.sessionId,
  eventTypes: events.map(event => event.type),
  text: final?.type === 'assistant.message' ? final.blocks.map(block => block.text ?? '').join('') : undefined,
  turnEnd,
}, null, 2))
await session.dispose()
await rm(cwd, { recursive: true, force: true })

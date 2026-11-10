import { Readable, Writable } from 'node:stream'
import { agent, ndJsonStream } from '@agentclientprotocol/sdk'

if (process.argv.includes('--version')) {
  console.log('fake-acp 1.0.0')
  process.exit(0)
}

const app = agent({ name: 'fake-acp' })
app.onRequest('initialize', async () => ({ protocolVersion: 1, agentCapabilities: {}, agentInfo: { name: 'fake-acp', version: '1.0.0' } }))
app.onRequest('session/new', async () => ({ sessionId: 'fake-session' }))
app.onRequest('session/prompt', async ({ params, client }) => {
  await client.request('session/request_permission', {
    sessionId: params.sessionId,
    toolCall: { toolCallId: 'call-1', title: 'Run fake tool', rawInput: { command: 'echo hi' } },
    options: [
      { optionId: 'allow', name: 'Allow once', kind: 'allow_once' },
      { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
    ],
  })
  const text = params.prompt.map(block => block.type === 'text' ? block.text : '').join('')
  await client.notify('session/update', {
    sessionId: params.sessionId,
    update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `fake reply: ${text}` } },
  })
  return { stopReason: 'end_turn' }
})
app.connect(ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)))

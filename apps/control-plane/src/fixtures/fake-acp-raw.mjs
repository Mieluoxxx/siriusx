/** Raw JSON-RPC ACP agent for the cloud-sandbox integration test. */
import { createInterface } from 'node:readline'

const rl = createInterface({ input: process.stdin })
const send = value => process.stdout.write(`${JSON.stringify(value)}\n`)
rl.on('line', line => {
  let message
  try { message = JSON.parse(line) } catch { return }
  if (message.method === 'initialize') {
    send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: 1, agentCapabilities: {} } })
    return
  }
  if (message.method === 'session/new') {
    send({ jsonrpc: '2.0', id: message.id, result: { sessionId: 'docker-session' } })
    return
  }
  if (message.method === 'session/prompt') {
    const text = (message.params?.prompt ?? []).map(block => block.type === 'text' ? block.text : '').join('')
    if (text.includes('[slow]')) await new Promise(resolve => setTimeout(resolve, 60_000))
    send({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: message.params.sessionId,
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `docker acp reply: ${text}` } },
      },
    })
    send({ jsonrpc: '2.0', id: message.id, result: { stopReason: 'end_turn' } })
    return
  }
  if (message.method === 'session/cancel') return
  if (message.id !== undefined) send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `unknown method ${message.method}` } })
})

/**
 * Minimal OpenAI Chat Completions mock for S1 offline verification.
 *
 * It never talks to a model or the internet. Every request is appended to
 * MOCK_LOG so the test can prove the S1 conversation was served locally.
 */
import { appendFile } from 'node:fs/promises'
import { createServer } from 'node:http'

const port = Number(process.env.PORT ?? 18081)
const log = process.env.MOCK_LOG ?? '/tmp/siriusx-mock-llm-requests.jsonl'
const reply = process.env.MOCK_REPLY ?? 'SiriusX offline mock reply: S1 conversation OK.'
const delayMs = Number(process.env.DELAY_MS ?? 0)

function json(response, status, value) {
  const body = JSON.stringify(value)
  response.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
  response.end(body)
}

function sendChunk(response, payload) {
  response.write(`data: ${JSON.stringify(payload)}\n\n`)
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? `127.0.0.1:${port}`}`)
  if (request.method === 'GET' && url.pathname === '/v1/models') {
    json(response, 200, { data: [{ id: 'siriusx-mock', object: 'model' }] })
    return
  }
  if (request.method !== 'POST' || url.pathname !== '/v1/chat/completions') {
    json(response, 404, { error: { message: 'not found' } })
    return
  }

  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  await appendFile(log, `${raw}\n`)

  if (delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs))
  const id = `chatcmpl-siriusx-${Date.now()}`
  const created = Math.floor(Date.now() / 1000)
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  })
  sendChunk(response, {
    id, object: 'chat.completion.chunk', created, model: 'siriusx-mock',
    choices: [{ index: 0, delta: { role: 'assistant', content: reply }, finish_reason: null }],
  })
  sendChunk(response, {
    id, object: 'chat.completion.chunk', created, model: 'siriusx-mock',
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
  })
  sendChunk(response, {
    id, object: 'chat.completion.chunk', created, model: 'siriusx-mock',
    choices: [],
    usage: { prompt_tokens: 5, completion_tokens: 8, total_tokens: 13 },
  })
  response.end('data: [DONE]\n\n')
})

server.listen(port, '127.0.0.1', () => {
  console.log(JSON.stringify({ ready: true, origin: `http://127.0.0.1:${port}`, log }))
})

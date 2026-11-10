import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { GitHubConnector } from '../src/github.ts'
import type { ActionRequest } from '../src/index.ts'

const request = (actionClass: string, target: string, content?: string): ActionRequest => ({
  tenantId: 'tenant-a', botId: 'bot-1', ticketId: 'ticket-1', operatorId: 'app:user-1',
  system: 'github', actionClass, target, ...(content === undefined ? {} : { content }), mandate: { actions: [] },
})

describe('GitHub connector', () => {
  it('reads an issue and opens a pull request with the gateway-held token', async () => {
    const calls: Array<{ url: string; auth?: string; body?: string }> = []
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      calls.push({ url: request.url ?? '', auth: request.headers.authorization ?? '', body: Buffer.concat(chunks).toString() })
      response.writeHead(200, { 'content-type': 'application/json' })
      if (request.method === 'GET') {
        response.end(JSON.stringify({ number: 7, title: 'Bug', body: 'fix it', state: 'open', html_url: 'https://github.com/acme/repo/issues/7' }))
      } else {
        response.end(JSON.stringify({ number: 8, title: 'Fix bug', html_url: 'https://github.com/acme/repo/pull/8' }))
      }
    })
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve()) })
    const address = server.address()
    const port = typeof address === 'object' && address !== null ? address.port : 0
    const connector = new GitHubConnector({ apiBase: `http://127.0.0.1:${port}` })
    const issue = await connector.execute(request('read_issue', 'acme/repo#7'), 'gh-token') as { result: { title: string } }
    expect(issue.result.title).toBe('Bug')
    const pull = await connector.execute(request('open_pull_request', 'acme/repo', JSON.stringify({ head: 'fix', base: 'main', title: 'Fix bug' })), 'gh-token') as { result: { number: number } }
    expect(pull.result.number).toBe(8)
    expect(calls[0]?.auth).toBe('Bearer gh-token')
    expect(calls[1]?.body).toContain('"head":"fix"')
    await new Promise<void>((resolve, reject) => server.close(error => { error === undefined ? resolve() : reject(error) }))
  })
})

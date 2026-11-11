import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { GitHubConnector } from '../src/github.ts'
import { ToolGateway, type ActionRequest, type ToolContext } from '../src/index.ts'

describe('GitHub through the tool gateway', () => {
  it('reads issues and requires approval before opening a pull request', async () => {
    const calls: Array<{ method: string; url: string; auth: string; body: string }> = []
    const github = createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      calls.push({ method: request.method ?? '', url: request.url ?? '', auth: request.headers.authorization ?? '', body: Buffer.concat(chunks).toString() })
      response.writeHead(200, { 'content-type': 'application/json' })
      if (request.method === 'GET') {
        response.end(JSON.stringify({ number: 7, title: 'Fix bug', body: 'details', state: 'open', html_url: 'https://github.com/acme/repo/issues/7' }))
      } else {
        response.end(JSON.stringify({ number: 9, title: 'Fix bug', html_url: 'https://github.com/acme/repo/pull/9' }))
      }
    })
    await new Promise<void>((resolve, reject) => { github.once('error', reject); github.listen(0, '127.0.0.1', () => resolve()) })
    const address = github.address()
    const port = typeof address === 'object' && address !== null ? address.port : 0
    const gateway = new ToolGateway({
      dbPath: ':memory:',
      connectors: { github: new GitHubConnector({ apiBase: `http://127.0.0.1:${port}` }) },
      credentials: { github: 'github-secret' },
    })
    const context: ToolContext = {
      tenantId: 'tenant-a', userId: 'u1', operatorId: 'app:u1', role: 'admin', botId: 'bot', ticketId: 'ticket',
    }
    const base: ActionRequest = {
      tenantId: 'tenant-a', botId: 'bot', ticketId: 'ticket', operatorId: 'app:u1', system: 'github',
      actionClass: 'read_issue', target: 'acme/repo#7', mandate: { actions: [] },
    }
    const read = await gateway.propose(base, context)
    expect(read.status).toBe('executed')
    const write: ActionRequest = {
      ...base, actionClass: 'open_pull_request',
      content: JSON.stringify({ head: 'fix', base: 'main', title: 'Fix bug' }),
    }
    const pending = await gateway.propose(write, context)
    if (pending.status !== 'pending' || pending.approvalId === undefined) throw new Error('expected approval')
    expect(calls.some(call => call.method === 'POST')).toBe(false)
    const approved = await gateway.decide(pending.approvalId, true, context)
    expect(approved.status).toBe('approved')
    const post = calls.find(call => call.method === 'POST')
    expect(post?.auth).toBe('Bearer github-secret')
    expect(post?.body).toContain('"head":"fix"')
    expect(JSON.stringify(await gateway.auditForTicket('ticket'))).not.toContain('github-secret')
    gateway.close()
    await new Promise<void>((resolve, reject) => github.close(error => { error === undefined ? resolve() : reject(error) }))
  })
})

/** Issue -> branch -> file -> pull request through ToolGateway + GitHubConnector. */
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ToolGateway } from '../../../apps/tool-gateway/src/index.ts'
import { GitHubConnector } from '../../../apps/tool-gateway/src/github.ts'

const root = await mkdtemp(join(tmpdir(), 'siriusx-issue-mr-'))
let issueRead = false
let branchCreated = false
let fileWritten = false
let pullRequest: unknown
const api = createServer(async (request, response) => {
  let body = ''
  for await (const chunk of request) body += chunk
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  const json = (value: unknown): void => { response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(value)) }
  if (request.method === 'GET' && url.pathname === '/repos/acme/repo/issues/7') {
    issueRead = true
    json({ number: 7, title: 'Broken button', body: 'Fix the button', state: 'open', html_url: 'http://github.test/acme/repo/issues/7' })
    return
  }
  if (request.method === 'POST' && url.pathname === '/repos/acme/repo/git/refs') {
    branchCreated = JSON.parse(body).ref === 'refs/heads/feature/7'
    json({ ref: 'refs/heads/feature/7' })
    return
  }
  if (request.method === 'PUT' && url.pathname === '/repos/acme/repo/contents/feature.txt') {
    const parsed = JSON.parse(body)
    fileWritten = parsed.message === 'fix #7' && parsed.branch === 'feature/7' && Buffer.from(parsed.content, 'base64').toString() === 'hello from issue 7'
    json({ content: { path: 'feature.txt' }, commit: { sha: 'def456' } })
    return
  }
  if (request.method === 'POST' && url.pathname === '/repos/acme/repo/pulls') {
    pullRequest = JSON.parse(body)
    json({ number: 12, title: 'Fix #7', html_url: 'http://github.test/acme/repo/pull/12' })
    return
  }
  response.writeHead(404).end()
})
await new Promise<void>(resolve => api.listen(19095, '127.0.0.1', () => resolve()))
const gateway = new ToolGateway({
  dbPath: join(root, 'gateway.sqlite'),
  connectors: { github: new GitHubConnector({ apiBase: 'http://127.0.0.1:19095' }) },
  credentials: { github: 'test-token' },
})
const context = { tenantId: 'tenant-gh', botId: 'bot-gh', ticketId: 'ticket-gh', userId: 'admin', operatorId: 'app:admin', approverId: 'admin', role: 'admin' as const }
const run = async (actionClass: string, target: string, content?: string) => {
  const proposed = await gateway.propose({
    tenantId: context.tenantId, botId: context.botId, ticketId: context.ticketId, operatorId: context.operatorId,
    system: 'github', actionClass, target, ...(content === undefined ? {} : { content }), mandate: { actions: [] },
  }, context)
  if (proposed.status === 'executed') return proposed
  if (proposed.approvalId === undefined) throw new Error('missing approval')
  const decided = await gateway.decide(proposed.approvalId, true, context)
  return { ...proposed, decided }
}
const issue = await run('read_issue', 'acme/repo#7')
const branch = await run('create_branch', 'acme/repo', JSON.stringify({ branch: 'feature/7', sha: 'abc123' }))
const file = await run('create_or_update_file', 'acme/repo', JSON.stringify({ path: 'feature.txt', message: 'fix #7', content: 'hello from issue 7', branch: 'feature/7' }))
const pr = await run('open_pull_request', 'acme/repo', JSON.stringify({ head: 'feature/7', base: 'main', title: 'Fix #7', body: 'Closes #7' }))
const audit = gateway.auditForTicket('ticket-gh')
console.log(JSON.stringify({ issueRead, branchCreated, fileWritten, pullRequest, issue, branch, file, pr, audit }, null, 2))
if (!issueRead || !branchCreated || !fileWritten || pullRequest === undefined) process.exitCode = 1
gateway.close()
await new Promise<void>(resolve => api.close(() => resolve()))
await rm(root, { recursive: true, force: true })
process.exit(process.exitCode ?? 0)

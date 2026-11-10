import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ToolGateway, type ActionRequest, type ToolContext } from '../src/index.ts'
import { GitLabConnector } from '../src/gitlab.ts'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

describe('GitLab connector', () => {
  it('runs issue -> branch -> file -> merge request through approvals', async () => {
    const root = await mkdtemp(join(tmpdir(), 'siriusx-gitlab-'))
    roots.push(root)
    let issueRead = false
    let branchCreated = false
    let fileWritten = false
    let mergeRequest: unknown
    const api = createServer(async (request, response) => {
      let body = ''
      for await (const chunk of request) body += chunk
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      const json = (value: unknown): void => { response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(value)) }
      if (request.method === 'GET' && url.pathname === '/projects/group%2Fproject/issues/7') {
        issueRead = true
        json({ iid: 7, title: 'Broken button', description: 'Fix it', state: 'opened', web_url: 'http://gitlab.test/group/project/-/issues/7' })
        return
      }
      if (request.method === 'POST' && url.pathname === '/projects/group%2Fproject/repository/branches') {
        branchCreated = JSON.parse(body).branch === 'feature/7'
        json({ name: 'feature/7' })
        return
      }
      if (request.method === 'POST' && url.pathname === '/projects/group%2Fproject/repository/files/feature.txt') {
        const parsed = JSON.parse(body)
        fileWritten = parsed.commit_message === 'fix #7' && parsed.content === 'hello from issue 7' && parsed.branch === 'feature/7'
        json({ file_path: 'feature.txt' })
        return
      }
      if (request.method === 'POST' && url.pathname === '/projects/group%2Fproject/merge_requests') {
        mergeRequest = JSON.parse(body)
        json({ iid: 12, title: 'Fix #7', web_url: 'http://gitlab.test/group/project/-/merge_requests/12' })
        return
      }
      response.writeHead(404).end()
    })
    await new Promise<void>((resolve, reject) => { api.once('error', reject); api.listen(0, '127.0.0.1', () => resolve()) })
    const address = api.address()
    const port = typeof address === 'object' && address !== null ? address.port : 0
    const gateway = new ToolGateway({
      dbPath: join(root, 'gateway.sqlite'),
      connectors: { gitlab: new GitLabConnector({ apiBase: `http://127.0.0.1:${port}` }) },
      credentials: { gitlab: 'gitlab-token' },
    })
    const context: ToolContext = { tenantId: 'tenant-gl', botId: 'bot', ticketId: 'ticket-gl', userId: 'admin', operatorId: 'app:admin', approverId: 'admin', role: 'admin' }
    const run = async (actionClass: string, target: string, content?: string) => {
      const proposed = await gateway.propose({ tenantId: context.tenantId, botId: context.botId, ticketId: context.ticketId, operatorId: context.operatorId, system: 'gitlab', actionClass, target, ...(content === undefined ? {} : { content }), mandate: { actions: [] } }, context)
      if (proposed.status === 'executed') return proposed
      return gateway.decide(proposed.approvalId!, true, context)
    }
    try {
      await run('read_issue', 'group/project#7')
      await run('create_branch', 'group/project', JSON.stringify({ branch: 'feature/7', sha: 'abc123' }))
      await run('create_or_update_file', 'group/project', JSON.stringify({ path: 'feature.txt', message: 'fix #7', content: 'hello from issue 7', branch: 'feature/7' }))
      await run('open_pull_request', 'group/project', JSON.stringify({ head: 'feature/7', base: 'main', title: 'Fix #7', body: 'Closes #7' }))
      expect(issueRead).toBe(true)
      expect(branchCreated).toBe(true)
      expect(fileWritten).toBe(true)
      expect(mergeRequest).toMatchObject({ source_branch: 'feature/7', target_branch: 'main', title: 'Fix #7' })
      expect(JSON.stringify(gateway.auditForTicket('ticket-gl'))).not.toContain('gitlab-token')
    } finally {
      gateway.close()
      await new Promise<void>((resolve, reject) => api.close(error => { error === undefined ? resolve() : reject(error) }))
    }
  })
})

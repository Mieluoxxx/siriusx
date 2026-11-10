import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CloudExecutor, DockerSandboxProvider } from '@siriusx/cloud-executor'
import type { CreateAssignment } from '@siriusx/contracts/executor'
import { AcpCloudKernel } from '../src/index.ts'

const enabled = process.env.SIRIUSX_DOCKER_TEST === '1'
const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/fake-acp-raw.mjs')

describe.skipIf(!enabled)('cloud ACP in Docker', () => {
  it('runs an ACP agent inside a network-isolated sandbox', async () => {
    const provider = new DockerSandboxProvider()
    const tenantId = `tenant-acp-${Date.now()}`
    const executor = new CloudExecutor({
      provider,
      image: 'teams-bridge:0.2.0',
      network: 'none',
      kernel: new AcpCloudKernel({
        command: 'node',
        args: ['/workspace/fake-acp.mjs'],
        copyIn: { localPath: fixture, remotePath: '/workspace/fake-acp.mjs' },
        permission: 'allow-once',
        timeoutMs: 30_000,
      }),
    })
    const request: CreateAssignment = {
      tenantId,
      assignmentId: '33333333-3333-4333-8333-333333333333',
      ticketId: 'ticket-acp',
      kind: 'start',
      priority: 'normal',
      workspace: {
        kind: 'cloud_project', projectId: 'p1',
        repo: { provider: 'github', host: 'github.com', projectPath: 'acme/repo', cloneUrl: 'https://github.com/acme/repo.git' },
        baseRef: 'main',
      },
      model: { source: 'tenant', id: 'tenant-default' },
      workdirKey: 'ticket-acp',
      input: { prompt: 'hello cloud', followUps: [] },
      secretRefs: [],
      traceId: 'trace-acp',
      clientContext: { operatorId: 'app:user-1', channel: 'app', platform: 'web' },
    }
    await executor.createAssignment(request)
    const done = await executor.wait(request.assignmentId)
    expect(done.state).toBe('reported')
    expect(done.report).toMatchObject({ kind: 'ready', summary: 'docker acp reply: hello cloud' })
    await executor.destroyWorkdir(tenantId, request.assignmentId)
    await executor.removeWorkdir(tenantId, request.workdirKey)
  }, 120_000)
})

import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import type { CreateAssignment } from '@siriusx/contracts/executor'
import { AcpCloudKernel } from '../src/index.ts'
import { CloudExecutor, DockerSandboxProvider, GitClonePreparer } from '@siriusx/cloud-executor'

const enabled = process.env.SIRIUSX_DOCKER_TEST === '1'
const execFileAsync = promisify(execFile)
const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/fake-acp.py')

describe.skipIf(!enabled)('cloud workspace clone', () => {
  it('clones a bound repo into the sandbox and runs ACP in the clone', async () => {
    const root = await mkdtemp(join(tmpdir(), 'siriusx-clone-'))
    try {
      const repo = join(root, 'repo')
      await execFileAsync('git', ['init', '-b', 'main', '-q'], { cwd: root })
      await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: root })
      await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: root })
      await writeFile(join(root, 'app.txt'), 'clone me\n')
      await execFileAsync('git', ['add', '.'], { cwd: root })
      await execFileAsync('git', ['commit', '-q', '-m', 'base'], { cwd: root })
      // Move the worktree under repo so the bare clone path is deterministic.
      await execFileAsync('git', ['clone', '--bare', root, join(root, 'source.git')])
      const provider = new DockerSandboxProvider({
        image: 'arena-sandbox:oc-1.18.15-py',
        binds: [{ hostPath: join(root, 'source.git'), containerPath: '/workspace/source', readOnly: true }],
      })
      const executor = new CloudExecutor({
        provider,
        image: 'arena-sandbox:oc-1.18.15-py',
        network: 'none',
        prepareWorkspace: (request, sandbox) => new GitClonePreparer('/workspace/repo').prepare(request, sandbox),
        kernel: new AcpCloudKernel({
          command: 'python3',
          args: ['/workspace/fake_acp.py'],
          copyIn: { localPath: fixture, remotePath: '/workspace/fake_acp.py' },
          timeoutMs: 30_000,
        }),
      })
      const request: CreateAssignment = {
        tenantId: 'tenant-clone', assignmentId: '44444444-4444-4444-8444-444444444444', ticketId: 'ticket-clone',
        kind: 'start', priority: 'normal',
        workspace: { kind: 'cloud_project', projectId: 'repo', repo: { provider: 'github', host: 'local', projectPath: 'repo', cloneUrl: 'file:///workspace/source' }, baseRef: 'main' },
        model: { source: 'tenant', id: 'tenant-default' }, workdirKey: 'ticket-clone',
        input: { prompt: 'read the clone', followUps: [] }, secretRefs: [], traceId: 'trace-clone',
        clientContext: { operatorId: 'app:user', channel: 'app', platform: 'web' },
      }
      await executor.createAssignment(request)
      const done = await executor.wait(request.assignmentId)
      expect(done.report).toMatchObject({ kind: 'ready' })
      expect(done.report?.kind === 'ready' ? done.report.summary : '').toContain('cloned content: clone me')
      await executor.destroyWorkdir('tenant-clone', request.assignmentId)
      await executor.removeWorkdir('tenant-clone', request.workdirKey)
      executor.close()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 120_000)
})

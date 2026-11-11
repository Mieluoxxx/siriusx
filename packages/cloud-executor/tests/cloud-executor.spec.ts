import { describe, expect, it } from 'vitest'
import type { CreateAssignment } from '@siriusx/contracts/executor'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CloudExecutor, MemorySandboxProvider, type CloudKernel } from '../src/index.ts'

const assignment = (overrides: Partial<CreateAssignment> = {}): CreateAssignment => ({
  tenantId: 'tenant-a',
  assignmentId: '11111111-1111-4111-8111-111111111111',
  ticketId: 'ticket-a',
  kind: 'start',
  priority: 'normal',
  workspace: {
    kind: 'cloud_project',
    projectId: 'project-a',
    repo: { provider: 'github', host: 'github.com', projectPath: 'acme/repo', cloneUrl: 'https://github.com/acme/repo.git' },
    baseRef: 'main',
  },
  model: { source: 'tenant', id: 'tenant-default' },
  workdirKey: 'ticket-a',
  input: { prompt: 'do it', followUps: [] },
  secretRefs: [],
  traceId: 'trace-a',
  clientContext: { operatorId: 'app:user-1', channel: 'app', platform: 'web' },
  ...overrides,
})

const writingKernel: CloudKernel = {
  async run({ sandbox, emitActivity }) {
    await sandbox.exec('write:app.txt')
    emitActivity({ kind: 'tool', name: 'bash', nameClass: 'builtin', durationMs: 3, resultClass: 'ok' })
    return { kind: 'ready', summary: 'cloud done', diffStats: { filesChanged: 1, insertions: 2, deletions: 0 }, diffBasis: 'baseRef' }
  },
}

describe('cloud executor', () => {
  it('runs in a sandbox and emits lifecycle, report and activity', async () => {
    const provider = new MemorySandboxProvider()
    const executor = new CloudExecutor({ provider, kernel: writingKernel })
    await executor.createAssignment(assignment())
    const done = await executor.wait('11111111-1111-4111-8111-111111111111')
    expect(done.state).toBe('reported')
    expect(done.report?.kind).toBe('ready')
    const events = executor.streamEvents(done.assignmentId, 0).events
    expect(events.map(event => event.type)).toContain('activity')
    expect(events.at(-1)).toMatchObject({ type: 'report' })
  })

  it('keeps the ticket workdir after the sandbox is destroyed', async () => {
    const provider = new MemorySandboxProvider()
    const first = new CloudExecutor({ provider, kernel: writingKernel })
    await first.createAssignment(assignment())
    await first.wait('11111111-1111-4111-8111-111111111111')
    await first.destroyWorkdir('tenant-a', '11111111-1111-4111-8111-111111111111')
    const second = new CloudExecutor({
      provider,
      kernel: {
        async run({ sandbox }) {
          const read = await sandbox.exec('read:app.txt')
          expect(read.stdout).toBe('written')
          return { kind: 'ready', summary: 'volume survived', diffStats: { filesChanged: 0, insertions: 0, deletions: 0 }, diffBasis: 'baseRef' }
        },
      },
    })
    await second.createAssignment(assignment({ assignmentId: '22222222-2222-4222-8222-222222222222' }))
    const done = await second.wait('22222222-2222-4222-8222-222222222222')
    expect(done.report?.summary).toBe('volume survived')
    expect(provider.volumeFor('tenant-a', 'ticket-a')?.get('app.txt')).toBe('written')
  })

  it('marks a crashed in-flight assignment lost', async () => {
    const provider = new MemorySandboxProvider()
    let release: (() => void) | undefined
    const gate = new Promise<void>(resolve => { release = resolve })
    const executor = new CloudExecutor({
      provider,
      kernel: { async run() { await gate; return { kind: 'ready', summary: 'too late', diffStats: { filesChanged: 0, insertions: 0, deletions: 0 }, diffBasis: 'baseRef' } } },
    })
    await executor.createAssignment(assignment())
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(await executor.recoverOrphans()).toEqual(['11111111-1111-4111-8111-111111111111'])
    expect(executor.getAssignment('11111111-1111-4111-8111-111111111111').state).toBe('lost')
    release?.()
  })

  it('cancels a running assignment', async () => {
    const provider = new MemorySandboxProvider()
    const executor = new CloudExecutor({
      provider,
      kernel: { async run() { await new Promise(() => {}); return { kind: 'ready', summary: 'never', diffStats: { filesChanged: 0, insertions: 0, deletions: 0 }, diffBasis: 'baseRef' } } },
    })
    await executor.createAssignment(assignment())
    await new Promise(resolve => setTimeout(resolve, 0))
    const cancelled = await executor.cancelAssignment({
      tenantId: 'tenant-a', assignmentId: '11111111-1111-4111-8111-111111111111', mode: 'kill', reason: 'user_stop',
      clientContext: { operatorId: 'app:user-1', channel: 'app', platform: 'web' },
    })
    expect(cancelled.state).toBe('cancelled')
  })
  it('recovers an in-flight assignment from a SQLite store after a process restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'siriusx-cloud-store-'))
    try {
      const dbPath = join(root, 'cloud.sqlite')
      const provider = new MemorySandboxProvider()
      let release: (() => void) | undefined
      const gate = new Promise<void>(resolve => { release = resolve })
      const kernel: CloudKernel = {
        async run() {
          await gate
          return { kind: 'ready', summary: 'late', diffStats: { filesChanged: 0, insertions: 0, deletions: 0 }, diffBasis: 'baseRef' }
        },
      }
      const first = new CloudExecutor({ provider, kernel, dbPath })
      await first.createAssignment(assignment())
      await new Promise(resolve => setTimeout(resolve, 0))
      const second = new CloudExecutor({ provider, kernel, dbPath })
      expect(await second.recoverOrphans()).toEqual(['11111111-1111-4111-8111-111111111111'])
      expect(second.getAssignment('11111111-1111-4111-8111-111111111111').state).toBe('lost')
      expect(second.streamEvents('11111111-1111-4111-8111-111111111111', 0).events.at(-1)).toMatchObject({ type: 'state', state: 'lost' })
      release?.()
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(second.getAssignment('11111111-1111-4111-8111-111111111111').state).toBe('lost')
      first.close()
      second.close()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('disposes live sandboxes on shutdown', async () => {
    const provider = new MemorySandboxProvider()
    const executor = new CloudExecutor({ provider, kernel: writingKernel })
    await executor.createAssignment(assignment())
    await executor.wait('11111111-1111-4111-8111-111111111111')
    expect(provider.activeSandboxIds()).toHaveLength(1)
    await executor.dispose()
    expect(provider.activeSandboxIds()).toEqual([])
  })

  it('fails an assignment when the kernel exceeds the assignment timeout', async () => {
    const provider = new MemorySandboxProvider()
    const executor = new CloudExecutor({
      provider,
      assignmentTimeoutMs: 25,
      kernel: { async run() { return await new Promise(() => {}) } },
    })
    await executor.createAssignment(assignment())
    const done = await executor.wait('11111111-1111-4111-8111-111111111111')
    expect(done.state).toBe('reported')
    expect(done.report).toMatchObject({ kind: 'failed', reason: 'cloud assignment timeout' })
    await executor.dispose()
  })

})

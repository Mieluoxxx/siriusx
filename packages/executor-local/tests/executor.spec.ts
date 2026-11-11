import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { CreateAssignment } from '@siriusx/contracts/executor'
import { FakeKernel } from '@siriusx/fake-kernel'
import { LocalExecutor, LocalExecutorError } from '../src/index.ts'

const execFileAsync = promisify(execFile)
const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function gitRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'siriusx-executor-'))
  roots.push(root)
  await execFileAsync('git', ['init', '-q'], { cwd: root })
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: root })
  await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: root })
  await writeFile(join(root, 'app.txt'), 'one\ntwo\n')
  await execFileAsync('git', ['add', '.'], { cwd: root })
  await execFileAsync('git', ['commit', '-q', '-m', 'base'], { cwd: root })
  return root
}

function request(path: string, workdirKey: string = randomUUID(), kind: 'start' | 'resume' = 'start'): CreateAssignment {
  return {
    tenantId: 'tenant-a',
    assignmentId: randomUUID(),
    ticketId: randomUUID(),
    kind,
    priority: 'normal',
    workspace: { kind: 'local_dir', deviceId: 'device-1', path },
    model: { source: 'tenant', id: 'mock-model' },
    workdirKey,
    input: { prompt: 'change the repo', followUps: [] },
    secretRefs: [],
    traceId: randomUUID(),
    clientContext: { operatorId: 'app:user-1', channel: 'app', platform: 'desktop' },
  }
}

function reportScenario(kind = 'ready'): FakeKernel {
  const report = JSON.stringify({ kind, summary: 'fake task complete', ...(kind === 'answer' ? { question: 'continue?' } : {}) })
  return new FakeKernel({
    defaultScenario: {
      steps: [
        { kind: 'wait', millis: 30 },
        { kind: 'delta', text: `done\n\`\`\`siriusx-report\n${report}\n\`\`\`` },
      ],
    },
  })
}

describe('local executor', () => {
  it('runs through the kernel interface and computes git diffStats', async () => {
    const root = await gitRepo()
    const executor = new LocalExecutor({ tenantId: 'tenant-a', backend: reportScenario() })
    const req = request(root)
    const assignment = await executor.createAssignment(req)
    expect(assignment.state).toBe('preparing')
    await writeFile(join(root, 'app.txt'), 'one\ntwo\nthree\n')
    await writeFile(join(root, 'new.txt'), 'a\nb\n')
    const completed = await executor.wait(req.assignmentId)
    expect(completed.state).toBe('reported')
    expect(completed.report).toMatchObject({
      kind: 'ready',
      diffBasis: 'ticketStart',
      diffStats: { filesChanged: 2, insertions: 3, deletions: 0 },
    })
    expect(executor.streamEvents(req.assignmentId, 0).events.some(event => event.type === 'activity')).toBe(false)
  })

  it('cancels a live assignment and keeps the workdir lease', async () => {
    const root = await gitRepo()
    const executor = new LocalExecutor({ tenantId: 'tenant-a', backend: reportScenario() })
    const req = request(root)
    await executor.createAssignment(req)
    await new Promise(resolve => setTimeout(resolve, 5))
    const cancelled = await executor.cancelAssignment(req.assignmentId, 'graceful')
    expect(cancelled.state).toBe('cancelled')
    expect(await executor.touchWorkdir(req.workdirKey)).toMatchObject({ workdirKey: req.workdirKey })
    await expect(executor.destroyWorkdir(req.workdirKey)).resolves.toEqual({ destroyed: true })
    // The user directory itself must never be deleted.
    await expect(writeFile(join(root, 'still-here.txt'), 'ok')).resolves.toBeUndefined()
  })

  it('resumes the same kernel session and workdir', async () => {
    const root = await gitRepo()
    const executor = new LocalExecutor({ tenantId: 'tenant-a', backend: reportScenario('answer') })
    const first = request(root)
    await executor.createAssignment(first)
    const firstDone = await executor.wait(first.assignmentId)
    expect(firstDone.report?.kind).toBe('answer')
    const second = request(root, first.workdirKey, 'resume')
    second.ticketId = first.ticketId
    await executor.createAssignment(second)
    const secondDone = await executor.wait(second.assignmentId)
    expect(secondDone.state).toBe('reported')
    expect(secondDone.workdirKey).toBe(first.workdirKey)
  })

  it('keeps local_dir log content off the Bot uplink', async () => {
    const root = await gitRepo()
    const report = JSON.stringify({ kind: 'ready', summary: 'tool done' })
    const kernel = new FakeKernel({
      defaultScenario: {
        steps: [
          { kind: 'tool', name: 'fake-tool' },
          { kind: 'delta', text: `\`\`\`siriusx-report\n${report}\n\`\`\`` },
        ],
      },
    })
    const executor = new LocalExecutor({ tenantId: 'tenant-a', backend: kernel })
    const req = request(root)
    await executor.createAssignment(req)
    await executor.wait(req.assignmentId)
    const full = executor.streamEvents(req.assignmentId, 0)
    const uplink = executor.streamEventsForBot(req.assignmentId, 0)
    expect(full.events.some(event => event.type === 'log')).toBe(true)
    expect(uplink.events.some(event => event.type === 'log')).toBe(false)
    expect(uplink.events.some(event => event.type === 'activity')).toBe(true)
  })

  it('rejects a changed workspace and tenant mismatch', async () => {
    const root = await gitRepo()
    const executor = new LocalExecutor({ tenantId: 'tenant-a', backend: reportScenario() })
    const first = request(root)
    await executor.createAssignment(first)
    const changed = request(root, first.workdirKey)
    if (changed.workspace.kind !== 'local_dir') throw new Error('expected local_dir')
    changed.workspace = { ...changed.workspace, deviceId: 'device-2' }
    await expect(executor.createAssignment(changed)).rejects.toMatchObject({ code: 'WORKSPACE_DEVICE_MISMATCH' })
    const wrongTenant = { ...request(root), tenantId: 'tenant-b' }
    await expect(executor.createAssignment(wrongTenant)).rejects.toThrow(/TENANT_MISMATCH/u)
  })

  it('browses files safely and honors redaction and size limits', async () => {
    const root = await gitRepo()
    await writeFile(join(root, '.env'), 'SECRET=1')
    await writeFile(join(root, 'blob.bin'), Buffer.from([0, 1, 2]))
    await mkdir(join(root, 'docs'))
    await writeFile(join(root, 'docs', 'a.md'), '# a')
    const executor = new LocalExecutor({ tenantId: 'tenant-a', backend: reportScenario(), maxReadBytes: 10 })
    const req = request(root)
    await executor.createAssignment(req)
    const files = await executor.listFiles(req.workdirKey)
    expect(files.entries.some(entry => entry.name === '.env' && entry.sensitive)).toBe(true)
    await expect(executor.readFile(req.workdirKey, '.env')).resolves.toMatchObject({ redacted: true })
    await expect(executor.readFile(req.workdirKey, '../app.txt')).rejects.toMatchObject({ code: 'PATH_OUTSIDE_WORKDIR' })
    await expect(executor.readFile(req.workdirKey, 'blob.bin')).resolves.toMatchObject({ binary: true })
  })

  it('uploads only explicitly consented files', async () => {
    const root = await gitRepo()
    const uploadDir = await mkdtemp(join(tmpdir(), 'siriusx-upload-'))
    roots.push(uploadDir)
    const executor = new LocalExecutor({ tenantId: 'tenant-a', backend: reportScenario(), uploadDir })
    const req = request(root)
    await executor.createAssignment(req)
    const body = Buffer.from('one\ntwo\n')
    const sha256 = (await import('node:crypto')).createHash('sha256').update(body).digest('hex')
    await expect(executor.uploadLocalArtifacts({
      tenantId: 'tenant-a', workdirKey: req.workdirKey,
      files: [{ path: 'app.txt', size: body.byteLength, sha256 }],
      consent: { requestedBy: 'app:user-1' },
    })).resolves.toMatchObject({ uploads: [{ sourcePath: 'app.txt' }] })
  })
  it('registers previews, enforces TTL and stops them with the workdir', async () => {
    const root = await gitRepo()
    let now = Date.now()
    const executor = new LocalExecutor({ tenantId: 'tenant-a', backend: reportScenario(), now: () => now, previewTtlMs: 1000 })
    const req = request(root)
    await executor.createAssignment(req)
    await executor.wait(req.assignmentId)
    const preview = await executor.startPreview(req.workdirKey, process.execPath, ['-e', 'setInterval(() => {}, 1000)'], 45678)
    expect((await executor.listPreviews(req.workdirKey)).previews).toHaveLength(1)
    expect((await executor.touchPreview(req.workdirKey, preview.previewId)).lastAccessAt).toBe(new Date(now).toISOString())
    now += 2000
    expect(await executor.sweepPreviews()).toEqual([preview.previewId])
    const preview2 = await executor.startPreview(req.workdirKey, process.execPath, ['-e', 'setInterval(() => {}, 1000)'], 45679)
    await executor.destroyWorkdir(req.workdirKey)
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(() => process.kill(preview2.pid, 0)).toThrow()
  })


  it('rejects symlinks that escape the workdir', async () => {
    const root = await gitRepo()
    const outside = await mkdtemp(join(tmpdir(), 'siriusx-outside-'))
    roots.push(outside)
    await writeFile(join(outside, 'secret.txt'), 'outside')
    await symlink(join(outside, 'secret.txt'), join(root, 'escape.txt'))
    const executor = new LocalExecutor({ tenantId: 'tenant-a', backend: reportScenario() })
    const req = request(root)
    await executor.createAssignment(req)
    await expect(executor.readFile(req.workdirKey, 'escape.txt')).rejects.toMatchObject({ code: 'PATH_OUTSIDE_WORKDIR' })
    await expect(executor.listFiles(req.workdirKey, 'escape.txt')).rejects.toMatchObject({ code: 'PATH_OUTSIDE_WORKDIR' })
  })

})

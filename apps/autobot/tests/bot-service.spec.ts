import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { FakeKernel } from '@siriusx/fake-kernel'
import { LocalExecutor } from '@siriusx/executor-local'
import { AnalyticsCollector, type AnalyticsSink } from '@siriusx/analytics'
import type { AnalyticsEvent } from '@siriusx/contracts/analytics'
import { BOT_SCHEMA, BotService } from '../src/bot-service.ts'

const execFileAsync = promisify(execFile)
const roots: string[] = []
const services: BotService[] = []

afterEach(async () => {
  for (const service of services.splice(0)) service.close()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function dbFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'siriusx-bot-db-'))
  roots.push(dir)
  return join(dir, 'bot.sqlite')
}

async function repo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'siriusx-bot-'))
  roots.push(root)
  await execFileAsync('git', ['init', '-q'], { cwd: root })
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: root })
  await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: root })
  await writeFile(join(root, 'app.txt'), 'one\n')
  await execFileAsync('git', ['add', '.'], { cwd: root })
  await execFileAsync('git', ['commit', '-q', '-m', 'base'], { cwd: root })
  return root
}

function fake(): FakeKernel {
  const report = JSON.stringify({ kind: 'ready', summary: 'implemented' })
  return new FakeKernel({
    defaultScenario: {
      steps: [
        { kind: 'wait', millis: 100 },
        { kind: 'delta', text: `done\n\`\`\`siriusx-report\n${report}\n\`\`\`` },
      ],
    },
  })
}

function makeService(dbPath: string, kernel: FakeKernel, inputDebounceMs = 0): BotService {
  const executor = new LocalExecutor({ tenantId: 'tenant-a', backend: kernel })
  const service = new BotService({ dbPath, executor, inputDebounceMs })
  services.push(service)
  return service
}

describe('single-tenant local Bot loop', () => {
  it('dispatches a local assignment, stores its events, and derives person/review', async () => {
    const root = await repo()
    const dbPath = await dbFile()
    const service = makeService(dbPath, fake())
    const ticketId = service.createTicket({
      tenantId: 'tenant-a',
      workspace: { kind: 'local_dir', deviceId: 'device-1', path: root },
      prompt: 'add a line',
    })
    const pending = service.dispatch(ticketId)
    await new Promise(resolve => setTimeout(resolve, 15))
    await writeFile(join(root, 'app.txt'), 'one\ntwo\n')
    const view = await pending
    expect(view.stage).toBe('person/review')
    expect(view.latestAssignment?.report).toMatchObject({
      kind: 'ready',
      diffStats: { filesChanged: 1, insertions: 1, deletions: 0 },
    })
    const db = new DatabaseSync(dbPath)
    const events = db.prepare('SELECT COUNT(*) AS count FROM assignment_events').get() as { count: number }
    const outbox = db.prepare('SELECT COUNT(*) AS count FROM outbox').get() as { count: number }
    db.close()
    expect(events.count).toBeGreaterThanOrEqual(3)
    expect(outbox.count).toBe(1)
  })

  it('interrupts a running Assignment and resumes the same Ticket', async () => {
    const root = await repo()
    const dbPath = await dbFile()
    const service = makeService(dbPath, fake())
    const ticketId = service.createTicket({
      tenantId: 'tenant-a',
      workspace: { kind: 'local_dir', deviceId: 'device-1', path: root },
      prompt: 'do it',
    })
    const pending = service.dispatch(ticketId)
    await new Promise(resolve => setTimeout(resolve, 20))
    const resumed = await service.sendInput(ticketId, 'also update the docs')
    expect(resumed.latestAssignment?.state).toBe('reported')
    expect(resumed.stage).toBe('idle')
    expect(resumed.closed).toBe(true)
    const db = new DatabaseSync(dbPath)
    const assignments = db.prepare('SELECT kind, state FROM assignments ORDER BY created_at, rowid').all() as Array<{ kind: string; state: string }>
    const inputs = db.prepare('SELECT consumed_by FROM pending_inputs').all() as Array<{ consumed_by: string | null }>
    db.close()
    expect(assignments.map(row => row.kind)).toEqual(['start', 'resume'])
    expect(inputs[0]?.consumed_by).not.toBeNull()
    await pending
  })

  it('coalesces a burst of human inputs before one resume', async () => {
    const root = await repo()
    const dbPath = await dbFile()
    const kernel = new FakeKernel({
      defaultScenario: { steps: [{ kind: 'wait', millis: 80 }, { kind: 'delta', text: 'done' }] },
    })
    const service = makeService(dbPath, kernel, 50)
    const ticketId = service.createTicket({
      tenantId: 'tenant-a',
      workspace: { kind: 'local_dir', deviceId: 'device-1', path: root },
      prompt: 'do it',
    })
    const pending = service.dispatch(ticketId)
    await new Promise(resolve => setTimeout(resolve, 10))
    await service.sendInput(ticketId, 'first')
    await service.sendInput(ticketId, 'second')
    const queued = service.getTicket(ticketId)
    expect(queued.pendingInputs).toBe(2)
    const resumed = await service.flushInput(ticketId)
    expect(resumed.latestAssignment?.state).toBe('reported')
    const db = new DatabaseSync(dbPath)
    const assignments = db.prepare('SELECT kind FROM assignments ORDER BY created_at, rowid').all() as Array<{ kind: string }>
    db.close()
    await pending
    expect(assignments.map(row => row.kind)).toEqual(['start', 'resume'])
  })

  it('records an answer report and resumes after the human reply', async () => {
    const root = await repo()
    const dbPath = await dbFile()
    const report = JSON.stringify({ kind: 'answer', summary: 'need input', question: 'Which branch?' })
    const kernel = new FakeKernel({
      defaultScenario: { steps: [{ kind: 'delta', text: `\`\`\`siriusx-report\n${report}\n\`\`\`` }] },
    })
    const service = makeService(dbPath, kernel)
    const ticketId = service.createTicket({
      tenantId: 'tenant-a',
      workspace: { kind: 'local_dir', deviceId: 'device-1', path: root },
      prompt: 'choose a branch',
    })
    const first = await service.dispatch(ticketId)
    expect(first.stage).toBe('person/answer')
    expect(first.latestAssignment?.report?.kind).toBe('answer')
    const resumed = await service.sendInput(ticketId, 'main')
    expect(resumed.latestAssignment?.report?.kind).toBe('answer')
    const db = new DatabaseSync(dbPath)
    const assignments = db.prepare('SELECT kind FROM assignments ORDER BY created_at, rowid').all() as Array<{ kind: string }>
    db.close()
    expect(assignments.map(row => row.kind)).toEqual(['start', 'resume'])
  })

  it('reconciles orphaned running assignments as lost on startup', async () => {
    const root = await repo()
    const dbPath = await dbFile()
    const db = new DatabaseSync(dbPath)
    db.exec(BOT_SCHEMA)
    const ticketId = '00000000-0000-4000-8000-000000000001'
    const assignmentId = '00000000-0000-4000-8000-000000000002'
    db.prepare('INSERT INTO tickets (id, tenant_id, workspace_json, prompt, model_id, closed, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)')
      .run(ticketId, 'tenant-a', JSON.stringify({ kind: 'local_dir', deviceId: 'd1', path: root }), 'x', 'm', Date.now())
    db.prepare('INSERT INTO assignments (id, tenant_id, ticket_id, kind, workdir_key, state, report_json, last_seq, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, 0, ?)')
      .run(assignmentId, 'tenant-a', ticketId, 'start', ticketId, 'running', Date.now())
    db.close()

    const service = makeService(dbPath, fake())
    const view = service.getTicket(ticketId)
    expect(view.latestAssignment?.state).toBe('lost')
    expect(view.stage).toBe('idle')
  })
  it('emits classified Bot/Executor analytics without source text', async () => {
    class Sink implements AnalyticsSink {
      readonly events: AnalyticsEvent[] = []
      async append(event: AnalyticsEvent): Promise<void> { this.events.push(event) }
    }
    const sink = new Sink()
    const analytics = new AnalyticsCollector({ sink })
    const executor = new LocalExecutor({ tenantId: 'tenant-a', backend: fake() })
    const service = new BotService({ dbPath: await dbFile(), executor, analytics })
    services.push(service)
    const ticketId = service.createTicket({
      tenantId: 'tenant-a',
      workspace: { kind: 'local_dir', deviceId: 'device-1', path: await repo() },
      prompt: 'write a secret prompt',
    })
    await service.dispatch(ticketId)
    await service.sendInput(ticketId, 'follow up secret text')
    await new Promise(resolve => setTimeout(resolve, 20))
    const schemas = new Set(sink.events.map(event => event.schema))
    expect(schemas).toContain('assignment.state_changed')
    expect(schemas).toContain('report.produced')
    expect(schemas).toContain('human.input')
    const serialized = JSON.stringify(sink.events)
    expect(serialized).not.toContain('write a secret prompt')
    expect(serialized).not.toContain('follow up secret text')
    expect(sink.events.find(event => event.schema === 'human.input')?.payload.textLength).toBe('follow up secret text'.length)
  })

})

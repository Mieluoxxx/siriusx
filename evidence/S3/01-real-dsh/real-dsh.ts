/** Temporary S3 integration harness: real DSH AgentLoop + SiriusX LocalExecutor. */
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  mountAgentLoopTestDependencies,
  mountAgentLoopTestHarness,
} from '../src/index.ts'
import { DshBackend } from '/root/siriusx/packages/kernel-dsh/src/index.ts'
import { LocalExecutor } from '/root/siriusx/packages/executor-local/src/index.ts'
import { BotService } from '/root/siriusx/apps/autobot/src/bot-service.ts'

const execFileAsync = promisify(execFile)
const textChunks = (text: string): StreamChunk[] => [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'text-delta', index: 0, text },
  { type: 'block-end', index: 0, block: { type: 'text', text } },
  { type: 'finish', reason: { kind: 'stop' } },
]

class DelayedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  constructor(private readonly texts: readonly string[]) { super() }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    await new Promise(resolve => setTimeout(resolve, 100))
    const text = this.texts[this.requests.length - 1] ?? this.texts.at(-1) ?? ''
    yield* textChunks(text)
  }
}

const root = await mkdtemp(join(tmpdir(), 'siriusx-real-dsh-'))
await execFileAsync('git', ['init', '-q'], { cwd: root })
await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: root })
await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: root })
await writeFile(join(root, 'app.txt'), 'one\n')
await execFileAsync('git', ['add', '.'], { cwd: root })
await execFileAsync('git', ['commit', '-q', '-m', 'base'], { cwd: root })

const ctx = new Context()
try {
  await mountAgentLoopTestDependencies(ctx)
  const report = JSON.stringify({ kind: 'ready', summary: 'real DSH AgentLoop completed' })
  const adapter = new DelayedAdapter([`real DSH reply\n\`\`\`siriusx-report\n${report}\n\`\`\``])
  ctx.llm.registerAdapter(['mock'], adapter)
  const harness = await mountAgentLoopTestHarness(ctx)
  const backend = new DshBackend({
    open: async target => {
      if (target.kind === 'resume') {
        const id = SessionId(target.sessionId)
        const live = ctx.agents.get(id)
        if (live !== undefined) return { agent: live }
        const resumed = await ctx.agents.resume({ resumeSessionId: id, agentOptions: { provider: 'mock', model: 'mock' } })
        return { agent: resumed.agent, dispose: () => resumed.dispose() }
      }
      const id = SessionId(`siriusx-${randomUUID()}`)
      const created = await harness.create(id, { provider: 'mock', model: 'mock' }, { cwd: target.cwd })
      return { agent: created }
    },
  })
  const executor = new LocalExecutor({ tenantId: 'tenant-a', backend, assignmentTimeoutMs: 10_000 })
  const assignmentId = randomUUID()
  const assignment = await executor.createAssignment({
    tenantId: 'tenant-a',
    assignmentId,
    ticketId: randomUUID(),
    kind: 'start',
    priority: 'normal',
    workspace: { kind: 'local_dir', deviceId: 'device-1', path: root },
    model: { source: 'local', id: 'mock' },
    workdirKey: randomUUID(),
    input: { prompt: 'run a real DSH turn', followUps: [] },
    secretRefs: [],
    traceId: randomUUID(),
    clientContext: { operatorId: 'app:test', channel: 'app', platform: 'desktop' },
  })
  await writeFile(join(root, 'app.txt'), 'one\ntwo\n')
  const completed = await executor.wait(assignmentId)
  const events = executor.streamEvents(assignmentId, 0).events

  const dbDir = await mkdtemp(join(tmpdir(), 'siriusx-real-dsh-db-'))
  const botExecutor = new LocalExecutor({ tenantId: 'tenant-a', backend, assignmentTimeoutMs: 10_000 })
  const service = new BotService({ dbPath: join(dbDir, 'bot.sqlite'), executor: botExecutor })
  const ticketId = service.createTicket({
    tenantId: 'tenant-a',
    workspace: { kind: 'local_dir', deviceId: 'device-1', path: root },
    prompt: 'run the full Bot -> Executor -> DSH loop',
  })
  const pending = service.dispatch(ticketId)
  await new Promise(resolve => setTimeout(resolve, 10))
  await writeFile(join(root, 'bot.txt'), 'bot loop\n')
  const view = await pending
  const botReport = view.latestAssignment?.report
  service.close()
  await rm(dbDir, { recursive: true, force: true })

  const interruptDbDir = await mkdtemp(join(tmpdir(), 'siriusx-real-dsh-interrupt-db-'))
  const interruptExecutor = new LocalExecutor({ tenantId: 'tenant-a', backend, assignmentTimeoutMs: 10_000 })
  const interruptService = new BotService({ dbPath: join(interruptDbDir, 'bot.sqlite'), executor: interruptExecutor })
  const interruptTicket = interruptService.createTicket({
    tenantId: 'tenant-a',
    workspace: { kind: 'local_dir', deviceId: 'device-1', path: root },
    prompt: 'interrupt this real DSH assignment',
  })
  const firstPending = interruptService.dispatch(interruptTicket)
  await new Promise(resolve => setTimeout(resolve, 20))
  const interrupted = await interruptService.sendInput(interruptTicket, 'also finish after the interruption')
  await firstPending
  const interruptDb = new (await import('node:sqlite')).DatabaseSync(join(interruptDbDir, 'bot.sqlite'))
  const interruptKinds = (interruptDb.prepare('SELECT kind FROM assignments ORDER BY created_at, rowid').all() as Array<{ kind: string }>).map(row => row.kind)
  interruptDb.close()
  interruptService.close()
  await rm(interruptDbDir, { recursive: true, force: true })

  const answerText = `I need the target branch.\n\`\`\`siriusx-report\n${JSON.stringify({ kind: 'answer', summary: 'need input', question: 'Which branch?' })}\n\`\`\``
  const readyText = `Using main.\n\`\`\`siriusx-report\n${JSON.stringify({ kind: 'ready', summary: 'answer flow complete' })}\n\`\`\``
  const answerAdapter = new DelayedAdapter([answerText, readyText])
  ctx.llm.registerAdapter(['mock-answer'], answerAdapter)
  const answerBackend = new DshBackend({
    open: async target => {
      if (target.kind === 'resume') {
        const id = SessionId(target.sessionId)
        const live = ctx.agents.get(id)
        if (live !== undefined) return { agent: live }
        const resumed = await ctx.agents.resume({ resumeSessionId: id, agentOptions: { provider: 'mock-answer', model: 'mock' } })
        return { agent: resumed.agent, dispose: () => resumed.dispose() }
      }
      const id = SessionId(`siriusx-answer-${randomUUID()}`)
      const created = await harness.create(id, { provider: 'mock-answer', model: 'mock' }, { cwd: target.cwd })
      return { agent: created }
    },
  })
  const answerDbDir = await mkdtemp(join(tmpdir(), 'siriusx-real-dsh-answer-db-'))
  const answerExecutor = new LocalExecutor({ tenantId: 'tenant-a', backend: answerBackend, assignmentTimeoutMs: 10_000 })
  const answerService = new BotService({ dbPath: join(answerDbDir, 'bot.sqlite'), executor: answerExecutor })
  const answerTicket = answerService.createTicket({
    tenantId: 'tenant-a',
    workspace: { kind: 'local_dir', deviceId: 'device-1', path: root },
    prompt: 'ask me which branch',
  })
  const answerView = await answerService.dispatch(answerTicket)
  const answered = await answerService.sendInput(answerTicket, 'main')
  const answerDb = new (await import('node:sqlite')).DatabaseSync(join(answerDbDir, 'bot.sqlite'))
  const answerKinds = (answerDb.prepare('SELECT kind FROM assignments ORDER BY created_at, rowid').all() as Array<{ kind: string }>).map(row => row.kind)
  answerDb.close()
  answerService.close()
  await rm(answerDbDir, { recursive: true, force: true })

  console.log(JSON.stringify({
    initial: assignment.state,
    final: completed.state,
    report: completed.report,
    modelCalls: adapter.requests.length,
    eventTypes: events.map(event => event.type),
    events,
    botStage: view.stage,
    botState: view.latestAssignment?.state,
    botReport,
    interruptStage: interrupted.stage,
    interruptState: interrupted.latestAssignment?.state,
    interruptKinds,
    answerStage: answerView.stage,
    answerReportKind: answerView.latestAssignment?.report?.kind,
    resumedAnswerStage: answered.stage,
    answerKinds,
  }, undefined, 2))
  if (completed.state !== 'reported') process.exitCode = 1
  if (completed.report?.kind !== 'ready') process.exitCode = 1
  if (completed.report.kind === 'ready' && completed.report.diffStats.filesChanged !== 1) process.exitCode = 1
  if (view.stage !== 'person/review') process.exitCode = 1
  if (botReport?.kind !== 'ready') process.exitCode = 1
  if (interruptKinds.join(',') !== 'start,resume') process.exitCode = 1
  if (answerView.stage !== 'person/answer') process.exitCode = 1
  if (answerView.latestAssignment?.report?.kind !== 'answer') process.exitCode = 1
  if (answerKinds.join(',') !== 'start,resume') process.exitCode = 1
} finally {
  await ctx.fiber.dispose()
  await rm(root, { recursive: true, force: true })
}

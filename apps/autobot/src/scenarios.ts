import { randomUUID } from 'node:crypto'
import type { Assignment, AssignmentEvent, CreateAssignment } from '@siriusx/contracts/executor'
import { readyNeedsReview } from '@siriusx/contracts/ticket-stage'
import { ContractError, FakeExecutor, type FakeFile } from './fake-executor.ts'

export interface ScenarioResult {
  readonly scenario: string
  readonly result: 'pass'
  readonly details: Record<string, unknown>
  readonly events: readonly AssignmentEvent[]
}

const now = () => 1_700_000_000_000

function cloudWorkspace(projectId = 'project-1') {
  return {
    kind: 'cloud_project' as const,
    projectId,
    repo: {
      provider: 'github' as const,
      host: 'github.com',
      projectPath: 'acme/repo',
      cloneUrl: 'https://github.com/acme/repo.git',
    },
    baseRef: 'main',
  }
}

function localWorkspace(path = '/work/repo', deviceId = 'device-1') {
  return { kind: 'local_dir' as const, deviceId, path }
}

function request(overrides: Partial<CreateAssignment> = {}): CreateAssignment {
  return {
    tenantId: 'tenant-a',
    assignmentId: randomUUID(),
    ticketId: randomUUID(),
    kind: 'start',
    priority: 'normal',
    workspace: cloudWorkspace(),
    kernel: 'dsh',
    model: { source: 'tenant', id: 'deepseek-chat' },
    workdirKey: randomUUID(),
    input: { prompt: 'do the work', followUps: [] },
    secretRefs: [],
    traceId: randomUUID(),
    clientContext: { operatorId: 'app:user-1', channel: 'app', platform: 'web' },
    ...overrides,
  }
}

function withoutKernel(value: CreateAssignment): CreateAssignment {
  const { kernel: _kernel, ...rest } = value
  return rest
}

function ready(diffStats = { filesChanged: 1, insertions: 2, deletions: 1 }): NonNullable<Assignment['report']> {
  return { kind: 'ready', summary: 'done', diffStats, diffBasis: 'baseRef' }
}

function expectCode(fn: () => unknown, code: string): string {
  try {
    fn()
  } catch (error) {
    if (error instanceof ContractError && error.code === code) return error.code
    throw error
  }
  throw new Error(`expected ${code}`)
}

async function expectCodeAsync(fn: () => Promise<unknown>, code: string): Promise<string> {
  try {
    await fn()
  } catch (error) {
    if (error instanceof ContractError && error.code === code) return error.code
    throw error
  }
  throw new Error(`expected ${code}`)
}

async function backgroundedWaiting(): Promise<ScenarioResult> {
  const executor = new FakeExecutor({ now })
  const req = request()
  await executor.create(req)
  executor.transition(req.assignmentId, 'running')
  executor.transition(req.assignmentId, 'backgrounded')
  const assignment = executor.report(req.assignmentId, { kind: 'waiting', summary: 'still working', reason: '30-minute background timeout' })
  return {
    scenario: 'backgrounded-waiting',
    result: 'pass',
    details: { state: assignment.state, reportKind: assignment.report?.kind },
    events: executor.events(req.assignmentId),
  }
}

async function cancelKill(): Promise<ScenarioResult> {
  const executor = new FakeExecutor({ now })
  const req = request()
  await executor.create(req)
  executor.transition(req.assignmentId, 'running')
  const assignment = executor.cancel(req.assignmentId, 'kill')
  return {
    scenario: 'cancel-kill',
    result: 'pass',
    details: { state: assignment.state, lastSeq: assignment.lastSeq },
    events: executor.events(req.assignmentId),
  }
}

async function interruptResume(): Promise<ScenarioResult> {
  const executor = new FakeExecutor({ now })
  const ticketId = randomUUID()
  const workdirKey = randomUUID()
  const first = request({ ticketId, workdirKey })
  await executor.create(first)
  executor.transition(first.assignmentId, 'running')
  executor.cancel(first.assignmentId, 'graceful')
  const second = request({ ticketId, workdirKey, kind: 'resume' })
  await executor.create(second)
  return {
    scenario: 'interrupt-resume',
    result: 'pass',
    details: {
      firstState: executor.get(first.assignmentId).state,
      secondState: executor.get(second.assignmentId).state,
      sameWorkdir: executor.get(first.assignmentId).workdirKey === executor.get(second.assignmentId).workdirKey,
    },
    events: [...executor.events(first.assignmentId), ...executor.events(second.assignmentId)],
  }
}

async function cancelGraceful(): Promise<ScenarioResult> {
  const executor = new FakeExecutor({ now })
  const req = request()
  await executor.create(req)
  executor.transition(req.assignmentId, 'running')
  const assignment = executor.cancel(req.assignmentId, 'graceful')
  return {
    scenario: 'cancel-graceful',
    result: 'pass',
    details: {
      state: assignment.state,
      states: executor.events(req.assignmentId).flatMap(event => event.type === 'state' ? [event.state] : []),
    },
    events: executor.events(req.assignmentId),
  }
}

async function answerThenResume(): Promise<ScenarioResult> {
  const executor = new FakeExecutor({ now })
  const ticketId = randomUUID()
  const workdirKey = randomUUID()
  const first = request({ ticketId, workdirKey })
  await executor.create(first)
  executor.transition(first.assignmentId, 'running')
  executor.report(first.assignmentId, { kind: 'answer', summary: 'need input', question: 'Which branch?' })
  const second = request({
    ticketId,
    workdirKey,
    kind: 'resume',
    input: { prompt: 'continue', followUps: [{ source: 'human', author: 'app:user-1', text: 'main', triggerId: randomUUID() }] },
  })
  await executor.create(second)
  const assignment = executor.get(second.assignmentId)
  return {
    scenario: 'answer-resume',
    result: 'pass',
    details: { firstWorkdir: first.workdirKey, secondWorkdir: assignment.workdirKey, resumedState: assignment.state },
    events: [...executor.events(first.assignmentId), ...executor.events(second.assignmentId)],
  }
}

async function lost(): Promise<ScenarioResult> {
  const executor = new FakeExecutor({ now })
  const req = request()
  await executor.create(req)
  executor.transition(req.assignmentId, 'running')
  const assignment = executor.lost(req.assignmentId)
  return {
    scenario: 'lost',
    result: 'pass',
    details: { state: assignment.state },
    events: executor.events(req.assignmentId),
  }
}

async function replayDuplicates(): Promise<ScenarioResult> {
  const executor = new FakeExecutor({ now })
  const req = request()
  await executor.create(req)
  executor.log(req.assignmentId, 'one')
  executor.activity(req.assignmentId, {
    type: 'activity', kind: 'tool', name: 'bash', nameClass: 'builtin',
    durationMs: 1, resultClass: 'ok', inputBytes: 2, outputBytes: 3,
  })
  executor.log(req.assignmentId, 'two')
  const replay = executor.streamEvents(req.assignmentId, 0)
  const incremental = executor.streamEvents(req.assignmentId, 3)
  const replayed = replay.events.filter(event => event.seq >= 3)
  const replayAgain = executor.streamEvents(req.assignmentId, 0)
  return {
    scenario: 'duplicate-out-of-order',
    result: 'pass',
    details: {
      replayCount: replay.events.length,
      incrementalCount: incremental.events.length,
      sameTail: JSON.stringify(replayed) === JSON.stringify(incremental.events),
      repeatedReplayStable: JSON.stringify(replay.events) === JSON.stringify(replayAgain.events),
    },
    events: replay.events,
  }
}

async function cancelReportRace(): Promise<ScenarioResult> {
  const executor = new FakeExecutor({ now })
  const req = request()
  await executor.create(req)
  executor.transition(req.assignmentId, 'running')
  const reported = executor.report(req.assignmentId, ready())
  const afterCancel = executor.cancel(req.assignmentId, 'graceful')
  return {
    scenario: 'cancel-report-race',
    result: 'pass',
    details: {
      reportedState: reported.state,
      afterCancelState: afterCancel.state,
      cancelledEvents: executor.events(req.assignmentId).filter(event => event.type === 'state' && event.state === 'cancelled').length,
    },
    events: executor.events(req.assignmentId),
  }
}

async function logTruncation(): Promise<ScenarioResult> {
  const executor = new FakeExecutor({ now, logLimitPerAssignment: 3 })
  const req = request()
  await executor.create(req)
  for (const text of ['l1', 'l2', 'l3', 'l4', 'l5']) executor.log(req.assignmentId, text)
  const streamed = executor.streamEvents(req.assignmentId, 0)
  return {
    scenario: 'log-truncation',
    result: 'pass',
    details: { logsTruncated: streamed.logsTruncated, oldestLogSeq: streamed.oldestLogSeq, logCount: streamed.events.filter(event => event.type === 'log').length },
    events: streamed.events,
  }
}

async function previews(): Promise<ScenarioResult> {
  const executor = new FakeExecutor({ now })
  const req = request()
  await executor.create(req)
  executor.transition(req.assignmentId, 'running')
  const first = executor.startPreview(req.workdirKey, 4100)
  const second = executor.startPreview(req.workdirKey, 4101)
  const lease = executor.touchWorkdir(req.workdirKey)
  const stopped = executor.stopPreviews(req.workdirKey, first.previewId)
  executor.report(req.assignmentId, ready())
  const destroyed = executor.destroyWorkdir(req.workdirKey)
  return {
    scenario: 'previews',
    result: 'pass',
    details: { before: [first.previewId, second.previewId], lease, stopped, remaining: executor.listPreviews(req.workdirKey), destroyed },
    events: executor.events(req.assignmentId),
  }
}

async function files(): Promise<ScenarioResult> {
  const seed: FakeFile[] = [
    { path: 'src/index.ts', type: 'file', content: 'export {}\n', modified: true },
    { path: '.env', type: 'file', content: 'SECRET=1', sensitive: true },
    { path: 'image.png', type: 'file', binary: true, size: 5 },
    { path: 'large.txt', type: 'file', content: 'x'.repeat(20), size: 20 },
    ...Array.from({ length: 5 }, (_, index): FakeFile => ({ path: `docs/${index}.md`, type: 'file', content: '#' })),
  ]
  const executor = new FakeExecutor({ now, files: seed, maxReadBytes: 10, pageSize: 2 })
  const req = request()
  await executor.create(req)
  executor.transition(req.assignmentId, 'running')
  const root = executor.listFiles(req.workdirKey)
  const page2 = executor.listFiles(req.workdirKey, '', root.nextCursor)
  const sensitive = executor.readFile(req.workdirKey, '.env')
  const binary = executor.readFile(req.workdirKey, 'image.png')
  const outside = expectCode(() => executor.readFile(req.workdirKey, '../outside'), 'PATH_OUTSIDE_WORKDIR')
  const tooLarge = expectCode(() => executor.readFile(req.workdirKey, 'large.txt'), 'FILE_TOO_LARGE')
  return {
    scenario: 'file-browse',
    result: 'pass',
    details: { whileRunning: executor.get(req.assignmentId).state, firstPage: root.entries.length, hasNext: root.nextCursor !== undefined, secondPage: page2.entries.length, sensitive, binary, outside, tooLarge },
    events: executor.events(req.assignmentId),
  }
}

async function readyEnd(): Promise<ScenarioResult> {
  const matrix = [
    { changeRequest: true, filesChanged: 0, livePreviews: 0 },
    { changeRequest: false, filesChanged: 1, livePreviews: 0 },
    { changeRequest: false, filesChanged: 0, livePreviews: 1 },
    { changeRequest: false, filesChanged: 0, livePreviews: 0 },
  ].map(input => ({ input, review: readyNeedsReview(input) }))
  return { scenario: 'ready-end', result: 'pass', details: { matrix }, events: [] }
}

async function disconnectAndLateReport(): Promise<ScenarioResult> {
  const offline = new FakeExecutor({ now, localOnline: false })
  const local = withoutKernel(request({ workspace: localWorkspace() }))
  const offlineCode = await expectCodeAsync(() => offline.create(local), 'EXECUTOR_OFFLINE')
  const executor = new FakeExecutor({ now })
  const req = withoutKernel(request({ workspace: localWorkspace() }))
  await executor.create(req)
  executor.transition(req.assignmentId, 'running')
  const beforeLoss = executor.streamEvents(req.assignmentId, 1).events.length
  executor.lost(req.assignmentId)
  const reconnected = executor.streamEvents(req.assignmentId, 1).events
  const lateReportCode = expectCode(() => executor.report(req.assignmentId, ready()), 'INVALID_PAYLOAD')
  return {
    scenario: 'disconnect-late-report',
    result: 'pass',
    details: { offlineCode, reconnectedEvents: reconnected.length, beforeLoss, lateReportCode, finalState: executor.get(req.assignmentId).state },
    events: executor.events(req.assignmentId),
  }
}

async function capacityHuman(): Promise<ScenarioResult> {
  const executor = new FakeExecutor({ now, capacity: 1, humanExtraSlots: 1 })
  const first = request()
  await executor.create(first)
  executor.transition(first.assignmentId, 'running')
  const second = request()
  const noCapacity = await expectCodeAsync(() => executor.create(second), 'NO_CAPACITY')
  const human = request({ priority: 'human' })
  await executor.create(human)
  return {
    scenario: 'capacity-human',
    result: 'pass',
    details: { noCapacity, humanState: executor.get(human.assignmentId).state },
    events: executor.events(human.assignmentId),
  }
}

async function workspaceImmutable(): Promise<ScenarioResult> {
  const executor = new FakeExecutor({ now })
  const first = request()
  await executor.create(first)
  const second = request({ workdirKey: first.workdirKey, workspace: cloudWorkspace('project-2') })
  const project = await expectCodeAsync(() => executor.create(second), 'WORKSPACE_PROJECT_MISMATCH')
  const localFirst = withoutKernel(request({ workspace: localWorkspace('/work/a') }))
  await executor.create(localFirst)
  const localSecond = withoutKernel(request({ workdirKey: localFirst.workdirKey, workspace: localWorkspace('/work/b') }))
  const path = await expectCodeAsync(() => executor.create(localSecond), 'WORKSPACE_PATH_MISMATCH')
  return {
    scenario: 'workspace-immutable',
    result: 'pass',
    details: { project, path },
    events: [...executor.events(first.assignmentId), ...executor.events(localFirst.assignmentId)],
  }
}

export const SCENARIOS = {
  'backgrounded-waiting': backgroundedWaiting,
  'cancel-kill': cancelKill,
  'cancel-graceful': cancelGraceful,
  'interrupt-resume': interruptResume,
  'answer-resume': answerThenResume,
  'lost': lost,
  'duplicate-out-of-order': replayDuplicates,
  'cancel-report-race': cancelReportRace,
  'log-truncation': logTruncation,
  'previews': previews,
  'file-browse': files,
  'ready-end': readyEnd,
  'disconnect-late-report': disconnectAndLateReport,
  'capacity-human': capacityHuman,
  'workspace-immutable': workspaceImmutable,
} as const

export type ScenarioName = keyof typeof SCENARIOS

export async function runScenario(name: ScenarioName): Promise<ScenarioResult> {
  return SCENARIOS[name]()
}

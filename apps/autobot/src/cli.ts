#!/usr/bin/env node
/** BG1 scenario runner: every scenario is deterministic and performs no I/O. */
import { AssignmentEventSchema, parseAnalyticsEvent } from '@siriusx/contracts'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { FakeKernel } from '@siriusx/fake-kernel'
import { LocalExecutor } from '@siriusx/executor-local'
import { PostgresStorage } from '@siriusx/storage'
import { BotService } from './bot-service.ts'
import { startBotServer } from './server.ts'
import { SCENARIOS, runScenario, type ScenarioName } from './scenarios.ts'

function usage(): never {
  console.error('usage: autobot run --scenario <name> [--json] | autobot list')
  process.exit(2)
}

const [command, ...rest] = process.argv.slice(2)
if (command === 'serve') {
  const options = new Map<string, string>()
  for (let index = 0; index < rest.length; index++) {
    const key = rest[index]!
    if (!key.startsWith('--')) usage()
    const value = rest[++index]
    if (value === undefined) usage()
    options.set(key.slice(2), value)
  }
  const analyticsPath = options.get('analytics')
  const databaseUrl = process.env.DATABASE_URL?.trim()
  const storage = databaseUrl === undefined || databaseUrl === '' ? undefined : new PostgresStorage(databaseUrl)
  const server = await startBotServer({
    dbPath: options.get('db') ?? ':memory:',
    port: options.get('port') === undefined ? 4319 : Number(options.get('port')),
    ...(analyticsPath === undefined ? {} : { analyticsPath }),
    ...(storage === undefined ? {} : { storage }),
  })
  console.log(JSON.stringify({ ready: true, url: server.url }, undefined, 2))
  const stop = async (): Promise<void> => { await server.close(); process.exit(0) }
  process.once('SIGINT', () => { void stop() })
  process.once('SIGTERM', () => { void stop() })
  await new Promise<void>(() => {})
  process.exit(0)
}
if (command === 'dispatch') {
  const options = new Map<string, string>()
  for (let index = 0; index < rest.length; index++) {
    const key = rest[index]!
    if (!key.startsWith('--')) usage()
    const value = rest[++index]
    if (value === undefined) usage()
    options.set(key.slice(2), value)
  }
  const repo = options.get('repo')
  const prompt = options.get('prompt')
  if (repo === undefined || prompt === undefined) usage()
  const tempDir = options.get('db') === undefined ? await mkdtemp(join(tmpdir(), 'siriusx-bot-cli-')) : undefined
  const dbPath = options.get('db') ?? join(tempDir!, 'bot.sqlite')
  const report = JSON.stringify({ kind: 'ready', summary: 'fake dispatch complete' })
  const kernel = new FakeKernel({
    defaultScenario: { steps: [{ kind: 'delta', text: `\`\`\`siriusx-report\n${report}\n\`\`\`` }] },
  })
  const executor = new LocalExecutor({ tenantId: options.get('tenant') ?? 'tenant-local', backend: kernel })
  const service = new BotService({ dbPath, executor, ...(process.env.DATABASE_URL?.trim() === undefined || process.env.DATABASE_URL?.trim() === '' ? {} : { storage: new PostgresStorage(process.env.DATABASE_URL!.trim()) }) })
  try {
    await service.initialize()
    const ticketId = await service.createTicket({
      tenantId: options.get('tenant') ?? 'tenant-local',
      workspace: { kind: 'local_dir', deviceId: 'local-device', path: repo },
      prompt,
    })
    const view = await service.dispatch(ticketId)
    console.log(JSON.stringify(view, undefined, 2))
  } finally {
    service.close()
    if (tempDir !== undefined) await rm(tempDir, { recursive: true, force: true })
  }
  process.exit(0)
}
if (command === 'list') {
  for (const name of Object.keys(SCENARIOS)) console.log(name)
  process.exit(0)
}
if (command !== 'run') usage()
let scenario: ScenarioName | undefined
let json = false
for (let index = 0; index < rest.length; index++) {
  const argument = rest[index]!
  if (argument === '--json') { json = true; continue }
  if (argument === '--scenario') { scenario = rest[++index] as ScenarioName; continue }
  if (argument.startsWith('--scenario=')) { scenario = argument.slice('--scenario='.length) as ScenarioName; continue }
  usage()
}
if (scenario === undefined || !(scenario in SCENARIOS)) usage()

const result = await runScenario(scenario)
for (const event of result.events) AssignmentEventSchema.parse(event)
if (json) {
  console.log(JSON.stringify(result, undefined, 2))
} else {
  console.log(`scenario=${result.scenario} result=${result.result}`)
  console.log(`details=${JSON.stringify(result.details)}`)
  for (const event of result.events) console.log(JSON.stringify(event))
}

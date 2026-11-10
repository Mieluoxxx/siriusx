/** Same local_dir ticket through a real Pi CLI and a real DSH ACP server. */
import { execFileSync, spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BotService } from '../../../apps/autobot/src/bot-service.ts'
import { LocalExecutor } from '../../../packages/executor-local/src/index.ts'
import { AcpBackend } from '../../../packages/kernel-acp/src/index.ts'
import { PiJsonBackend } from '../../../packages/kernel-pi/src/index.ts'

const root = await mkdtemp(join(tmpdir(), 'siriusx-kernel-parity-'))
const repo = join(root, 'repo')
const dshHome = join(root, 'dsh-home')
const piHome = join(root, 'pi-home')
const mockScript = '/root/siriusx/evidence/S1/02-conversation/mock-llm-server.mjs'
const dshCli = '/root/siriusx/deepseek-harness/apps/cli/lib/bin.js'
await mkdir(repo, { recursive: true })
await mkdir(dshHome, { recursive: true })
await mkdir(piHome, { recursive: true })
execFileSync('git', ['init', '-q'], { cwd: repo })
execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo })
execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repo })
await writeFile(join(repo, 'app.txt'), 'one\n')
execFileSync('git', ['add', '.'], { cwd: repo })
execFileSync('git', ['commit', '-q', '-m', 'base'], { cwd: repo })

const port = 18084
const mock = spawn(process.execPath, [mockScript], {
  env: { ...process.env, PORT: String(port), MOCK_LOG: join(root, 'mock.jsonl'), MOCK_REPLY: '```siriusx-report\n{"kind":"ready","summary":"kernel parity"}\n```' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
await new Promise<void>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('mock server did not start')), 10_000)
  mock.stdout?.on('data', chunk => { if (chunk.toString().includes('"ready"')) { clearTimeout(timer); resolve() } })
  mock.once('error', reject)
})

const dshEnv = { ...process.env, DSH_HOME: dshHome, SIRIUSX_MOCK_KEY: 'local-test', DSH_TELEMETRY_DISABLED: '1' }
execFileSync(process.execPath, [dshCli, '--from-default-profile', 'acp', '--profile', 'parityacp', '--dump-config'], { env: dshEnv, stdio: 'ignore' })
execFileSync(process.execPath, [dshCli, 'plugin', '--profile', 'parityacp', 'add', 'link:/root/siriusx/plugins/telemetry-off'], { env: dshEnv, stdio: 'ignore' })
await writeFile(join(dshHome, 'profiles', 'parityacp', 'cordis.patch.yml'), `- id: llm-pi-ai
  config:
    providers:
      siriusx-mock:
        displayName: SiriusX Mock
        apiKeyEnv: SIRIUSX_MOCK_KEY
        api: openai-completions
        baseURL: http://127.0.0.1:${port}/v1
        models:
          - id: siriusx-mock
            name: SiriusX Mock
            contextWindow: 65536
            maxTokens: 2048
            input: [text]
- id: agent-default-model
  config:
    provider: siriusx-mock
    model: siriusx-mock
- id: acp
  config:
    provider: siriusx-mock
    model: siriusx-mock
`)

async function run(name: string, backend: PiJsonBackend | AcpBackend) {
  const dbPath = join(root, `${name}.sqlite`)
  const executor = new LocalExecutor({ tenantId: 'tenant-a', backend })
  const service = new BotService({ dbPath, executor })
  try {
    const ticketId = service.createTicket({
      tenantId: 'tenant-a',
      workspace: { kind: 'local_dir', deviceId: 'device-1', path: repo },
      prompt: 'same ticket for both kernels',
    })
    const view = await service.dispatch(ticketId)
    return { name, stage: view.stage, report: view.latestAssignment?.report, events: service.eventsForTicket(ticketId).map(event => event.type) }
  } finally {
    service.close()
  }
}

const results = []
try {
  results.push(await run('dsh', new AcpBackend({
    id: 'acp:dsh', label: 'DSH ACP', command: process.execPath,
    args: [dshCli, '--profile', 'parityacp'], env: { DSH_HOME: dshHome, SIRIUSX_MOCK_KEY: 'local-test', DSH_TELEMETRY_DISABLED: '1' },
  })))
  await mkdir(join(piHome, 'agent'), { recursive: true })
  await writeFile(join(piHome, 'agent', 'models.json'), JSON.stringify({
    providers: { 'siriusx-mock': { baseUrl: `http://127.0.0.1:${port}/v1`, api: 'openai-completions', apiKey: 'local-test', models: [{ id: 'siriusx-mock', name: 'SiriusX Mock' }] } },
  }))
  results.push(await run('pi', new PiJsonBackend({
    provider: 'siriusx-mock', model: 'siriusx-mock', sessionDir: join(piHome, 'sessions'),
    env: { PI_CODING_AGENT_DIR: join(piHome, 'agent'), PI_OFFLINE: '1' }, allowTools: false,
  })))
  const first = results[0]
  const parity = results.every(result => result.stage === first?.stage && result.report?.kind === first?.report?.kind && JSON.stringify(result.events) === JSON.stringify(first?.events))
  console.log(JSON.stringify({ results, parity }, null, 2))
  if (!parity) process.exitCode = 1
} finally {
  mock.kill('SIGKILL')
  await rm(root, { recursive: true, force: true })
  process.exit(process.exitCode ?? 0)
}

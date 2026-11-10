/** Compare neutral ACP event sequences from local DSH and cloud-sandbox DSH. */
import { execFileSync, spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AcpBackend, AcpCloudKernel } from '../../../packages/kernel-acp/src/index.ts'
import { CloudExecutor, DockerSandboxProvider } from '../../../packages/cloud-executor/src/index.ts'
import type { AgentEvent } from '../../../packages/kernel-api/src/index.ts'
import type { CreateAssignment } from '../../../packages/contracts/src/executor.ts'

const root = await mkdtemp(join(tmpdir(), 'siriusx-sequence-'))
const dshHome = join(root, 'dsh-home')
const localHome = join(root, 'dsh-home-local')
const cloudHome = join(root, 'dsh-home-cloud')
const repo = join(root, 'repo')
const mockScript = '/root/siriusx/evidence/S1/02-conversation/mock-llm-server.mjs'
const dshCli = '/root/siriusx/deepseek-harness/apps/cli/lib/bin.js'
await mkdir(repo, { recursive: true }); await mkdir(dshHome, { recursive: true })
execFileSync(process.execPath, [dshCli, '--from-default-profile', 'acp', '--profile', 'cloudacp', '--dump-config'], { env: { ...process.env, DSH_HOME: dshHome }, stdio: 'ignore' })
await writeFile(join(dshHome, 'profiles/cloudacp/cordis.patch.yml'), `- id: llm-pi-ai
  config:
    providers:
      siriusx-mock:
        displayName: SiriusX Mock
        apiKeyEnv: SIRIUSX_MOCK_KEY
        api: openai-completions
        baseURL: http://127.0.0.1:18081/v1
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
execFileSync('chmod', ['-R', 'a+rwX', dshHome])
execFileSync('cp', ['-a', dshHome, localHome])
execFileSync('cp', ['-a', dshHome, cloudHome])
const mock = spawn(process.execPath, [mockScript], { env: { ...process.env, PORT: '18081', MOCK_LOG: join(root, 'mock.jsonl'), MOCK_REPLY: 'same ACP scenario' }, stdio: ['ignore', 'pipe', 'pipe'] })
await new Promise<void>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('mock did not start')), 10_000)
  mock.stdout?.on('data', chunk => { if (chunk.toString().includes('"ready"')) { clearTimeout(timer); resolve() } })
})
const prompt = 'run the same ACP scenario'
const localEvents: AgentEvent[] = []
const local = new AcpBackend({ id: 'acp:local-dsh', label: 'DSH local', command: process.execPath, args: [dshCli, '--profile', 'cloudacp'], env: { DSH_HOME: localHome, SIRIUSX_MOCK_KEY: 'local-test', DSH_TELEMETRY_DISABLED: '1' } })
const session = await local.open({ kind: 'create', cwd: repo }, { cwd: repo, locale: () => 'en', debug: () => {}, warn: () => {} })
session.subscribe(batch => { localEvents.push(...batch) })
await session.submit({ text: prompt, clientMessageId: 'sequence-1' }, 'turn')
for (let index = 0; index < 600 && !localEvents.some(event => event.type === 'turn.end'); index++) await new Promise(resolve => setTimeout(resolve, 50))
await session.dispose()
const provider = new DockerSandboxProvider({
  image: 'arena-sandbox:oc-1.18.15-py',
  binds: [
    { hostPath: '/root/siriusx/deepseek-harness', containerPath: '/opt/dsh', readOnly: true },
    { hostPath: '/opt/node24', containerPath: '/opt/node24', readOnly: true },
    { hostPath: cloudHome, containerPath: '/workspace/dsh-home' },
    { hostPath: mockScript, containerPath: '/workspace/mock.mjs', readOnly: true },
  ],
})
const cloudEvents: AgentEvent[] = []
const executor = new CloudExecutor({
  provider, image: 'arena-sandbox:oc-1.18.15-py', network: 'none',
  kernel: new AcpCloudKernel({
    command: 'sh', args: ['-c', '/opt/node24/bin/node /workspace/mock.mjs >/tmp/mock.log 2>&1 & sleep 1; exec env DSH_HOME=/workspace/dsh-home SIRIUSX_MOCK_KEY=local-test DSH_TELEMETRY_DISABLED=1 /opt/node24/bin/node /opt/dsh/apps/cli/lib/bin.js --profile cloudacp'],
    timeoutMs: 120_000, onEvent: event => cloudEvents.push(event),
  }),
})
const request: CreateAssignment = {
  tenantId: 'tenant-sequence', assignmentId: '77777777-7777-4777-8777-777777777777', ticketId: 'ticket-sequence',
  kind: 'start', priority: 'normal',
  workspace: { kind: 'cloud_project', projectId: 'repo', repo: { provider: 'github', host: 'example.invalid', projectPath: 'repo', cloneUrl: 'https://example.invalid/repo.git' }, baseRef: 'main' },
  kernel: 'dsh', model: { source: 'tenant', id: 'tenant-default' }, workdirKey: 'ticket-sequence',
  input: { prompt, followUps: [] }, secretRefs: [], traceId: 'trace-sequence',
  clientContext: { operatorId: 'app:user', channel: 'app', platform: 'web' },
}
try {
  await executor.createAssignment(request)
  const done = await executor.wait(request.assignmentId)
  const localTypes = localEvents.map(event => event.type)
  const cloudTypes = cloudEvents.map(event => event.type)
  const result = { localTypes, cloudTypes, localReport: localEvents.find(event => event.type === 'assistant.message')?.type, cloudReport: done.report, same: JSON.stringify(localTypes) === JSON.stringify(cloudTypes) }
  console.log(JSON.stringify(result, null, 2))
  if (!result.same || done.report?.kind !== 'ready') process.exitCode = 1
} finally {
  mock.kill('SIGKILL'); executor.close();
  await rm(root, { recursive: true, force: true }); process.exit(process.exitCode ?? 0)
}

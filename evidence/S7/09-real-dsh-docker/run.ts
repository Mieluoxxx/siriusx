/** Real DSH ACP server inside a Docker sandbox, driven by CloudExecutor. */
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CloudExecutor, DockerSandboxProvider } from '../../../packages/cloud-executor/src/index.ts'
import { AcpCloudKernel } from '../../../packages/kernel-acp/src/index.ts'
import type { CreateAssignment } from '../../../packages/contracts/src/executor.ts'

const root = await mkdtemp(join(tmpdir(), 'siriusx-dsh-docker-'))
const dshHome = join(root, 'dsh-home')
const repo = join(root, 'repo')
const mockScript = '/root/siriusx/evidence/S1/02-conversation/mock-llm-server.mjs'
const dshCli = '/root/siriusx/deepseek-harness/apps/cli/lib/bin.js'
await mkdir(root, { recursive: true })
await mkdir(repo, { recursive: true })
execFileSync(process.execPath, [dshCli, '--from-default-profile', 'acp', '--profile', 'cloudacp', '--dump-config'], {
  env: { ...process.env, DSH_HOME: dshHome }, stdio: 'ignore',
})
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
const provider = new DockerSandboxProvider({
  image: 'arena-sandbox:oc-1.18.15-py',
  binds: [
    { hostPath: '/root/siriusx/deepseek-harness', containerPath: '/opt/dsh', readOnly: true },
    { hostPath: '/opt/node24', containerPath: '/opt/node24', readOnly: true },
    { hostPath: dshHome, containerPath: '/workspace/dsh-home' },
    { hostPath: mockScript, containerPath: '/workspace/mock.mjs', readOnly: true },
  ],
})
const executor = new CloudExecutor({
  provider,
  image: 'arena-sandbox:oc-1.18.15-py',
  network: 'none',
  kernel: new AcpCloudKernel({
    command: 'sh',
    args: ['-c', '/opt/node24/bin/node /workspace/mock.mjs >/tmp/mock.log 2>&1 & sleep 1; exec env DSH_HOME=/workspace/dsh-home SIRIUSX_MOCK_KEY=local-test DSH_TELEMETRY_DISABLED=1 /opt/node24/bin/node /opt/dsh/apps/cli/lib/bin.js --profile cloudacp'],
    timeoutMs: 120_000,
  }),
})
const request: CreateAssignment = {
  tenantId: 'tenant-dsh-docker',
  assignmentId: '55555555-5555-4555-8555-555555555555',
  ticketId: 'ticket-dsh-docker',
  kind: 'start', priority: 'normal',
  workspace: { kind: 'cloud_project', projectId: 'repo', repo: { provider: 'github', host: 'example.invalid', projectPath: 'repo', cloneUrl: 'https://example.invalid/repo.git' }, baseRef: 'main' },
  kernel: 'dsh', model: { source: 'tenant', id: 'tenant-default' }, workdirKey: 'ticket-dsh-docker',
  input: { prompt: 'Reply with a short DSH-in-Docker sentence.', followUps: [] }, secretRefs: [], traceId: 'trace-dsh-docker',
  clientContext: { operatorId: 'app:user', channel: 'app', platform: 'web' },
}
try {
  await executor.createAssignment(request)
  const done = await executor.wait(request.assignmentId)
  console.log(JSON.stringify({ state: done.state, report: done.report, events: executor.streamEventsForBot(request.assignmentId, 0).events }, null, 2))
  if (done.report?.kind !== 'ready') process.exitCode = 1
} finally {
  executor.close()
  await rm(root, { recursive: true, force: true })
  process.exit(process.exitCode ?? 0)
}

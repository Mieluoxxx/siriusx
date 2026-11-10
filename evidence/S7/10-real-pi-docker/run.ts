/** Real Pi CLI JSON mode inside a Docker sandbox, driven by CloudExecutor. */
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CloudExecutor, DockerSandboxProvider } from '../../../packages/cloud-executor/src/index.ts'
import { PiCloudKernel } from '../../../packages/kernel-pi/src/index.ts'
import type { CreateAssignment } from '../../../packages/contracts/src/executor.ts'

const root = await mkdtemp(join(tmpdir(), 'siriusx-pi-docker-'))
const piHome = join(root, 'pi-home')
const mockScript = '/root/siriusx/evidence/S1/02-conversation/mock-llm-server.mjs'
const piRelease = '/root/.pi/agent/install/releases/1.5.0'
const piCli = '/opt/pi/node_modules/@earendil-works/pi-coding-agent/dist/cli.js'
await mkdir(piHome, { recursive: true })
await writeFile(join(piHome, 'models.json'), JSON.stringify({
  providers: { 'siriusx-mock': { baseUrl: 'http://127.0.0.1:18081/v1', api: 'openai-completions', apiKey: 'local-test', models: [{ id: 'siriusx-mock', name: 'SiriusX Mock' }] } },
}))
execFileSync('chmod', ['-R', 'a+rwX', piHome])
const provider = new DockerSandboxProvider({
  image: 'arena-sandbox:oc-1.18.15-py',
  binds: [
    { hostPath: piRelease, containerPath: '/opt/pi', readOnly: true },
    { hostPath: '/opt/node24', containerPath: '/opt/node24', readOnly: true },
    { hostPath: piHome, containerPath: '/workspace/pi-home' },
    { hostPath: mockScript, containerPath: '/workspace/mock.mjs', readOnly: true },
  ],
})
const executor = new CloudExecutor({
  provider,
  image: 'arena-sandbox:oc-1.18.15-py',
  network: 'none',
  kernel: new PiCloudKernel({
    command: 'sh',
    args: ['-c', `/opt/node24/bin/node /workspace/mock.mjs >/tmp/mock.log 2>&1 & sleep 1; exec env PI_CODING_AGENT_DIR=/workspace/pi-home PI_OFFLINE=1 /opt/node24/bin/node ${piCli} --mode json --offline --provider siriusx-mock --model siriusx-mock --no-tools --print "$SIRIUSX_PI_PROMPT"`],
    promptEnv: 'SIRIUSX_PI_PROMPT',
    timeoutMs: 120_000,
  }),
})
const request: CreateAssignment = {
  tenantId: 'tenant-pi-docker', assignmentId: '66666666-6666-4666-8666-666666666666',
  ticketId: 'ticket-pi-docker', kind: 'start', priority: 'normal',
  workspace: { kind: 'cloud_project', projectId: 'repo', repo: { provider: 'github', host: 'example.invalid', projectPath: 'repo', cloneUrl: 'https://example.invalid/repo.git' }, baseRef: 'main' },
  model: { source: 'tenant', id: 'tenant-default' }, workdirKey: 'ticket-pi-docker',
  input: { prompt: 'Reply with a short Pi-in-Docker sentence.', followUps: [] }, secretRefs: [], traceId: 'trace-pi-docker',
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

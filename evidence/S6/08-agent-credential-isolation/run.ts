/** Connector credentials stay in the tool gateway; sandbox env and audit do not contain them. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ToolGateway } from '../../../apps/tool-gateway/src/index.ts'
import { CloudExecutor, DockerSandboxProvider, type CloudKernelContext, type AssignmentReport } from '../../../packages/cloud-executor/src/index.ts'
import type { CreateAssignment } from '../../../packages/contracts/src/executor.ts'

const root = await mkdtemp(join(tmpdir(), 'siriusx-agent-cred-'))
const secret = 'CONNECTOR_SECRET_9c1e'
const gateway = new ToolGateway({
  dbPath: join(root, 'gateway.sqlite'),
  connectors: { github: { execute: async (_request, credential) => ({ result: { credentialPresent: credential === secret } }) } },
  credentials: { github: secret },
})
const context = { tenantId: 'tenant-cred', botId: 'bot', ticketId: 'ticket-cred', userId: 'admin', operatorId: 'app:admin', approverId: 'admin', role: 'admin' as const }
await gateway.propose({
  tenantId: context.tenantId, botId: context.botId, ticketId: context.ticketId, operatorId: context.operatorId,
  system: 'github', actionClass: 'read_issue', target: 'acme/repo#1', mandate: { actions: [] },
}, context)
const audit = JSON.stringify(gateway.auditForTicket('ticket-cred'))
let envText = ''
const envKernel = {
  async run(ctx: CloudKernelContext): Promise<AssignmentReport> {
    const env = await ctx.sandbox.exec('env')
    envText = env.stdout
    return { kind: 'ready', summary: 'env inspected', diffStats: { filesChanged: 0, insertions: 0, deletions: 0 }, diffBasis: 'baseRef' }
  },
}
const executor = new CloudExecutor({
  provider: new DockerSandboxProvider({ image: 'teams-bridge:0.2.0' }),
  image: 'teams-bridge:0.2.0', network: 'none', kernel: envKernel,
})
const request: CreateAssignment = {
  tenantId: 'tenant-cred', assignmentId: '88888888-8888-4888-8888-888888888888', ticketId: 'ticket-cred',
  kind: 'start', priority: 'normal',
  workspace: { kind: 'cloud_project', projectId: 'repo', repo: { provider: 'github', host: 'example.invalid', projectPath: 'repo', cloneUrl: 'https://example.invalid/repo.git' }, baseRef: 'main' },
  model: { source: 'tenant', id: 'tenant-default' }, workdirKey: 'ticket-cred',
  input: { prompt: 'inspect env', followUps: [] }, secretRefs: [], traceId: 'trace-cred',
  clientContext: { operatorId: 'app:user', channel: 'app', platform: 'web' },
}
try {
  await executor.createAssignment(request)
  const done = await executor.wait(request.assignmentId)
  const result = { state: done.state, envHasSecret: envText.includes(secret), auditHasSecret: audit.includes(secret), envLines: envText.split('\n').length }
  console.log(JSON.stringify(result, null, 2))
  if (result.envHasSecret || result.auditHasSecret || done.state !== 'reported') process.exitCode = 1
} finally {
  executor.close()
  gateway.close()
  await rm(root, { recursive: true, force: true })
  process.exit(process.exitCode ?? 0)
}

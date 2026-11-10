/** Child process for the real SIGKILL/reconcile probe. */
import { FakeKernel } from '@siriusx/fake-kernel'
import { LocalExecutor } from '@siriusx/executor-local'
import { BotService } from '../../src/bot-service.ts'

const [dbPath, repo] = process.argv.slice(2)
if (dbPath === undefined || repo === undefined) throw new Error('dbPath and repo are required')
const kernel = new FakeKernel({ defaultScenario: { steps: [{ kind: 'wait', millis: 60_000 }] } })
const executor = new LocalExecutor({ tenantId: 'tenant-a', backend: kernel })
const service = new BotService({ dbPath, executor })
const ticketId = service.createTicket({
  tenantId: 'tenant-a',
  workspace: { kind: 'local_dir', deviceId: 'd1', path: repo },
  prompt: 'crash this bot process',
})
void service.dispatch(ticketId)
setTimeout(() => console.log(ticketId), 300)
setInterval(() => {}, 1000)

import { spawn } from 'node:child_process'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { FakeKernel } from '@siriusx/fake-kernel'
import { LocalExecutor } from '@siriusx/executor-local'
import { BotService } from '../src/bot-service.ts'

const execFileAsync = promisify(execFile)
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

async function repo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'siriusx-bot-kill-'))
  roots.push(root)
  await execFileAsync('git', ['init', '-q'], { cwd: root })
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: root })
  await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: root })
  await writeFile(join(root, 'app.txt'), 'one\n')
  await execFileAsync('git', ['add', '.'], { cwd: root })
  await execFileAsync('git', ['commit', '-q', '-m', 'base'], { cwd: root })
  return root
}

describe('Bot process loss', () => {
  it('marks a real SIGKILLed running assignment lost exactly once on restart', async () => {
    const root = await repo()
    const dbPath = join(root, 'bot.sqlite')
    const child = spawn(process.execPath, ['--import', 'tsx', join(import.meta.dirname, 'fixtures/slow-bot-child.ts'), dbPath, root], {
      cwd: '/root/siriusx/apps/autobot', stdio: ['ignore', 'pipe', 'pipe'],
    })
    const ticketId = await new Promise<string>((resolve, reject) => {
      let output = ''
      const timer = setTimeout(() => reject(new Error(`child did not start: ${output}`)), 15_000)
      child.stdout.on('data', chunk => {
        output += chunk.toString()
        const line = output.trim().split('\n')[0]
        if (line !== undefined && line.includes('-')) { clearTimeout(timer); resolve(line) }
      })
      child.stderr.on('data', chunk => { output += chunk.toString() })
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`child exited ${code}: ${output}`)) })
    })
    await new Promise(resolve => setTimeout(resolve, 600))
    child.kill('SIGKILL')
    await new Promise(resolve => child.once('exit', resolve))

    const kernel = new FakeKernel({ defaultScenario: { steps: [{ kind: 'delta', text: '```siriusx-report\n{"kind":"ready","summary":"restart"}\n```' }] } })
    const first = new BotService({ dbPath, executor: new LocalExecutor({ tenantId: 'tenant-a', backend: kernel }) })
    expect(first.getTicket(ticketId).latestAssignment?.state).toBe('lost')
    first.close()
    const second = new BotService({ dbPath, executor: new LocalExecutor({ tenantId: 'tenant-a', backend: kernel }) })
    second.close()
    const db = new DatabaseSync(dbPath)
    const outbox = db.prepare("SELECT kind FROM outbox WHERE ticket_id = ? ORDER BY created_at").all(ticketId) as Array<{ kind: string }>
    db.close()
    expect(outbox.filter(row => row.kind === 'assignment-lost')).toHaveLength(1)
  }, 30_000)
})

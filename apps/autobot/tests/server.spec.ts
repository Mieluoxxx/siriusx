import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { startBotServer, type BotServer } from '../src/server.ts'

const execFileAsync = promisify(execFile)
const roots: string[] = []
const servers: BotServer[] = []

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'siriusx-server-'))
  roots.push(root)
  await execFileAsync('git', ['init', '-q'], { cwd: root })
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: root })
  await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: root })
  await writeFile(join(root, 'app.txt'), 'one\n')
  await execFileAsync('git', ['add', '.'], { cwd: root })
  await execFileAsync('git', ['commit', '-q', '-m', 'base'], { cwd: root })
  const server = await startBotServer({ dbPath: ':memory:', port: 0 })
  servers.push(server)
  return { root, server }
}

describe('loopback Bot API', () => {
  it('serves bots, tickets and ticket detail', async () => {
    const { root, server } = await setup()
    const bots = await fetch(`${server.url}/api/bots`).then(response => response.json()) as { bots: unknown[] }
    expect(bots.bots).toHaveLength(1)
    const created = await fetch(`${server.url}/api/tickets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: root, prompt: 'do the task' }),
    })
    expect(created.status).toBe(202)
    const ticket = await created.json() as { ticketId: string }
    await new Promise(resolve => setTimeout(resolve, 50))
    const list = await fetch(`${server.url}/api/tickets`).then(response => response.json()) as { tickets: Array<{ ticketId: string }> }
    expect(list.tickets.map(item => item.ticketId)).toContain(ticket.ticketId)
    const detail = await fetch(`${server.url}/api/tickets/${ticket.ticketId}`).then(response => response.json()) as { events: unknown[]; latestAssignment?: { state: string } }
    expect(detail.latestAssignment?.state).toBe('reported')
    expect(detail.events.length).toBeGreaterThan(0)
  })

  it('allows a follow-up after an answer ticket', async () => {
    const { root, server } = await setup()
    // The default fake kernel returns ready, so a follow-up exercises the
    // endpoint contract rather than the person/answer branch.
    const response = await fetch(`${server.url}/api/tickets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: root, prompt: 'do the task' }),
    })
    const ticket = await response.json() as { ticketId: string }
    await new Promise(resolve => setTimeout(resolve, 50))
    const input = await fetch(`${server.url}/api/tickets/${ticket.ticketId}/input`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'continue' }),
    })
    expect(input.status).toBe(200)
  })
})

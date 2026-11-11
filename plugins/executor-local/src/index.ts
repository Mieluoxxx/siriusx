/** DSH Host plugin exposing the SiriusX local Executor on a loopback test route. */
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { BotService } from '@siriusx/autobot/bot-service'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { LocalExecutor } from '@siriusx/executor-local'
import { DshBackend } from '@siriusx/kernel-dsh'

export const name = 'siriusx-executor-local'
export const inject = ['agents', 'webServer']

function isLoopback(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.byteLength
    if (bytes > 1024 * 1024) throw new Error('request body too large')
    chunks.push(buffer)
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('expected JSON object')
  return value as Record<string, unknown>
}

function send(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  response.end(body)
}

export async function apply(ctx: Context): Promise<void> {
  const defaults = ctx.get('agentDefaultModel') as { currentSelection(): { provider: string; model: string } } | undefined
  if (defaults === undefined) throw new Error('siriusx-executor-local: agentDefaultModel is required')

  const backend = new DshBackend({
    open: async target => {
      const tenant = ctx.get('siriusxTenant') as { model?: { id?: string } } | undefined
      const enterpriseProvider = process.env.SIRIUSX_ENTERPRISE_MODEL_PROVIDER
      const selection = tenant?.model?.id !== undefined && enterpriseProvider !== undefined && enterpriseProvider !== ''
        ? { provider: enterpriseProvider, model: tenant.model.id }
        : defaults.currentSelection()
      if (target.kind === 'resume') {
        const sessionId = target.sessionId as never
        const live = ctx.agents.get(sessionId)
        if (live !== undefined) return { agent: live }
        const resumed = await ctx.agents.resume({
          resumeSessionId: sessionId,
          agentOptions: { provider: selection.provider, model: selection.model },
        })
        return { agent: resumed.agent, dispose: () => resumed.dispose() }
      }
      const created = await ctx.agents.create({
        sessionId: `siriusx-executor-${randomUUID()}` as never,
        agentOptions: { provider: selection.provider, model: selection.model },
        meta: { cwd: target.cwd },
      })
      return { agent: created.agent, dispose: () => created.dispose() }
    },
  })
  const tenantId = (): string => {
    const tenant = ctx.get('siriusxTenant') as { tenantId?: string } | undefined
    return tenant?.tenantId ?? 'tenant-local'
  }
  const executor = new LocalExecutor({ tenantId: tenantId(), backend, capacity: 2 })
  const botDb = process.env.SIRIUSX_BOT_DB ?? join(process.env.DSH_HOME ?? '/tmp', 'siriusx-host-bot.sqlite')
  const bot = new BotService({ dbPath: botDb, executor, autoRetryLost: process.env.SIRIUSX_AUTO_RETRY_LOST === '1' })
  ctx.effect(() => () => bot.close(), 'siriusx-executor-local: bot store')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/__siriusx/bot/run-ticket',
    handler: async (request, response) => {
      if (!isLoopback(request.socket.remoteAddress)) { send(response, 403, { error: 'loopback only' }); return }
      if (request.method !== 'POST') { send(response, 405, { error: 'POST required' }); return }
      try {
        const body = await readJson(request)
        if (typeof body.path !== 'string' || !body.path.startsWith('/')) throw new Error('path must be absolute')
        if (typeof body.prompt !== 'string' || body.prompt.trim() === '') throw new Error('prompt is required')
        const ticketId = await bot.createTicket({
          tenantId: tenantId(),
          workspace: { kind: 'local_dir', deviceId: 'local-device', path: body.path },
          prompt: body.prompt,
        })
        send(response, 200, await bot.dispatch(ticketId))
      } catch (error) {
        send(response, 500, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'siriusx-executor-local: bot ticket route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/__siriusx/bot/ticket',
    handler: async (request, response) => {
      if (!isLoopback(request.socket.remoteAddress)) { send(response, 403, { error: 'loopback only' }); return }
      if (request.method !== 'GET') { send(response, 405, { error: 'GET required' }); return }
      const ticketId = new URL(request.url ?? '/', 'http://127.0.0.1').searchParams.get('ticketId')
      if (ticketId === null || ticketId === '') { send(response, 400, { error: 'ticketId is required' }); return }
      try {
        const result = { ...await bot.getTicket(ticketId), events: await bot.eventsForTicket(ticketId) }
        send(response, 200, result)
      } catch (error) {
        send(response, 404, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'siriusx-executor-local: bot ticket detail route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/__siriusx/executor/run',
    handler: async (request, response) => {
      if (!isLoopback(request.socket.remoteAddress)) {
        send(response, 403, { error: 'loopback only' })
        return
      }
      if (request.method !== 'POST') {
        send(response, 405, { error: 'POST required' })
        return
      }
      try {
        const body = await readJson(request)
        if (typeof body.path !== 'string' || !body.path.startsWith('/')) throw new Error('path must be absolute')
        if (typeof body.prompt !== 'string' || body.prompt.trim() === '') throw new Error('prompt is required')
        const assignmentId = randomUUID()
        const ticketId = randomUUID()
        const assignment = await executor.createAssignment({
          tenantId: 'tenant-local',
          assignmentId,
          ticketId,
          kind: 'start',
          priority: 'human',
          workspace: { kind: 'local_dir', deviceId: 'local-device', path: body.path },
          model: { source: 'local', id: defaults.currentSelection().model },
          workdirKey: ticketId,
          input: { prompt: body.prompt, followUps: [] },
          secretRefs: [],
          traceId: ticketId,
          clientContext: { operatorId: 'app:local-user', channel: 'app', platform: 'desktop' },
        })
        const completed = await executor.wait(assignmentId)
        send(response, 200, {
          assignment,
          completed,
          events: executor.streamEvents(assignmentId, 0).events,
        })
      } catch (error) {
        send(response, 500, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'siriusx-executor-local: loopback run route')
}

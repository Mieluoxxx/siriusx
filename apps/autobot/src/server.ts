/** Minimal loopback Bot API for the S4 DSH team UI plugin. */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { FakeKernel } from '@siriusx/fake-kernel'
import { LocalExecutor } from '@siriusx/executor-local'
import { AnalyticsCollector, FileAnalyticsSink } from '@siriusx/analytics'
import { BotService } from './bot-service.ts'

export interface BotServerOptions {
  readonly dbPath: string
  readonly port?: number
  readonly host?: string
  readonly analyticsPath?: string
}

export interface BotServer {
  readonly server: Server
  readonly url: string
  readonly service: BotService
  close(): Promise<void>
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
  'cache-control': 'no-store',
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  const text = Buffer.concat(chunks).toString('utf8')
  if (text === '') return {}
  const value: unknown = JSON.parse(text)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('expected a JSON object')
  return value as Record<string, unknown>
}

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    ...CORS,
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  })
  response.end(body)
}

export async function startBotServer(options: BotServerOptions): Promise<BotServer> {
  const kernel = new FakeKernel({
    defaultScenario: {
      steps: [{ kind: 'delta', text: '```siriusx-report\n{"kind":"ready","summary":"local fake kernel finished"}\n```' }],
    },
  })
  const executor = new LocalExecutor({ tenantId: 'tenant-local', backend: kernel })
  const analytics = options.analyticsPath === undefined ? undefined : new AnalyticsCollector({
    sink: new FileAnalyticsSink(options.analyticsPath),
    local: true,
  })
  const service = new BotService({ dbPath: options.dbPath, executor, inputDebounceMs: 0, ...(analytics === undefined ? {} : { analytics }) })
  const server = createServer(async (request, response) => {
    if (request.method === 'OPTIONS') {
      response.writeHead(204, CORS).end()
      return
    }
    try {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`)
      const parts = url.pathname.split('/').filter(Boolean)
      if (request.method === 'GET' && url.pathname === '/api/health') {
        writeJson(response, 200, { ok: true })
        return
      }
      if (request.method === 'GET' && url.pathname === '/api/bots') {
        writeJson(response, 200, { bots: [{ id: 'local', name: 'SiriusX Local Bot', kind: 'personal', status: 'online' }] })
        return
      }
      if (request.method === 'GET' && url.pathname === '/api/approvals') {
        writeJson(response, 200, { approvals: [] })
        return
      }
      if (request.method === 'GET' && url.pathname === '/api/tickets') {
        writeJson(response, 200, { tickets: service.listTickets() })
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/tickets') {
        const body = await readJson(request)
        if (typeof body.path !== 'string' || typeof body.prompt !== 'string') throw new Error('path and prompt are required')
        if (!body.path.startsWith('/')) throw new Error('path must be absolute')
        const ticketId = service.createTicket({
          tenantId: 'tenant-local',
          workspace: { kind: 'local_dir', deviceId: 'local-device', path: body.path },
          prompt: body.prompt,
        })
        void service.dispatch(ticketId).catch((error: unknown) => {
          console.error('siriusx bot dispatch failed', error)
        })
        writeJson(response, 202, service.getTicket(ticketId))
        return
      }
      if (parts[0] === 'api' && parts[1] === 'tickets' && parts[2] !== undefined) {
        const ticketId = parts[2]
        if (request.method === 'GET' && parts.length === 3) {
          writeJson(response, 200, { ...service.getTicket(ticketId), events: service.eventsForTicket(ticketId) })
          return
        }
        if (request.method === 'POST' && parts[3] === 'input') {
          const body = await readJson(request)
          if (typeof body.text !== 'string' || body.text.trim() === '') throw new Error('text is required')
          writeJson(response, 200, await service.sendInput(ticketId, body.text))
          return
        }
        if (request.method === 'POST' && parts[3] === 'cancel') {
          writeJson(response, 200, await service.cancelTicket(ticketId))
          return
        }
      }
      writeJson(response, 404, { error: 'not found' })
    } catch (error) {
      writeJson(response, 400, { error: error instanceof Error ? error.message : String(error) })
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? 4319, options.host ?? '127.0.0.1', () => { resolve() })
  })
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : options.port ?? 4319
  return {
    server,
    url: `http://${options.host ?? '127.0.0.1'}:${port}`,
    service,
    close: async () => {
      await new Promise<void>((resolve, reject) => server.close(error => { error === undefined ? resolve() : reject(error) }))
      service.close()
    },
  }
}

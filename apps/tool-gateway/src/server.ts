/** HTTP transport for the tool gateway. The entry gateway authenticates callers. */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { ActionRequestSchema, ToolGateway, ToolGatewayError, type Connector, type ToolContext } from './index.ts'

export interface ToolGatewayServerOptions {
  readonly dbPath: string
  readonly connectors: Readonly<Record<string, Connector>>
  readonly credentials?: Readonly<Record<string, string>>
  readonly port?: number
  readonly host?: string
  readonly policyEnabled?: boolean
  readonly onApprovalDecided?: import('./index.ts').ToolGatewayOptions['onApprovalDecided']
}

export interface ToolGatewayServer {
  readonly server: Server
  readonly url: string
  readonly gateway: ToolGateway
  close(): Promise<void>
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type,x-tenant-id,x-user-id,x-role',
  'cache-control': 'no-store',
}

const MAX_JSON_BODY_BYTES = 1024 * 1024

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.byteLength
    if (total > MAX_JSON_BODY_BYTES) throw new ToolGatewayError(413, 'PAYLOAD_TOO_LARGE', 'request body exceeds 1 MiB')
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text === '') return {}
  const value: unknown = JSON.parse(text)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('expected JSON object')
  return value as Record<string, unknown>
}

function write(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  response.writeHead(status, { ...CORS, 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) })
  response.end(body)
}

function contextOf(request: IncomingMessage): ToolContext {
  const tenantId = request.headers['x-tenant-id']
  const userId = request.headers['x-user-id']
  const role = request.headers['x-role']
  if (typeof tenantId !== 'string' || typeof userId !== 'string') throw new ToolGatewayError(401, 'UNAUTHORIZED', 'missing authenticated tenant/user headers')
  const normalizedRole = role === 'admin' ? 'admin' : 'member'
  return {
    tenantId,
    userId,
    role: normalizedRole,
    botId: typeof request.headers['x-bot-id'] === 'string' ? request.headers['x-bot-id'] : 'unknown',
    ticketId: typeof request.headers['x-ticket-id'] === 'string' ? request.headers['x-ticket-id'] : 'unknown',
    operatorId: userId,
    approverId: userId,
  }
}

export async function startToolGatewayServer(options: ToolGatewayServerOptions): Promise<ToolGatewayServer> {
  const gateway = new ToolGateway({
    dbPath: options.dbPath,
    connectors: options.connectors,
    ...(options.credentials === undefined ? {} : { credentials: options.credentials }),
    ...(options.policyEnabled === undefined ? {} : { policyEnabled: options.policyEnabled }),
    ...(options.onApprovalDecided === undefined ? {} : { onApprovalDecided: options.onApprovalDecided }),
  })
  const server = createServer(async (request, response) => {
    if (request.method === 'OPTIONS') { response.writeHead(204, CORS).end(); return }
    try {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`)
      if (request.method === 'GET' && url.pathname === '/health') { write(response, 200, { ok: true, service: 'siriusx-tool-gateway', version: process.env.SIRIUSX_VERSION ?? 'dev', commit: process.env.SIRIUSX_COMMIT ?? 'dev' }); return }
      if (request.method === 'GET' && url.pathname === '/ready') {
        try { write(response, 200, { ok: true, service: 'siriusx-tool-gateway', checks: gateway.ready() }) }
        catch (error) { write(response, 503, { ok: false, service: 'siriusx-tool-gateway', error: error instanceof Error ? error.message : String(error) }) }
        return
      }
      const context = contextOf(request)
      if (request.method === 'POST' && url.pathname === '/v1/actions') {
        const body = await readJson(request)
        write(response, 202, await gateway.propose(ActionRequestSchema.parse(body), context))
        return
      }
      if (request.method === 'GET' && url.pathname === '/v1/approvals') {
        write(response, 200, { approvals: gateway.listApprovals(context.tenantId) })
        return
      }
      const parts = url.pathname.split('/').filter(Boolean)
      if (request.method === 'POST' && parts[0] === 'v1' && parts[1] === 'approvals' && parts[2] !== undefined && parts[3] === 'decide') {
        const body = await readJson(request)
        if (typeof body.approved !== 'boolean') throw new Error('approved is required')
        write(response, 200, await gateway.decide(parts[2], body.approved, context))
        return
      }
      if (request.method === 'GET' && url.pathname === '/v1/audit/verify') {
        if (context.role !== 'admin') throw new ToolGatewayError(403, 'ADMIN_REQUIRED', 'admin role required')
        write(response, 200, gateway.verifyAuditChain())
        return
      }
      if (request.method === 'GET' && url.pathname === '/v1/audit') {
        const ticketId = url.searchParams.get('ticketId')
        if (ticketId === null) throw new Error('ticketId is required')
        write(response, 200, { audit: gateway.auditForTicket(ticketId, context.tenantId) })
        return
      }
      write(response, 404, { error: 'not found', code: 'NOT_FOUND' })
    } catch (error) {
      const known = error instanceof ToolGatewayError
      write(response, known ? error.status : 400, {
        error: error instanceof Error ? error.message : String(error),
        ...(known ? { code: error.code } : {}),
      })
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? 4330, options.host ?? '127.0.0.1', () => { resolve() })
  })
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : options.port ?? 4330
  return {
    server,
    url: `http://${options.host ?? '127.0.0.1'}:${port}`,
    gateway,
    close: async () => {
      await new Promise<void>((resolve, reject) => server.close(error => { error === undefined ? resolve() : reject(error) }))
      gateway.close()
    },
  }
}

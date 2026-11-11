/** Tenant model gateway: authenticates an SSO session and hides upstream model keys. */
import { createServer, type Server } from 'node:http'
import { ControlPlane, ControlPlaneError, type Session } from './index.ts'

export interface ModelGatewayOptions {
  readonly control: ControlPlane
  readonly port?: number
  readonly host?: string
  readonly upstreamUrl?: string
  readonly upstreamKey?: string
}

export interface ModelGateway {
  readonly server: Server
  readonly url: string
  close(): Promise<void>
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type,authorization',
  'cache-control': 'no-store',
}

function write(response: import('node:http').ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  response.writeHead(status, { ...CORS, 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) })
  response.end(body)
}

function sessionOf(control: ControlPlane, request: import('node:http').IncomingMessage): Session {
  const header = request.headers.authorization
  if (header === undefined || !header.startsWith('Bearer ')) throw new ControlPlaneError(401, 'UNAUTHORIZED', 'Bearer session token required')
  return control.verifySession(header.slice('Bearer '.length))
}

async function bodyOf(request: import('node:http').IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks)
}

export async function startModelGateway(options: ModelGatewayOptions): Promise<ModelGateway> {
  const server = createServer(async (request, response) => {
    if (request.method === 'OPTIONS') { response.writeHead(204, CORS).end(); return }
    try {
      const session = sessionOf(options.control, request)
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      if (request.method === 'GET' && url.pathname === '/v1/models') {
        write(response, 200, {
          object: 'list',
          tenantId: session.tenantId,
          data: (await options.control.listTenantModels(session.tenantId)).map(model => ({ id: model.id, object: 'model', owned_by: session.tenantId, name: model.name, provider: model.provider, default: model.isDefault })),
        })
        return
      }
      if (request.method !== 'POST' || url.pathname !== '/v1/chat/completions') {
        write(response, 404, { error: { message: 'not found' } })
        return
      }
      if (options.upstreamUrl === undefined) {
        write(response, 503, { error: { message: 'tenant model upstream is not configured', code: 'UPSTREAM_NOT_CONFIGURED' } })
        return
      }
      const body = await bodyOf(request)
      let requestedModel: string | undefined
      try { const parsed = JSON.parse(body.toString('utf8')) as { model?: unknown }; if (typeof parsed.model === 'string') requestedModel = parsed.model } catch { /* upstream handles malformed JSON */ }
      if (requestedModel !== undefined && !(await options.control.listTenantModels(session.tenantId)).some(model => model.id === requestedModel)) {
        write(response, 400, { error: { message: `model is not bound to tenant: ${requestedModel}`, code: 'MODEL_NOT_BOUND' } })
        return
      }
      const upstream = await fetch(options.upstreamUrl, {
        method: 'POST',
        headers: {
          'content-type': request.headers['content-type'] ?? 'application/json',
          ...(options.upstreamKey === undefined ? {} : { authorization: `Bearer ${options.upstreamKey}` }),
        },
        body: new Uint8Array(body),
      })
      response.writeHead(upstream.status, {
        ...CORS,
        'content-type': upstream.headers.get('content-type') ?? 'application/json',
        'cache-control': 'no-store',
      })
      if (upstream.body === null) response.end()
      else {
        for await (const chunk of upstream.body) response.write(chunk)
        response.end()
      }
    } catch (error) {
      const known = error instanceof ControlPlaneError
      write(response, known ? error.status : 500, {
        error: { message: error instanceof Error ? error.message : String(error), ...(known ? { code: error.code } : {}) },
      })
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? 4321, options.host ?? '127.0.0.1', () => { resolve() })
  })
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : options.port ?? 4321
  return {
    server,
    url: `http://${options.host ?? '127.0.0.1'}:${port}`,
    close: async () => { await new Promise<void>((resolve, reject) => server.close(error => { error === undefined ? resolve() : reject(error) })) },
  }
}

/** HTTP entry for the single-box control plane. Production terminates SSO at a gateway. */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { ControlPlane, ControlPlaneError, type Session } from './index.ts'
import type { DeviceGateway } from './device-gateway.ts'

export interface ControlPlaneServerOptions {
  readonly dbPath: string
  readonly dataDir: string
  readonly port?: number
  readonly host?: string
  readonly sessionSecret?: string
}

export interface ControlPlaneServer {
  readonly server: Server
  readonly url: string
  readonly control: ControlPlane
  setDeviceGateway(gateway: DeviceGateway): void
  close(): Promise<void>
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PUT,OPTIONS',
  'access-control-allow-headers': 'content-type,authorization',
  'cache-control': 'no-store',
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
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

function sessionOf(control: ControlPlane, request: IncomingMessage): Session {
  const header = request.headers.authorization
  if (header === undefined || !header.startsWith('Bearer ')) throw new ControlPlaneError(401, 'UNAUTHORIZED', 'Bearer session token required')
  return control.verifySession(header.slice('Bearer '.length))
}

export async function startControlPlaneServer(options: ControlPlaneServerOptions): Promise<ControlPlaneServer> {
  const control = new ControlPlane({ dbPath: options.dbPath, dataDir: options.dataDir, ...(options.sessionSecret === undefined ? {} : { sessionSecret: options.sessionSecret }) })
  let deviceGateway: DeviceGateway | undefined
  const server = createServer(async (request, response) => {
    if (request.method === 'OPTIONS') {
      response.writeHead(204, CORS).end()
      return
    }
    try {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`)
      const parts = url.pathname.split('/').filter(Boolean)
      if (request.method === 'GET' && url.pathname === '/health') {
        write(response, 200, { ok: true, service: 'siriusx-control-plane' })
        return
      }
      const session = sessionOf(control, request)
      if (request.method === 'GET' && url.pathname === '/v1/me') {
        write(response, 200, session)
        return
      }
      if (url.pathname === '/v1/settings') {
        if (request.method === 'GET') { write(response, 200, control.getSettings(session.tenantId)); return }
        if (request.method === 'PUT') {
          const body = await readJson(request)
          control.updateSettings(session, {
            ...(typeof body.nativeConversationEnabled === 'boolean' ? { nativeConversationEnabled: body.nativeConversationEnabled } : {}),
            ...(typeof body.byokEnabled === 'boolean' ? { byokEnabled: body.byokEnabled } : {}),
            ...(typeof body.localExecutionEnabled === 'boolean' ? { localExecutionEnabled: body.localExecutionEnabled } : {}),
          })
          write(response, 200, control.getSettings(session.tenantId))
          return
        }
      }
      if (request.method === 'POST' && url.pathname === '/v1/devices/pair/start') {
        const body = await readJson(request)
        if (typeof body.name !== 'string') throw new Error('name is required')
        write(response, 201, control.startPairing(session, body.name))
        return
      }
      if (request.method === 'POST' && url.pathname === '/v1/devices/pair/confirm') {
        const body = await readJson(request)
        if (typeof body.code !== 'string') throw new Error('code is required')
        write(response, 200, control.confirmPairing(session, body.code))
        return
      }
      if (request.method === 'GET' && url.pathname === '/v1/devices') {
        write(response, 200, { devices: control.listDevices(session) })
        return
      }
      if (request.method === 'POST' && parts[0] === 'v1' && parts[1] === 'devices' && parts[2] !== undefined && parts[3] === 'revoke') {
        control.revokeDevice(session, parts[2])
        deviceGateway?.closeDevice(parts[2])
        write(response, 200, { revoked: true })
        return
      }
      if (request.method === 'POST' && parts[0] === 'v1' && parts[1] === 'devices' && parts[2] !== undefined && parts[3] === 'tickets') {
        if (deviceGateway === undefined) throw new ControlPlaneError(503, 'DEVICE_GATEWAY_UNAVAILABLE', 'device gateway is not attached')
        const body = await readJson(request)
        if (typeof body.path !== 'string' || typeof body.prompt !== 'string') throw new Error('path and prompt are required')
        const ticket = control.createTicket(session, { path: body.path, prompt: body.prompt })
        const delivered = deviceGateway.sendToDevice(session.tenantId, parts[2], {
          type: 'ticket.assign',
          ticketId: ticket.ticketId,
          workspace: { kind: 'local_dir', path: body.path },
          prompt: body.prompt,
        })
        write(response, 202, { ...ticket, delivered })
        return
      }
      if (request.method === 'GET' && url.pathname === '/v1/bots') {
        write(response, 200, { bots: control.listBots(session) })
        return
      }
      if (request.method === 'POST' && url.pathname === '/v1/bots') {
        const body = await readJson(request)
        if (typeof body.name !== 'string' || body.name.trim() === '') throw new Error('name is required')
        write(response, 201, control.createBot(session, body.name.trim()))
        return
      }
      if (request.method === 'GET' && url.pathname === '/v1/tickets') {
        write(response, 200, { tickets: control.listTickets(session) })
        return
      }
      if (request.method === 'POST' && url.pathname === '/v1/tickets') {
        const body = await readJson(request)
        if (typeof body.path !== 'string' || typeof body.prompt !== 'string') throw new Error('path and prompt are required')
        write(response, 202, control.createTicket(session, { path: body.path, prompt: body.prompt }))
        return
      }
      if (parts[0] === 'v1' && parts[1] === 'tickets' && parts[2] !== undefined) {
        const ticketId = parts[2]
        if (request.method === 'GET' && parts.length === 3) {
          write(response, 200, control.ticketDetail(session, ticketId))
          return
        }
        if (request.method === 'POST' && parts[3] === 'input') {
          const body = await readJson(request)
          if (typeof body.text !== 'string' || body.text.trim() === '') throw new Error('text is required')
          write(response, 200, await control.sendTicketInput(session, ticketId, body.text))
          return
        }
        if (request.method === 'POST' && parts[3] === 'cancel') {
          write(response, 200, await control.cancelTicket(session, ticketId))
          return
        }
      }
      write(response, 404, { error: 'not found', code: 'NOT_FOUND' })
    } catch (error) {
      const known = error instanceof ControlPlaneError
      write(response, known ? error.status : 400, {
        error: error instanceof Error ? error.message : String(error),
        ...(known ? { code: error.code } : {}),
      })
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? 4320, options.host ?? '127.0.0.1', () => { resolve() })
  })
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : options.port ?? 4320
  return {
    server,
    url: `http://${options.host ?? '127.0.0.1'}:${port}`,
    control,
    setDeviceGateway: gateway => { deviceGateway = gateway },
    close: async () => {
      await new Promise<void>((resolve, reject) => server.close(error => { error === undefined ? resolve() : reject(error) }))
      control.close()
    },
  }
}

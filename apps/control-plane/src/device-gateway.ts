/** Device long-connection gateway. Devices authenticate with a pairing-issued token. */
import { WebSocket, WebSocketServer } from 'ws'
import { ControlPlane } from './index.ts'

export interface DeviceGatewayOptions {
  readonly control: ControlPlane
  readonly port?: number
  readonly host?: string
}

export interface DeviceGateway {
  readonly url: string
  readonly server: WebSocketServer
  connectedDevices(tenantId: string): string[]
  sendToDevice(tenantId: string, deviceId: string, message: unknown): boolean
  setMessageHandler(handler: (auth: { tenantId: string; userId: string; deviceId: string }, message: Record<string, unknown>) => void): void
  setConnectHandler(handler: (auth: { tenantId: string; userId: string; deviceId: string }) => void): void
  closeDevice(deviceId: string): void
  close(): Promise<void>
}

interface Connection {
  readonly socket: WebSocket
  readonly deviceId: string
  readonly tenantId: string
  readonly userId: string
  readonly token: string
}

export async function startDeviceGateway(options: DeviceGatewayOptions): Promise<DeviceGateway> {
  const connections = new Map<string, Connection>()
  const messages = new Map<string, Array<Record<string, unknown>>>()
  let messageHandler: ((auth: { tenantId: string; userId: string; deviceId: string }, message: Record<string, unknown>) => void) | undefined
  let connectHandler: ((auth: { tenantId: string; userId: string; deviceId: string }) => void) | undefined
  const server = new WebSocketServer({ port: options.port ?? 4322, host: options.host ?? '127.0.0.1' })
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  server.on('connection', (socket, request) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`)
    const header = request.headers.authorization
    const token = url.searchParams.get('token') ?? (header?.startsWith('Bearer ') ? header.slice(7) : undefined)
    if (token === null || token === undefined || token === '') {
      socket.close(4001, 'missing device token')
      return
    }
    let auth: { tenantId: string; userId: string; deviceId: string }
    try {
      auth = options.control.verifyDeviceToken(token)
    } catch {
      socket.close(4001, 'invalid or revoked device token')
      return
    }
    const connection: Connection = { socket, deviceId: auth.deviceId, tenantId: auth.tenantId, userId: auth.userId, token }
    connections.set(auth.deviceId, connection)
    socket.send(JSON.stringify({ type: 'registered', deviceId: auth.deviceId, tenantId: auth.tenantId, userId: auth.userId }))
    connectHandler?.(auth)
    socket.on('message', raw => {
      try {
        // Re-check the token on every heartbeat/message; revocation closes the
        // long connection even when the device does not reconnect.
        options.control.verifyDeviceToken(token)
        const message = JSON.parse(raw.toString()) as Record<string, unknown>
        if (message.type === 'heartbeat') {
          socket.send(JSON.stringify({ type: 'heartbeat.ack', at: Date.now() }))
          return
        }
        const queue = messages.get(auth.deviceId) ?? []
        queue.push({ ...message, receivedAt: Date.now() })
        messages.set(auth.deviceId, queue.slice(-100))
        messageHandler?.(auth, message)
        socket.send(JSON.stringify({ type: 'ack', id: message.id ?? null }))
      } catch {
        socket.close(4001, 'device token revoked')
      }
    })
    socket.on('close', () => { if (connections.get(auth.deviceId)?.socket === socket) connections.delete(auth.deviceId) })
  })
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : options.port ?? 4322
  return {
    url: `ws://${options.host ?? '127.0.0.1'}:${port}`,
    server,
    connectedDevices: tenantId => [...connections.values()].filter(connection => connection.tenantId === tenantId).map(connection => connection.deviceId),
    sendToDevice: (tenantId, deviceId, message) => {
      const connection = connections.get(deviceId)
      if (connection === undefined || connection.tenantId !== tenantId || connection.socket.readyState !== WebSocket.OPEN) return false
      connection.socket.send(JSON.stringify(message))
      return true
    },
    setMessageHandler: handler => { messageHandler = handler },
    setConnectHandler: handler => { connectHandler = handler },
    closeDevice: deviceId => { connections.get(deviceId)?.socket.close(4001, 'device revoked') },
    close: async () => {
      for (const connection of connections.values()) connection.socket.terminate()
      connections.clear()
      await new Promise<void>((resolve, reject) => server.close(error => { error === undefined ? resolve() : reject(error) }))
    },
  }
}

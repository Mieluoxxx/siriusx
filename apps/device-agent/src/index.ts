/** Paired-device agent: one local_dir assignment at a time, events flow uplink only. */
import { WebSocket } from 'ws'
import { CreateAssignmentSchema, type CreateAssignment } from '@siriusx/contracts/executor'
import { LocalExecutor } from '@siriusx/executor-local'
import { FakeKernel } from '@siriusx/fake-kernel'

export interface DeviceAgentOptions {
  readonly url: string
  readonly token: string
  readonly executor?: LocalExecutor
  readonly onError?: (error: unknown) => void
}

export interface DeviceAgent {
  readonly socket: WebSocket
  readonly ready: Promise<void>
  close(): void
}

export async function startDeviceAgent(options: DeviceAgentOptions): Promise<DeviceAgent> {
  const kernel = new FakeKernel({
    defaultScenario: {
      steps: [{ kind: 'delta', text: '```siriusx-report\n{"kind":"ready","summary":"device-local task finished","diffStats":{"filesChanged":0,"insertions":0,"deletions":0},"diffBasis":"ticketStart"}\n```' }],
    },
  })
  const socket = new WebSocket(`${options.url}?token=${encodeURIComponent(options.token)}`)
  let readyResolve: (() => void) | undefined
  let readyReject: ((error: Error) => void) | undefined
  const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject })
  let queue = Promise.resolve()

  const handleAssign = async (message: Record<string, unknown>): Promise<void> => {
    if (typeof message.ticketId !== 'string' || typeof message.assignment !== 'object' || message.assignment === null) return
    const assignment = CreateAssignmentSchema.parse(message.assignment) as CreateAssignment
    if (assignment.workspace.kind !== 'local_dir') throw new Error('device agent only accepts local_dir')
    const executor = options.executor ?? new LocalExecutor({ tenantId: assignment.tenantId, backend: kernel })
    const created = await executor.createAssignment(assignment)
    // Send lifecycle events early so the Team panel moves to working.
    for (const event of executor.streamEventsForBot(created.assignmentId, 0).events) {
      socket.send(JSON.stringify({ type: 'ticket.event', ticketId: assignment.ticketId, event }))
    }
    const done = await executor.wait(created.assignmentId)
    for (const event of executor.streamEventsForBot(created.assignmentId, 0).events) {
      socket.send(JSON.stringify({ type: 'ticket.event', ticketId: assignment.ticketId, event }))
    }
  }

  socket.on('message', raw => {
    try {
      const message = JSON.parse(raw.toString()) as Record<string, unknown>
      if (message.type === 'registered') readyResolve?.()
      if (message.type === 'ticket.assign') {
        queue = queue.then(() => handleAssign(message)).catch(error => {
          options.onError?.(error)
          const ticketId = typeof message.ticketId === 'string' ? message.ticketId : undefined
          if (ticketId !== undefined) {
            socket.send(JSON.stringify({
              type: 'ticket.event', ticketId,
              event: { type: 'report', seq: 0, at: new Date().toISOString(), report: { kind: 'failed', summary: 'device-local task failed', reason: error instanceof Error ? error.message : String(error) } },
            }))
          }
        })
      }
    } catch (error) {
      options.onError?.(error)
    }
  })
  socket.on('error', error => {
    options.onError?.(error)
    readyReject?.(error instanceof Error ? error : new Error(String(error)))
  })
  socket.on('close', () => { readyReject?.(new Error('device gateway closed')) })
  return { socket, ready, close: () => socket.close() }
}

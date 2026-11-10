/**
 * S0 spike: an in-process Executor-shaped Host plugin.
 *
 * It is loaded beside the Web application into the same Cordis context. The
 * probe route proves that the plugin can reach the Agent registry and the
 * Session controller used by the UI. The real Executor will use the same
 * `ctx.agents` / `ctx.sessionController` handles and the public Agent API.
 */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-host-webserver'

export const name = 'siriusx-executor-spike'
export const inject = ['agents', 'llm', 'sessionController', 'webServer']

class SpikeAdapter extends LlmAdapter {
  async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'executor spike response' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'executor spike response' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

const message = (text: string) => createUserMessage({
  content: [{ type: 'text', text }],
  source: { kind: 'user' },
})

function sendJson(response: { writeHead(status: number, headers?: Record<string, string>): unknown; end(body?: string): unknown }, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify(value))
}

export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['siriusx-spike'], new SpikeAdapter())
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/__siriusx/executor',
    handler: (request, response) => {
      if (request.method !== 'GET') {
        response.writeHead(405).end()
        return
      }
      const tenant = ctx.get('siriusxTenant') as { tenantId?: string; subjectId?: string } | undefined
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      response.end(JSON.stringify({
        pid: process.pid,
        pluginLoaded: true,
        agentsService: ctx.get('agents') !== undefined,
        sessionControllerService: ctx.get('sessionController') !== undefined,
        tenantId: tenant?.tenantId ?? null,
        subjectId: tenant?.subjectId ?? null,
        liveAgents: ctx.agents.list().length,
        workspaceKind: 'local_dir',
      }))
    },
  }), 'siriusx-executor-spike: probe route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/__siriusx/executor/run',
    handler: async (request, response) => {
      if (request.method !== 'POST') {
        response.writeHead(405).end()
        return
      }
      try {
        const sessionId = SessionId(`siriusx-executor-spike-${randomUUID()}`)
        const created = await ctx.agents.create({
          sessionId,
          agentOptions: { provider: 'siriusx-spike', model: 'siriusx-spike' },
          meta: { cwd: '/tmp' },
        })
        // This is the same resolution path the UI's Session Remote uses.
        const ui = await ctx.sessionController.resolveAgent(sessionId)
        if ('error' in ui) throw ui.error
        // An Executor plugin reads the live Agent directly from the registry.
        const executor = ctx.agents.get(sessionId)
        if (executor === undefined) throw new Error('Executor could not resolve the live Agent')
        ui.agent.followup(message('FROM_UI_SIMULATION'))
        executor.followup(message('FROM_EXECUTOR_PLUGIN'))
        await created.agent.whenIdle()
        const events = created.agent.session.snapshotEvents()
        const result = {
          sessionId,
          sameAgent: ui.agent === executor,
          inputs: events.filter(event => event.type === 'user/message' && event.data.source.kind === 'user').length,
          turns: events.filter(event => event.type === 'turn/start').length,
          assistantMessages: events.filter(event => event.type === 'assistant/message').length,
        }
        sendJson(response, 200, result)
        await created.dispose()
      } catch (error) {
        sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'siriusx-executor-spike: run route')
}

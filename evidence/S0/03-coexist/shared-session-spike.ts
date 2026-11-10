/**
 * S0 spike: two in-process consumers (UI and Executor) drive one live Session.
 *
 * The UI path in `@deepseek-ai/dsh-api-session-controller` ultimately calls
 * `Agent.followup()` / `Agent.steer()` (packages/api/session-controller/src/commands.ts).
 * An in-process Executor can resolve the same live Agent from `ctx.agents`.
 * This test proves the registry gives both callers the exact same object and
 * that the durable inbox retains both inputs. It also proves that opening the
 * same Session through a second `agents.resume()` is rejected while live.
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import {
  mountAgentLoopTestDependencies,
  mountAgentLoopTestHarness,
} from '/root/siriusx/deepseek-harness/packages/test-support/agent-loop-testkit/src/index.ts'
import { LlmAdapter, createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as JsonlSessionPersistence from '/root/siriusx/deepseek-harness/packages/session/session-persistence-jsonl/src/index.ts'

const textChunks = (text: string): StreamChunk[] => [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'text-delta', index: 0, text },
  { type: 'block-end', index: 0, block: { type: 'text', text } },
  { type: 'finish', reason: { kind: 'stop' } },
]

class ScriptedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  constructor(private readonly script: StreamChunk[][]) { super() }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const call = this.script.shift()
    if (call === undefined) throw new Error('scripted adapter exhausted')
    yield* call
  }
}

const message = (text: string) => createUserMessage({
  content: [{ type: 'text', text }],
  source: { kind: 'user' },
})

const ctx = new Context()
const root = await mkdtemp(join(tmpdir(), 'siriusx-shared-session-'))
try {
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  const adapter = new ScriptedAdapter([textChunks('ui turn'), textChunks('executor turn')])
  ctx.llm.registerAdapter(['mock'], adapter)
  const harness = await mountAgentLoopTestHarness(ctx)
  const sessionId = SessionId('siriusx-shared-session-spike')
  const created = await harness.create(sessionId, { provider: 'mock', model: 'mock' })

  // The UI path and an in-process Executor resolve the live Agent separately.
  const uiAgent = ctx.agents.get(sessionId)
  const executorAgent = ctx.agents.get(sessionId)
  assert.equal(uiAgent, created)
  assert.equal(executorAgent, created)
  assert.equal(uiAgent, executorAgent, 'both consumers must receive the exact same Agent')

  // Concurrent inputs share the durable inbox; neither caller loses its message.
  const uiInput = message('FROM_UI')
  const executorInput = message('FROM_EXECUTOR')
  uiAgent!.followup(uiInput)
  executorAgent!.followup(executorInput)
  await created.whenIdle()

  const events = created.session.snapshotEvents()
  const userMessages = events.filter(event => event.type === 'user/message')
  const turns = events.filter(event => event.type === 'turn/start')
  assert.equal(userMessages.length, 2)
  assert.equal(turns.length, 2)
  const seen = JSON.stringify(adapter.requests)
  assert.match(seen, /FROM_UI/)
  assert.match(seen, /FROM_EXECUTOR/)

  // A second open that tries to construct another Agent for the same Session is rejected.
  let resumeError = ''
  try {
    await ctx.agents.resume({ resumeSessionId: sessionId })
  } catch (error) {
    resumeError = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  }
  assert.notEqual(resumeError, '', 'a second resume of a live Session must be rejected')

  console.log(JSON.stringify({
    result: 'pass',
    sessionId,
    sameAgentInstance: uiAgent === executorAgent,
    inputsRetained: userMessages.length,
    turns: turns.length,
    resumeWhileLive: resumeError,
  }, null, 2))
} finally {
  await ctx.fiber.dispose()
  await rm(root, { recursive: true, force: true })
}

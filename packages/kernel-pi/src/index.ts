/** Pi CLI JSON-mode backend. One process per turn; Pi owns the session file. */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type {
  AgentBackend,
  AgentEvent,
  AgentInput,
  AgentSession,
  AgentSessionStatus,
  BackendDetection,
  BackendHost,
  CancelCause,
  CancelReceipt,
  OpenTarget,
  SessionCapabilities,
} from '@siriusx/kernel-api'

export interface PiBackendOptions {
  readonly id?: string
  readonly label?: string
  readonly command?: string
  readonly provider: string
  readonly model: string
  readonly sessionDir: string
  readonly env?: Readonly<Record<string, string>>
  readonly allowTools?: boolean
  readonly extraArgs?: readonly string[]
}

interface PiEvent {
  readonly type: string
  readonly [key: string]: unknown
}

function textFromMessage(message: unknown): string {
  if (typeof message !== 'object' || message === null || !('content' in message)) return ''
  const content = (message as { content?: unknown }).content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map(block => typeof block === 'object' && block !== null && 'text' in block && typeof block.text === 'string' ? block.text : '').join('')
}

export class PiSession implements AgentSession {
  readonly ref: { readonly backendId: string; readonly sessionId: string }
  readonly cwd: string
  readonly capabilities: SessionCapabilities = { native: {} }
  #status: AgentSessionStatus = 'idle'
  readonly #options: PiBackendOptions
  readonly #sessionId = randomUUID()
  readonly #listeners = new Set<(batch: readonly AgentEvent[], meta: { replay: boolean }) => void>()
  readonly #history: AgentEvent[] = []
  #seq = 0
  #turn = 0
  #attempt = ''
  #child: ChildProcess | undefined
  #stderr = ''

  constructor(cwd: string, options: PiBackendOptions, backendId: string) {
    this.cwd = cwd
    this.#options = options
    this.ref = { backendId, sessionId: this.#sessionId }
    this.#emit([{ type: 'session.ready', sessionId: this.#sessionId, cwd, model: options.model, provider: options.provider }])
  }

  get status(): AgentSessionStatus { return this.#status }
  async history(): Promise<readonly AgentEvent[]> { return [...this.#history] }
  subscribe(listener: (batch: readonly AgentEvent[], meta: { replay: boolean }) => void): () => void {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  #emit(events: readonly AgentEvent[]): void {
    this.#history.push(...events)
    for (const listener of this.#listeners) listener(events, { replay: false })
  }

  async submit(input: AgentInput, placement: 'turn' | 'steer' | 'followup' | 'now'): Promise<{ accepted: boolean; reason?: string; dropped?: boolean }> {
    if (placement !== 'turn' || this.#status === 'running') return { accepted: false, reason: 'pi backend accepts one turn at a time', dropped: true }
    this.#status = 'running'
    this.#turn++
    this.#attempt = randomUUID()
    const turn = this.#turn
    this.#emit([
      { type: 'user.message', id: input.clientMessageId, anchor: input.clientMessageId, seq: this.#seq++, turn, time: Date.now(), source: 'user', text: input.text, blocks: [{ type: 'text', text: input.text }] },
      { type: 'turn.start', turn, origin: 'user', userMessageId: input.clientMessageId, time: Date.now() },
      { type: 'assistant.attempt.start', attemptId: this.#attempt, turn, step: 1, model: this.#options.model },
    ])
    void this.#run(input.text, turn)
    return { accepted: true }
  }

  async #run(prompt: string, turn: number): Promise<void> {
    const args = [
      '--mode', 'json', '--offline',
      '--provider', this.#options.provider, '--model', this.#options.model,
      '--session-dir', this.#options.sessionDir, '--session-id', this.#sessionId,
      ...(this.#options.allowTools === false ? ['--no-tools'] : []),
      ...(this.#options.extraArgs ?? []),
      '--print', prompt,
    ]
    const child = spawn(this.#options.command ?? 'pi', args, { cwd: this.cwd, env: { ...process.env, ...(this.#options.env ?? {}) }, stdio: ['ignore', 'pipe', 'pipe'] })
    this.#child = child
    this.#stderr = ''
    child.stderr.on('data', chunk => { this.#stderr += chunk.toString() })
    let output = ''
    let finalText = ''
    child.stdout.on('data', chunk => {
      output += chunk.toString()
      let index = output.indexOf('\n')
      while (index >= 0) {
        const line = output.slice(0, index).trim()
        output = output.slice(index + 1)
        if (line !== '') this.#handleEvent(JSON.parse(line) as PiEvent, turn, event => { finalText = event })
        index = output.indexOf('\n')
      }
    })
    await new Promise<void>(resolve => child.once('exit', () => resolve()))
    if (output.trim() !== '') { try { this.#handleEvent(JSON.parse(output.trim()) as PiEvent, turn, event => { finalText = event }) } catch { /* partial line */ } }
    if (this.#status === 'running') {
      this.#seq++
      this.#emit([
        { type: 'assistant.attempt.end', attemptId: this.#attempt, outcome: 'aborted' },
        { type: 'turn.end', turn, time: Date.now(), reason: { kind: 'other', label: `pi exited: ${this.#stderr.trim().split('\n').at(-1) ?? 'unknown'}` } },
      ])
      this.#status = 'idle'
    }
    this.#child = undefined
  }

  #handleEvent(event: PiEvent, turn: number, setFinal: (text: string) => void): void {
    if (event.type === 'message_update') {
      const update = event.assistantMessageEvent as { type?: string; delta?: string } | undefined
      if (update?.type === 'text_delta' && typeof update.delta === 'string') {
        this.#emit([{ type: 'assistant.delta', attemptId: this.#attempt, index: 0, time: Date.now(), delta: { kind: 'text', text: update.delta } }])
      }
      return
    }
    if (event.type === 'turn_end') {
      const text = textFromMessage(event.message)
      setFinal(text)
      this.#seq++
      this.#emit([
        { type: 'assistant.attempt.end', attemptId: this.#attempt, outcome: 'committed' },
        { type: 'assistant.message', seq: this.#seq, anchor: `${this.#sessionId}:${turn}`, attemptId: this.#attempt, time: Date.now(), model: this.#options.model, blocks: [{ type: 'text', text }], canonical: true },
        { type: 'turn.end', turn, time: Date.now(), reason: { kind: 'completed' } },
      ])
      this.#status = 'idle'
    }
  }

  async cancel(_cause: CancelCause): Promise<CancelReceipt> {
    this.#child?.kill('SIGTERM')
    this.#child = undefined
    this.#status = 'idle'
    return { stillQueued: [], outcome: 'confirmed' }
  }

  async dispose(): Promise<void> {
    this.#status = 'disposed'
    this.#child?.kill('SIGKILL')
    this.#child = undefined
  }
}

export class PiJsonBackend implements AgentBackend {
  readonly id: string
  readonly descriptor: { label: string }
  readonly #options: PiBackendOptions
  constructor(options: PiBackendOptions) {
    this.#options = options
    this.id = options.id ?? 'pi'
    this.descriptor = { label: options.label ?? 'Pi' }
  }

  async detect(_host: BackendHost): Promise<BackendDetection> {
    const probe = spawnSync(this.#options.command ?? 'pi', ['--version'], { encoding: 'utf8', timeout: 5000 })
    if (probe.error !== undefined) return { installed: false, auth: 'unknown', hint: 'install pi' }
    return { installed: true, auth: 'unknown', ...(probe.stdout.trim() === '' ? {} : { version: probe.stdout.trim().split('\n')[0]! }) }
  }

  async open(target: OpenTarget, _host: BackendHost): Promise<PiSession> {
    if (target.kind !== 'create') throw new Error('PiJsonBackend resume is not implemented')
    return new PiSession(target.cwd, this.#options, this.id)
  }
}

export interface PiCloudKernelOptions {
  readonly command: string
  readonly args?: readonly string[]
  readonly env?: Readonly<Record<string, string>>
  /** Set this env name to the assignment prompt; useful for shell wrappers. */
  readonly promptEnv?: string
  /** Append `--print <prompt>` for a direct Pi CLI invocation. */
  readonly appendPrompt?: boolean
  readonly timeoutMs?: number
}

function parseCloudDiff(output: string): { filesChanged: number; insertions: number; deletions: number } {
  let filesChanged = 0
  let insertions = 0
  let deletions = 0
  for (const line of output.split('\n')) {
    const [, added, removed, file] = line.split('\t')
    if (file === undefined || added === undefined) continue
    filesChanged++
    if (added !== '-' && added !== undefined) insertions += Number(added)
    if (removed !== '-' && removed !== undefined) deletions += Number(removed)
  }
  return { filesChanged, insertions, deletions }
}

/** Run a Pi JSON-mode process inside a CloudExecutor sandbox and return a report. */
export class PiCloudKernel {
  readonly #options: PiCloudKernelOptions
  constructor(options: PiCloudKernelOptions) { this.#options = options }

  async run(context: import('@siriusx/cloud-executor').CloudKernelContext): Promise<import('@siriusx/cloud-executor').AssignmentReport> {
    const args = [...(this.#options.args ?? [])]
    if (this.#options.appendPrompt === true) args.push('--print', context.assignment.input.prompt)
    const env = {
      ...this.#options.env,
      ...(this.#options.promptEnv === undefined ? {} : { [this.#options.promptEnv]: context.assignment.input.prompt }),
    }
    const process = await context.sandbox.spawn(this.#options.command, args, { env })
    // Pi --print does not consume stdin; closing it lets the CLI exit.
    await process.writable.close().catch(() => undefined)
    const reader = process.readable.getReader()
    const decoder = new TextDecoder()
    let output = ''
    let finalText = ''
    const consume = (text: string): void => {
      output += text
      let index = output.indexOf('\n')
      while (index >= 0) {
        const line = output.slice(0, index).trim()
        output = output.slice(index + 1)
        if (line !== '') this.#consumeEvent(JSON.parse(line) as Record<string, unknown>, value => { finalText = value })
        index = output.indexOf('\n')
      }
    }
    const readLoop = (async () => {
      for (;;) {
        const chunk = await reader.read()
        if (chunk.done) return
        consume(decoder.decode(chunk.value, { stream: true }))
      }
    })()
    const timeoutMs = this.#options.timeoutMs ?? 30 * 60 * 1000
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Pi cloud turn timed out')), timeoutMs))
    await Promise.race([process.exited, timeout])
    // The Docker exec stdout may stay open for a moment after the wrapper
    // exits; let the reader drain briefly, then continue with the report.
    await Promise.race([readLoop, new Promise(resolve => setTimeout(resolve, 1000))]).catch(() => undefined)
    if (output.trim() !== '') { try { this.#consumeEvent(JSON.parse(output.trim()) as Record<string, unknown>, value => { finalText = value }) } catch { /* partial */ } }
    const diff = await context.sandbox.exec(`git -C ${context.cwd} diff --numstat`)
    return {
      kind: 'ready',
      summary: finalText || 'Pi cloud turn finished without a final message',
      diffStats: diff.exitCode === 0 ? parseCloudDiff(diff.stdout) : { filesChanged: 0, insertions: 0, deletions: 0 },
      diffBasis: 'baseRef',
    }
  }

  #consumeEvent(event: Record<string, unknown>, setFinal: (text: string) => void): void {
    if (event.type === 'turn_end') {
      const message = event.message as { content?: unknown } | undefined
      if (message !== undefined) setFinal(textFromMessage(message))
    }
  }
}

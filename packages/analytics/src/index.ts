/** Analysis-log collector: classify first, then best-effort append. */
import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  PAYLOAD_FIELD_LEVELS,
  parseAnalyticsEvent,
  type AnalyticsEvent,
  type DataLevel,
} from '@siriusx/contracts/analytics'

export interface AnalyticsSink {
  append(event: AnalyticsEvent, projection: 'full' | 'l0l1'): Promise<void>
}

export class FileAnalyticsSink implements AnalyticsSink {
  readonly #path: string
  readonly #l0l1Path: string

  constructor(path: string) {
    this.#path = path
    this.#l0l1Path = path.replace(/\.jsonl$/u, '.l0l1.jsonl')
  }

  async append(event: AnalyticsEvent, projection: 'full' | 'l0l1'): Promise<void> {
    const path = projection === 'full' ? this.#path : this.#l0l1Path
    await mkdir(dirname(path), { recursive: true })
    await appendFile(path, `${JSON.stringify(event)}\n`, { mode: 0o600 })
  }
}

function levelOf(event: AnalyticsEvent, path: string): DataLevel | undefined {
  return PAYLOAD_FIELD_LEVELS[event.schema][path]
}

function stripPayload(value: unknown, event: AnalyticsEvent, path: string, maxLevel: DataLevel): unknown {
  const level = levelOf(event, path)
  if (level !== undefined) {
    if (level === 'L2' && maxLevel !== 'L2') return undefined
    return value
  }
  if (Array.isArray(value)) {
    return value.map(item => stripPayload(item, event, path === '' ? '[]' : `${path}[]`, maxLevel)).filter(item => item !== undefined)
  }
  if (typeof value === 'object' && value !== null) {
    const result: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) {
      const projected = stripPayload(child, event, path === '' ? key : `${path}.${key}`, maxLevel)
      if (projected !== undefined) result[key] = projected
    }
    return result
  }
  return value
}

/** Return a copy whose L2 fields are omitted. */
export function projectL0L1(event: AnalyticsEvent): AnalyticsEvent {
  return { ...event, payload: stripPayload(event.payload, event, '', 'L1') as Record<string, unknown> }
}

export class AnalyticsCollector {
  readonly #sink: AnalyticsSink
  readonly #onError: (error: unknown) => void
  readonly #isLocal: boolean
  #writes = 0
  #failures = 0

  constructor(options: { sink: AnalyticsSink; local?: boolean; onError?: (error: unknown) => void }) {
    this.#sink = options.sink
    this.#isLocal = options.local ?? false
    this.#onError = options.onError ?? (() => {})
  }

  get metrics(): { writes: number; failures: number } {
    return { writes: this.#writes, failures: this.#failures }
  }

  /**
   * Validate and append one event. Classification errors throw; sink failures
   * are best effort and never interrupt the task that produced the event.
   */
  async record(value: unknown): Promise<boolean> {
    const event = parseAnalyticsEvent(value)
    if (this.#isLocal) {
      const full = JSON.stringify(event.payload)
      const projected = JSON.stringify(projectL0L1(event).payload)
      // local_dir may only upload L0/L1; a producer that attaches L2 is a
      // classification violation rather than something to silently upload.
      if (full !== projected) throw new Error('local_dir analytics may not carry L2 fields')
    }
    try {
      const projected = projectL0L1(event)
      await this.#sink.append(projected, 'l0l1')
      if (!this.#isLocal) await this.#sink.append(event, 'full')
      this.#writes++
      return true
    } catch (error) {
      this.#failures++
      this.#onError(error)
      return false
    }
  }
}

export { parseAnalyticsEvent } from '@siriusx/contracts/analytics'
export type { AnalyticsEvent, DataLevel } from '@siriusx/contracts/analytics'

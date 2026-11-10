import { describe, expect, it } from 'vitest'
import type { AnalyticsEvent } from '@siriusx/contracts/analytics'
import { AnalyticsCollector, projectL0L1, type AnalyticsSink } from '../src/index.ts'

const base = {
  eventId: 'a1e33815-fca0-4d50-bfa4-bf32ec045b58',
  occurredAt: new Date().toISOString(),
  seq: 1,
  tenantId: 'tenant-a',
  botId: 'bot-1',
  ticketId: 'ticket-1',
  traceId: 'ticket-1',
  spanId: 'span-1',
  source: 'bot' as const,
  variant: {
    promptVersion: 'p1', policyVersion: 'pol1', model: 'm1', kernel: 'dsh', kernelVersion: '0.2.2', featureFlags: {},
  },
}

const event = (payload: Record<string, unknown>): AnalyticsEvent => ({
  ...base,
  schema: 'tool.called',
  schemaVersion: 1,
  payload,
}) as AnalyticsEvent

class MemorySink implements AnalyticsSink {
  readonly full: AnalyticsEvent[] = []
  readonly l0l1: AnalyticsEvent[] = []
  async append(value: AnalyticsEvent, projection: 'full' | 'l0l1'): Promise<void> {
    if (projection === 'full') this.full.push(value)
    else this.l0l1.push(value)
  }
}

describe('analytics collector', () => {
  it('rejects an unclassified field before any sink', async () => {
    const sink = new MemorySink()
    const collector = new AnalyticsCollector({ sink })
    await expect(collector.record(event({ toolName: 'bash', accidental: 'x' }))).rejects.toThrow(/no declared/u)
    expect(sink.full).toHaveLength(0)
  })

  it('rejects L2 fields for local execution', async () => {
    const sink = new MemorySink()
    const collector = new AnalyticsCollector({ sink, local: true })
    await expect(collector.record(event({ toolName: 'bash', input: 'secret prompt' }))).rejects.toThrow(/may not carry L2/u)
  })

  it('writes a full projection and an L0/L1 projection', async () => {
    const sink = new MemorySink()
    const collector = new AnalyticsCollector({ sink })
    expect(await collector.record(event({ toolName: 'bash', durationMs: 2, input: 'secret prompt' }))).toBe(true)
    expect(sink.full).toHaveLength(1)
    expect(sink.l0l1).toHaveLength(1)
    expect(sink.l0l1[0]?.payload).toMatchObject({ toolName: 'bash', durationMs: 2 })
    expect(sink.l0l1[0]?.payload).not.toHaveProperty('input')
    expect(projectL0L1(event({ toolName: 'bash', input: 'x' })).payload).not.toHaveProperty('input')
  })

  it('does not fail a task when the analytics sink is down', async () => {
    const sink: AnalyticsSink = { append: async () => { throw new Error('bus down') } }
    const failures: unknown[] = []
    const collector = new AnalyticsCollector({ sink, onError: error => failures.push(error) })
    expect(await collector.record(event({ toolName: 'bash' }))).toBe(false)
    expect(collector.metrics).toEqual({ writes: 0, failures: 1 })
    expect(failures).toHaveLength(1)
  })
})

/**
 * Analysis-log envelope and field classification.
 *
 * L0: numeric/enum/internal IDs usable across tenants.
 * L1: structural facts without source text.
 * L2: content owned by the tenant and encrypted with the tenant key.
 *
 * The collector calls `parseAnalyticsEvent` and rejects any field that has no
 * declared level. Downstream code cannot lower a level.
 */
import { z } from 'zod'

export const DataLevelSchema = z.enum(['L0', 'L1', 'L2'])
export type DataLevel = z.infer<typeof DataLevelSchema>

export const AnalyticsSchemaNameSchema = z.enum([
  'trigger.received',
  'eval.decided',
  'ticket.stage_changed',
  'assignment.state_changed',
  'model.called',
  'tool.called',
  'gateway.decided',
  'human.input',
  'report.produced',
  'outcome.recorded',
])

export const AnalyticsEventSchema = z.object({
  eventId: z.uuid(),
  schema: AnalyticsSchemaNameSchema,
  schemaVersion: z.literal(1),
  occurredAt: z.string().datetime(),
  seq: z.number().int().nonnegative(),
  tenantId: z.string().min(1),
  botId: z.string().min(1),
  ticketId: z.string().min(1),
  assignmentId: z.string().uuid().optional(),
  traceId: z.string().min(1),
  spanId: z.string().min(1),
  parentSpanId: z.string().min(1).optional(),
  source: z.enum(['bot', 'gateway', 'model-gateway', 'executor', 'app']),
  workspaceKind: z.enum(['cloud_project', 'local_dir']).optional(),
  variant: z.object({
    promptVersion: z.string().min(1),
    policyVersion: z.string().min(1),
    model: z.string().min(1),
    kernel: z.string().min(1),
    kernelVersion: z.string().min(1),
    featureFlags: z.record(z.string(), z.union([z.boolean(), z.string(), z.number()])),
  }),
  payload: z.record(z.string(), z.unknown()),
}).strict()

export type AnalyticsEvent = z.infer<typeof AnalyticsEventSchema>

/** Envelope fields are all L0 by design. */
export const ENVELOPE_FIELD_LEVELS: Readonly<Record<string, DataLevel>> = Object.freeze({
  eventId: 'L0',
  schema: 'L0',
  schemaVersion: 'L0',
  occurredAt: 'L0',
  seq: 'L0',
  tenantId: 'L0',
  botId: 'L0',
  ticketId: 'L0',
  assignmentId: 'L0',
  traceId: 'L0',
  spanId: 'L0',
  parentSpanId: 'L0',
  source: 'L0',
  workspaceKind: 'L0',
  variant: 'L0',
})

type FieldLevels = Readonly<Record<string, DataLevel>>

/**
 * Payload field levels. A path listed here is atomic: if it names an object,
 * the object's nested fields are not inspected separately. Otherwise the
 * validator descends into nested objects and requires every leaf path.
 */
export const PAYLOAD_FIELD_LEVELS: Readonly<Record<z.infer<typeof AnalyticsSchemaNameSchema>, FieldLevels>> = Object.freeze({
  'trigger.received': {
    channel: 'L0',
    eventType: 'L0',
    fromBot: 'L0',
    bodyLength: 'L1',
    body: 'L2',
  },
  'eval.decided': {
    path: 'L0',
    verdict: 'L0',
    strength: 'L0',
    mode: 'L0',
    durationMs: 'L0',
    inputTokens: 'L0',
    outputTokens: 'L0',
    note: 'L2',
    context: 'L2',
  },
  'ticket.stage_changed': {
    from: 'L0',
    to: 'L0',
    durationMs: 'L0',
  },
  'assignment.state_changed': {
    from: 'L0',
    to: 'L0',
    reasonClass: 'L0',
    queueMs: 'L0',
    prepareMs: 'L0',
  },
  'model.called': {
    model: 'L0',
    provider: 'L0',
    inputTokens: 'L0',
    outputTokens: 'L0',
    cachedTokens: 'L0',
    durationMs: 'L0',
    finishReason: 'L0',
    retried: 'L0',
    'usage.input': 'L0',
    'usage.output': 'L0',
    'usage.cached': 'L0',
    request: 'L2',
    response: 'L2',
  },
  'tool.called': {
    toolName: 'L1',
    durationMs: 'L0',
    resultClass: 'L0',
    inputBytes: 'L1',
    outputBytes: 'L1',
    input: 'L2',
    output: 'L2',
  },
  'gateway.decided': {
    system: 'L0',
    actionClass: 'L0',
    decision: 'L0',
    inMandate: 'L0',
    approvalWaitMs: 'L0',
    approvalResult: 'L0',
    actionContent: 'L2',
  },
  'human.input': {
    kind: 'L0',
    state: 'L0',
    textLength: 'L1',
    text: 'L2',
  },
  'report.produced': {
    reportKind: 'L0',
    filesChanged: 'L0',
    insertions: 'L0',
    deletions: 'L0',
    hasChangeRequest: 'L0',
    summary: 'L2',
    diff: 'L2',
  },
  'outcome.recorded': {
    finalState: 'L0',
    merged: 'L0',
    changesAfterBot: 'L0',
    reviewRounds: 'L0',
    reviewComments: 'L0',
    humanDisposition: 'L0',
    interruptedCount: 'L0',
    resumeCount: 'L0',
    reverted: 'L0',
    userRating: 'L0',
  },
})

export class UnclassifiedAnalyticsFieldError extends Error {
  readonly eventSchema: string
  readonly fieldPath: string

  constructor(eventSchema: string, fieldPath: string) {
    super(`analytics field ${eventSchema}.${fieldPath} has no declared L0/L1/L2 level`)
    this.name = 'UnclassifiedAnalyticsFieldError'
    this.eventSchema = eventSchema
    this.fieldPath = fieldPath
  }
}

function inspectPayload(
  eventSchema: string,
  value: unknown,
  path: string,
  levels: FieldLevels,
  errors: string[],
): void {
  if (levels[path] !== undefined) return
  if (Array.isArray(value)) {
    if (value.length === 0) return
    for (const item of value) inspectPayload(eventSchema, item, `${path}[]`, levels, errors)
    return
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value)
    if (entries.length === 0) {
      if (levels[path] === undefined) errors.push(path)
      return
    }
    for (const [key, child] of entries) {
      inspectPayload(eventSchema, child, path === '' ? key : `${path}.${key}`, levels, errors)
    }
    return
  }
  if (levels[path] === undefined) errors.push(path)
}

/**
 * Parse and classification-check one event. Unknown envelope fields and any
 * payload leaf without a declared level are rejected before storage.
 */
export function parseAnalyticsEvent(value: unknown): AnalyticsEvent {
  const event = AnalyticsEventSchema.parse(value)
  const levels = PAYLOAD_FIELD_LEVELS[event.schema]
  const errors: string[] = []
  for (const [key, child] of Object.entries(event.payload)) {
    inspectPayload(event.schema, child, key, levels, errors)
  }
  if (errors.length > 0) {
    throw new UnclassifiedAnalyticsFieldError(event.schema, errors[0]!)
  }
  return event
}

/** Return the declared level for a payload path, or undefined (fail closed). */
export function analyticsFieldLevel(
  eventSchema: z.infer<typeof AnalyticsSchemaNameSchema>,
  fieldPath: string,
): DataLevel | undefined {
  return PAYLOAD_FIELD_LEVELS[eventSchema][fieldPath]
}

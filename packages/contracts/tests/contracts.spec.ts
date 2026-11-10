import { describe, expect, it } from 'vitest'
import {
  ActivityEventSchema,
  AssignmentSchema,
  CreateAssignmentSchema,
  assertTenantMatches,
  workspaceMismatch,
} from '../src/executor.ts'
import { deriveTicketStage, readyNeedsReview } from '../src/ticket-stage.ts'
import {
  UnclassifiedAnalyticsFieldError,
  parseAnalyticsEvent,
} from '../src/analytics.ts'

const workspace = {
  kind: 'cloud_project' as const,
  projectId: 'project-1',
  repo: {
    provider: 'github' as const,
    host: 'github.com',
    projectPath: 'acme/repo',
    cloneUrl: 'https://github.com/acme/repo.git',
  },
  baseRef: 'main',
}

const create = {
  tenantId: 'tenant-a',
  assignmentId: '6f704e49-a2c7-4e7a-85a3-b53f4c872563',
  ticketId: 'ticket-1',
  kind: 'start' as const,
  priority: 'normal' as const,
  workspace,
  kernel: 'dsh',
  model: { source: 'tenant' as const, id: 'deepseek-chat' },
  workdirKey: 'ticket-1',
  input: { prompt: 'do it', followUps: [] },
  secretRefs: [],
  traceId: 'trace-1',
  clientContext: { operatorId: 'app:u1', channel: 'app' as const, platform: 'desktop' as const },
}

describe('executor contract', () => {
  it('accepts a valid cloud assignment', () => {
    expect(CreateAssignmentSchema.parse(create).kernel).toBe('dsh')
  })

  it('rejects kernel selection for local_dir', () => {
    const local = {
      ...create,
      workspace: { kind: 'local_dir', deviceId: 'device-1', path: '/work/repo' },
      model: { source: 'local', id: 'ollama/qwen' },
    }
    expect(CreateAssignmentSchema.safeParse(local).success).toBe(false)
  })

  it('rejects byok on cloud_project', () => {
    expect(CreateAssignmentSchema.safeParse({ ...create, model: { source: 'byok', id: 'x' } }).success).toBe(false)
  })

  it('rejects credentials embedded in cloneUrl', () => {
    const bad = {
      ...create,
      workspace: { ...workspace, repo: { ...workspace.repo, cloneUrl: 'https://user:pass@github.com/acme/repo.git' } },
    }
    expect(CreateAssignmentSchema.safeParse(bad).success).toBe(false)
  })

  it('fails closed on a tenant mismatch', () => {
    expect(() => assertTenantMatches('tenant-a', { tenantId: 'tenant-b', principal: 'bot' })).toThrow(/TENANT_MISMATCH/u)
    expect(() => assertTenantMatches('tenant-a', { tenantId: 'tenant-a', principal: 'bot' })).not.toThrow()
  })

  it('returns a specific workspace mismatch code', () => {
    expect(workspaceMismatch(workspace, { ...workspace, projectId: 'other' })).toBe('WORKSPACE_PROJECT_MISMATCH')
    expect(workspaceMismatch(workspace, { ...workspace, baseRef: 'release' })).toBe('WORKSPACE_BASEREF_MISMATCH')
    expect(workspaceMismatch(
      { kind: 'local_dir', deviceId: 'd1', path: '/a' },
      { kind: 'local_dir', deviceId: 'd2', path: '/a' },
    )).toBe('WORKSPACE_DEVICE_MISMATCH')
    expect(workspaceMismatch(
      { kind: 'local_dir', deviceId: 'd1', path: '/a' },
      { kind: 'local_dir', deviceId: 'd1', path: '/b' },
    )).toBe('WORKSPACE_PATH_MISMATCH')
  })

  it('requires report exactly in reported state', () => {
    const assignment = {
      tenantId: 'tenant-a',
      assignmentId: create.assignmentId,
      ticketId: 'ticket-1',
      workdirKey: 'ticket-1',
      kernel: 'dsh',
      state: 'running',
      lastSeq: 0,
    }
    expect(AssignmentSchema.safeParse(assignment).success).toBe(true)
    expect(AssignmentSchema.safeParse({ ...assignment, state: 'reported' }).success).toBe(false)
  })

  it('validates activity usage and name class', () => {
    const base = {
      type: 'activity' as const,
      seq: 1,
      at: new Date().toISOString(),
      kind: 'model' as const,
      name: 'deepseek-chat',
      nameClass: 'builtin' as const,
      durationMs: 12,
      resultClass: 'ok' as const,
      usage: { inputTokens: 3, outputTokens: 4 },
    }
    expect(ActivityEventSchema.safeParse(base).success).toBe(true)
    expect(ActivityEventSchema.safeParse({ ...base, kind: 'tool' }).success).toBe(false)
  })
})

describe('ticket stage', () => {
  it.each([
    [{ deliveryFailing: true, latest: { state: 'running' }, pendingInput: true }, 'person/delivery'],
    [{ deliveryFailing: false, latest: { state: 'running' }, pendingInput: true }, 'working'],
    [{ deliveryFailing: false, latest: { state: 'backgrounded' }, pendingInput: false }, 'working'],
    [{ deliveryFailing: false, pendingInput: true }, 'working/queued'],
    [{ deliveryFailing: false, latest: { state: 'reported', reportKind: 'answer' }, pendingInput: true }, 'working/queued'],
    [{ deliveryFailing: false, latest: { state: 'reported', reportKind: 'answer' }, pendingInput: false }, 'person/answer'],
    [{ deliveryFailing: false, latest: { state: 'reported', reportKind: 'ready' }, pendingInput: false }, 'person/review'],
    [{ deliveryFailing: false, latest: { state: 'reported', reportKind: 'blocked' }, pendingInput: false }, 'person/blocked_failed'],
    [{ deliveryFailing: false, latest: { state: 'reported', reportKind: 'failed' }, pendingInput: false }, 'person/blocked_failed'],
    [{ deliveryFailing: false, latest: { state: 'reported', reportKind: 'waiting' }, pendingInput: false }, 'idle'],
    [{ deliveryFailing: false, latest: { state: 'cancelled' }, pendingInput: false }, 'idle'],
    [{ deliveryFailing: false, latest: { state: 'lost' }, pendingInput: false }, 'idle'],
  ] as const)('derives %j as %s', (input, expected) => {
    expect(deriveTicketStage(input)).toBe(expected)
  })

  it('keeps ready in review only when a reviewable artifact exists', () => {
    expect(readyNeedsReview({ changeRequest: true, filesChanged: 0, livePreviews: 0 })).toBe(true)
    expect(readyNeedsReview({ changeRequest: false, filesChanged: 1, livePreviews: 0 })).toBe(true)
    expect(readyNeedsReview({ changeRequest: false, filesChanged: 0, livePreviews: 1 })).toBe(true)
    expect(readyNeedsReview({ changeRequest: false, filesChanged: 0, livePreviews: 0 })).toBe(false)
  })
})

const analyticsBase = {
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
    promptVersion: 'p1',
    policyVersion: 'pol1',
    model: 'm1',
    kernel: 'dsh',
    kernelVersion: '0.2.2',
    featureFlags: {},
  },
}

describe('analytics levels', () => {
  it('accepts declared payload fields', () => {
    const event = parseAnalyticsEvent({
      ...analyticsBase,
      schema: 'tool.called',
      schemaVersion: 1,
      payload: { toolName: 'bash', durationMs: 3, resultClass: 'ok' },
    })
    expect(event.schema).toBe('tool.called')
  })

  it('rejects an unclassified payload field', () => {
    expect(() => parseAnalyticsEvent({
      ...analyticsBase,
      schema: 'tool.called',
      schemaVersion: 1,
      payload: { toolName: 'bash', accidentalPrompt: 'secret' },
    })).toThrow(UnclassifiedAnalyticsFieldError)
  })

  it('descends into object fields unless the path itself is classified', () => {
    const event = parseAnalyticsEvent({
      ...analyticsBase,
      schema: 'model.called',
      schemaVersion: 1,
      payload: {
        model: 'm1',
        usage: { input: 1, output: 2 },
      },
    })
    expect(event.schema).toBe('model.called')
    expect(() => parseAnalyticsEvent({
      ...analyticsBase,
      schema: 'model.called',
      schemaVersion: 1,
      payload: { model: 'm1', usage: { input: 1, hidden: 'x' } },
    })).toThrow(UnclassifiedAnalyticsFieldError)
  })

  it('rejects unknown envelope fields', () => {
    expect(() => parseAnalyticsEvent({
      ...analyticsBase,
      schema: 'tool.called',
      schemaVersion: 1,
      payload: { toolName: 'bash' },
      extra: true,
    })).toThrow()
  })
})

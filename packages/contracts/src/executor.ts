/**
 * Bot ⇄ Executor contract.
 *
 * The wire/transport layer owns authentication and passes an AuthContext to
 * consumers. Payloads still carry tenantId because Executor routing, isolation,
 * idempotency and storage keys are tenant-scoped; `assertTenantMatches` makes
 * the two independent facts fail closed when they disagree.
 */
import { z } from 'zod'

export const TenantIdSchema = z.string().min(1).max(128)
export const AssignmentIdSchema = z.uuid()
export const TicketIdSchema = z.string().min(1).max(128)
export const WorkdirKeySchema = z.string().min(1).max(256)
export const TraceIdSchema = z.string().min(1).max(128)

export const ClientContextSchema = z.object({
  /** `<provider>:<userId>`, e.g. `gitlab:123`, `feishu:ou_x`, `app:user`. */
  operatorId: z.string().min(1),
  channel: z.enum(['gitlab', 'github', 'feishu', 'teams', 'app', 'cli', 'system']),
  deviceId: z.string().min(1).optional(),
  platform: z.enum(['web', 'desktop', 'mobile']).optional(),
}).superRefine((value, ctx) => {
  if (value.channel === 'app' && value.platform === undefined) {
    ctx.addIssue({ code: 'custom', path: ['platform'], message: 'platform is required when channel=app' })
  }
})

export const FollowUpSchema = z.object({
  source: z.enum(['human', 'ci', 'bot']),
  author: z.string().min(1),
  text: z.string(),
  triggerId: z.string().min(1),
})

export const RepoRefSchema = z.object({
  provider: z.enum(['gitlab', 'github']),
  host: z.string().min(1),
  projectPath: z.string().min(1),
  /** Must not contain URL credentials. */
  cloneUrl: z.string().url().refine(value => {
    const url = new URL(value)
    return url.username === '' && url.password === ''
  }, 'cloneUrl must not embed credentials'),
})

export const KernelSelectionSchema = z.string().regex(
  /^(?:dsh|pi|acp:[a-z0-9][a-z0-9-]{0,31})$/u,
  'kernel must be dsh, pi, or acp:<agent>',
)

export const CloudProjectWorkspaceSchema = z.object({
  kind: z.literal('cloud_project'),
  projectId: z.string().min(1),
  repo: RepoRefSchema,
  baseRef: z.string().min(1),
})

export const LocalDirWorkspaceSchema = z.object({
  kind: z.literal('local_dir'),
  deviceId: z.string().min(1),
  path: z.string().min(1),
  /** Optional Git base. Absent means the Executor's ticket-start snapshot is the diff basis. */
  baseRef: z.string().min(1).optional(),
})

export const WorkspaceSchema = z.discriminatedUnion('kind', [
  CloudProjectWorkspaceSchema,
  LocalDirWorkspaceSchema,
])

export const ModelSelectionSchema = z.object({
  source: z.enum(['tenant', 'byok', 'local']),
  id: z.string().min(1),
})

export const CreateAssignmentSchema = z.object({
  tenantId: TenantIdSchema,
  assignmentId: AssignmentIdSchema,
  ticketId: TicketIdSchema,
  kind: z.enum(['start', 'resume']),
  priority: z.enum(['normal', 'human']),
  workspace: WorkspaceSchema,
  /** Kernel is fixed per Ticket and only selectable for cloud_project. */
  kernel: KernelSelectionSchema.optional(),
  model: ModelSelectionSchema,
  workdirKey: WorkdirKeySchema,
  input: z.object({
    prompt: z.string().min(1),
    followUps: z.array(FollowUpSchema),
  }).superRefine((value, ctx) => {
    if (value.followUps.some(followUp => followUp.text.trim() === '')) {
      ctx.addIssue({ code: 'custom', path: ['followUps'], message: 'followUp text must not be empty' })
    }
  }),
  secretRefs: z.array(z.string().min(1)),
  traceId: TraceIdSchema,
  clientContext: ClientContextSchema,
}).superRefine((value, ctx) => {
  if (value.workspace.kind === 'local_dir' && value.kernel !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['kernel'],
      message: 'kernel is fixed to dsh for local_dir; only cloud_project may select a kernel',
    })
  }
  if (value.workspace.kind === 'cloud_project' && value.model.source !== 'tenant') {
    ctx.addIssue({
      code: 'custom',
      path: ['model', 'source'],
      message: 'cloud_project only supports model.source=tenant',
    })
  }
})

export const AssignmentStateSchema = z.enum([
  'preparing',
  'running',
  'backgrounded',
  'reported',
  'cancelled',
  'lost',
])

export const DiffStatsSchema = z.object({
  filesChanged: z.number().int().nonnegative(),
  insertions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
})

/**
 * `baseRef`: compare against workspace.baseRef.
 * `ticketStart`: compare against the snapshot recorded at the first Assignment.
 * `none`: no comparison basis exists; all values must be zero.
 */
export const DiffBasisSchema = z.enum(['baseRef', 'ticketStart', 'none'])

export const ChangeRequestSchema = z.object({
  provider: z.enum(['gitlab', 'github']),
  number: z.number().int().positive(),
  url: z.string().url(),
})

export const AssignmentReportSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('ready'),
    summary: z.string(),
    changeRequest: ChangeRequestSchema.optional(),
    diffStats: DiffStatsSchema,
    diffBasis: DiffBasisSchema,
  }),
  z.object({ kind: z.literal('answer'), summary: z.string(), question: z.string().min(1) }),
  z.object({ kind: z.literal('blocked'), summary: z.string(), reason: z.string().min(1) }),
  z.object({ kind: z.literal('failed'), summary: z.string(), reason: z.string().min(1) }),
  z.object({ kind: z.literal('waiting'), summary: z.string(), reason: z.string().min(1) }),
])

export const AssignmentSchema = z.object({
  tenantId: TenantIdSchema,
  assignmentId: AssignmentIdSchema,
  ticketId: TicketIdSchema,
  workdirKey: WorkdirKeySchema,
  kernel: KernelSelectionSchema,
  state: AssignmentStateSchema,
  report: AssignmentReportSchema.optional(),
  lastSeq: z.number().int().nonnegative(),
}).superRefine((value, ctx) => {
  if ((value.state === 'reported') !== (value.report !== undefined)) {
    ctx.addIssue({ code: 'custom', path: ['report'], message: 'report exists exactly when state=reported' })
  }
})

export const CancelAssignmentSchema = z.object({
  tenantId: TenantIdSchema,
  assignmentId: AssignmentIdSchema,
  mode: z.enum(['graceful', 'kill']),
  reason: z.enum(['user_interrupted', 'user_stop', 'mandate_revoked', 'operator']),
  clientContext: ClientContextSchema,
})

export const GetAssignmentSchema = z.object({
  tenantId: TenantIdSchema,
  assignmentId: AssignmentIdSchema,
})

export const StreamEventsSchema = z.object({
  tenantId: TenantIdSchema,
  assignmentId: AssignmentIdSchema,
  fromSeq: z.number().int().nonnegative(),
})

export const ActivityNameClassSchema = z.enum(['builtin', 'custom'])

/**
 * `name` is L1. A custom tool name can carry business meaning, so the
 * collector must hash or replace it for cross-tenant analytics; builtin names
 * are a closed allow-list maintained by the Bot service.
 */
export const ActivityEventSchema = z.object({
  type: z.literal('activity'),
  seq: z.number().int().nonnegative(),
  at: z.string().datetime(),
  kind: z.enum(['tool', 'model']),
  name: z.string().min(1).max(128),
  nameClass: ActivityNameClassSchema,
  durationMs: z.number().int().nonnegative(),
  resultClass: z.enum(['ok', 'error', 'denied', 'timeout', 'cancelled']),
  inputBytes: z.number().int().nonnegative().optional(),
  outputBytes: z.number().int().nonnegative().optional(),
  usage: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cachedTokens: z.number().int().nonnegative().optional(),
  }).optional(),
}).superRefine((value, ctx) => {
  if (value.usage !== undefined && value.kind !== 'model') {
    ctx.addIssue({ code: 'custom', path: ['usage'], message: 'usage is only valid for kind=model' })
  }
  if (value.usage === undefined && value.kind === 'model') {
    ctx.addIssue({ code: 'custom', path: ['usage'], message: 'model activity must report usage when the kernel knows it' })
  }
})

export const AssignmentEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('state'),
    seq: z.number().int().nonnegative(),
    at: z.string().datetime(),
    state: AssignmentStateSchema,
  }),
  z.object({
    type: z.literal('report'),
    seq: z.number().int().nonnegative(),
    at: z.string().datetime(),
    report: AssignmentReportSchema,
  }),
  z.object({
    type: z.literal('log'),
    seq: z.number().int().nonnegative(),
    at: z.string().datetime(),
    stream: z.enum(['stdout', 'stderr', 'agent']),
    chunk: z.string(),
  }),
  ActivityEventSchema,
])

export const StreamEventsResponseSchema = z.object({
  events: z.array(AssignmentEventSchema),
  logsTruncated: z.boolean(),
  oldestLogSeq: z.number().int().nonnegative().optional(),
}).superRefine((value, ctx) => {
  if (value.logsTruncated !== (value.oldestLogSeq !== undefined)) {
    ctx.addIssue({
      code: 'custom',
      path: ['oldestLogSeq'],
      message: 'oldestLogSeq exists exactly when logsTruncated=true',
    })
  }
})

export const PreviewSchema = z.object({
  previewId: z.string().min(1),
  workdirKey: WorkdirKeySchema,
  port: z.number().int().min(1).max(65_535),
  url: z.string().url(),
  pid: z.number().int().positive(),
  startedAt: z.string().datetime(),
  lastAccessAt: z.string().datetime().optional(),
})

export const ListPreviewsSchema = z.object({
  tenantId: TenantIdSchema,
  workdirKey: WorkdirKeySchema,
})

export const ListPreviewsResponseSchema = z.object({
  previews: z.array(PreviewSchema),
})

export const StopPreviewsSchema = z.object({
  tenantId: TenantIdSchema,
  workdirKey: WorkdirKeySchema,
  previewId: z.string().min(1).optional(),
  clientContext: ClientContextSchema,
})

export const StopPreviewsResponseSchema = z.object({
  stopped: z.array(z.string().min(1)),
})

export const DestroyWorkdirSchema = z.object({
  tenantId: TenantIdSchema,
  workdirKey: WorkdirKeySchema,
  clientContext: ClientContextSchema,
})

export const DestroyWorkdirResponseSchema = z.object({
  destroyed: z.boolean(),
})

export const TouchWorkdirSchema = z.object({
  tenantId: TenantIdSchema,
  workdirKey: WorkdirKeySchema,
})

export const TouchWorkdirResponseSchema = z.object({
  workdirKey: WorkdirKeySchema,
  leaseExpiresAt: z.string().datetime(),
})

export const FileEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  type: z.enum(['file', 'dir', 'symlink']),
  size: z.number().int().nonnegative().optional(),
  modified: z.boolean(),
  ignored: z.boolean(),
  sensitive: z.boolean(),
})

export const ListFilesSchema = z.object({
  tenantId: TenantIdSchema,
  workdirKey: WorkdirKeySchema,
  path: z.string(),
  cursor: z.string().optional(),
})

export const ListFilesResponseSchema = z.object({
  entries: z.array(FileEntrySchema),
  nextCursor: z.string().optional(),
})

export const ReadFileSchema = z.object({
  tenantId: TenantIdSchema,
  workdirKey: WorkdirKeySchema,
  path: z.string(),
})

export const ReadFileResponseSchema = z.object({
  path: z.string(),
  size: z.number().int().nonnegative(),
  binary: z.boolean(),
  redacted: z.boolean(),
  content: z.string().optional(),
}).superRefine((value, ctx) => {
  if (!value.binary && !value.redacted && value.content === undefined) {
    ctx.addIssue({ code: 'custom', path: ['content'], message: 'text content is required unless redacted' })
  }
  if ((value.binary || value.redacted) && value.content !== undefined) {
    ctx.addIssue({ code: 'custom', path: ['content'], message: 'content must be omitted for binary or redacted files' })
  }
})

export const LocalArtifactSchema = z.object({
  path: z.string().min(1),
  mediaType: z.string().min(1).max(256),
  size: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
})

/**
 * Explicit, user-initiated upload from a local_executor to the tenant home
 * volume. The binary bodies travel as transport attachments; this payload is
 * the descriptor and consent record, never an automatic sync.
 */
export const UploadLocalArtifactsSchema = z.object({
  tenantId: TenantIdSchema,
  workdirKey: WorkdirKeySchema,
  assignmentId: AssignmentIdSchema.optional(),
  files: z.array(LocalArtifactSchema).min(1).max(64),
  destination: z.literal('tenant_volume'),
  clientContext: ClientContextSchema,
  consent: z.object({
    requestedBy: z.string().min(1),
    requestedAt: z.string().datetime(),
    source: z.enum(['app', 'cli']),
  }),
})

export const UploadLocalArtifactsResponseSchema = z.object({
  uploads: z.array(z.object({
    uploadId: z.string().min(1),
    sourcePath: z.string(),
    storedPath: z.string(),
    size: z.number().int().nonnegative(),
  })),
})

export const ExecutorErrorCodeSchema = z.enum([
  'ASSIGNMENT_NOT_FOUND',
  'WORKDIR_BUSY',
  'WORKDIR_NOT_FOUND',
  'NO_CAPACITY',
  'PREVIEW_LIMIT',
  'PATH_OUTSIDE_WORKDIR',
  'FILE_NOT_FOUND',
  'FILE_TOO_LARGE',
  'INVALID_PAYLOAD',
  'SECRET_REF_UNKNOWN',
  'EXECUTOR_OFFLINE',
  'WORKSPACE_UNSUPPORTED',
  'WORKSPACE_KIND_MISMATCH',
  'WORKSPACE_DEVICE_MISMATCH',
  'WORKSPACE_PROJECT_MISMATCH',
  'WORKSPACE_PATH_MISMATCH',
  'WORKSPACE_BASEREF_MISMATCH',
  'MODEL_NOT_ALLOWED',
  'MODEL_NOT_CONFIGURED',
  'MODEL_SOURCE_DISABLED',
  'TENANT_MISMATCH',
  'UPLOAD_REJECTED',
  'INTERNAL',
])

export const ExecutorErrorSchema = z.object({
  code: ExecutorErrorCodeSchema,
  message: z.string().min(1),
  details: z.record(z.string(), z.unknown()).optional(),
})

export const ExecutorResponseSchema = <T extends z.ZodType>(value: T) => z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), value }),
  z.object({ ok: z.literal(false), error: ExecutorErrorSchema }),
])

export const AuthContextSchema = z.object({
  tenantId: TenantIdSchema,
  principal: z.string().min(1),
})

export type TenantId = z.infer<typeof TenantIdSchema>
export type AuthContext = z.infer<typeof AuthContextSchema>
export type CreateAssignment = z.infer<typeof CreateAssignmentSchema>
export type Assignment = z.infer<typeof AssignmentSchema>
export type AssignmentEvent = z.infer<typeof AssignmentEventSchema>
export type ExecutorErrorCode = z.infer<typeof ExecutorErrorCodeSchema>

/** Fail closed when a payload tenant and the transport-authenticated tenant disagree. */
export function assertTenantMatches(payloadTenantId: string, auth: AuthContext): void {
  if (payloadTenantId !== auth.tenantId) {
    throw new Error(`TENANT_MISMATCH: payload tenant ${payloadTenantId} does not match authenticated tenant ${auth.tenantId}`)
  }
}

export type Workspace = z.infer<typeof WorkspaceSchema>

/**
 * Compare the immutable parts of a workspace. A changed value produces a
 * specific mismatch code so the Bot can explain the failure instead of treating
 * every wrong workspace as the same error.
 */
export function workspaceMismatch(
  expected: Workspace,
  actual: Workspace,
): z.infer<typeof ExecutorErrorCodeSchema> | undefined {
  if (expected.kind !== actual.kind) return 'WORKSPACE_KIND_MISMATCH'
  if (expected.kind === 'cloud_project' && actual.kind === 'cloud_project') {
    if (expected.projectId !== actual.projectId) return 'WORKSPACE_PROJECT_MISMATCH'
    if (expected.repo.provider !== actual.repo.provider
      || expected.repo.host !== actual.repo.host
      || expected.repo.projectPath !== actual.repo.projectPath
      || expected.repo.cloneUrl !== actual.repo.cloneUrl) return 'WORKSPACE_PROJECT_MISMATCH'
    if (expected.baseRef !== actual.baseRef) return 'WORKSPACE_BASEREF_MISMATCH'
    return undefined
  }
  if (expected.kind === 'local_dir' && actual.kind === 'local_dir') {
    if (expected.deviceId !== actual.deviceId) return 'WORKSPACE_DEVICE_MISMATCH'
    if (expected.path !== actual.path) return 'WORKSPACE_PATH_MISMATCH'
    if (expected.baseRef !== actual.baseRef) return 'WORKSPACE_BASEREF_MISMATCH'
    return undefined
  }
  return 'WORKSPACE_KIND_MISMATCH'
}

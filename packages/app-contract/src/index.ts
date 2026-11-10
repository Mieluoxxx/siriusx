/** Bot ⇄ application contract for local and cloud clients. */
import { z } from 'zod'
import { AssignmentStateSchema, DiffStatsSchema, ExecutorErrorSchema } from '@siriusx/contracts/executor'
import { TICKET_STAGES } from '@siriusx/contracts/ticket-stage'

export const TicketStageSchema = z.enum(TICKET_STAGES)
export const BotSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['team', 'personal']),
  status: z.enum(['online', 'offline', 'degraded']),
  model: z.string().optional(),
})

export const AssignmentReportViewSchema = z.object({
  kind: z.enum(['ready', 'answer', 'blocked', 'failed', 'waiting']),
  summary: z.string(),
  question: z.string().optional(),
  reason: z.string().optional(),
  diffStats: DiffStatsSchema.optional(),
  diffBasis: z.enum(['baseRef', 'ticketStart', 'none']).optional(),
  changeRequest: z.object({ provider: z.enum(['gitlab', 'github']), number: z.number().int().positive(), url: z.url() }).optional(),
})

export const TicketSummarySchema = z.object({
  ticketId: z.string(),
  title: z.string(),
  stage: TicketStageSchema,
  closed: z.boolean(),
  pendingInputs: z.number().int().nonnegative(),
  latestAssignment: z.object({
    assignmentId: z.string(),
    state: AssignmentStateSchema,
    report: AssignmentReportViewSchema.optional(),
  }).optional(),
})

export const TicketEventSchema = z.object({
  type: z.enum(['state', 'report', 'log', 'activity']),
  seq: z.number().int().nonnegative(),
}).passthrough()

export const TicketDetailSchema = TicketSummarySchema.extend({ events: z.array(TicketEventSchema) })

export const ApprovalCardSchema = z.object({
  approvalId: z.string(),
  ticketId: z.string(),
  title: z.string(),
  detail: z.string(),
  risk: z.enum(['low', 'medium', 'high']),
  status: z.enum(['pending', 'approved', 'rejected', 'expired']),
  expiresAt: z.string().datetime().optional(),
})

export const ApiErrorSchema = z.object({ error: z.string(), code: z.string().optional(), details: ExecutorErrorSchema.optional() })
export const BotsResponseSchema = z.object({ bots: z.array(BotSummarySchema) })
export const TicketsResponseSchema = z.object({ tickets: z.array(TicketSummarySchema) })
export const ApprovalsResponseSchema = z.object({ approvals: z.array(ApprovalCardSchema) })
export const CreateTicketRequestSchema = z.object({ path: z.string().min(1), prompt: z.string().min(1), title: z.string().optional() })
export const FollowUpRequestSchema = z.object({ text: z.string().min(1) })
export const EmptyRequestSchema = z.object({})

export type TicketStage = z.infer<typeof TicketStageSchema>
export type BotSummary = z.infer<typeof BotSummarySchema>
export type AssignmentReportView = z.infer<typeof AssignmentReportViewSchema>
export type TicketSummary = z.infer<typeof TicketSummarySchema>
export type TicketDetail = z.infer<typeof TicketDetailSchema>
export type ApprovalCard = z.infer<typeof ApprovalCardSchema>
export type CreateTicketRequest = z.infer<typeof CreateTicketRequestSchema>
export type FollowUpRequest = z.infer<typeof FollowUpRequestSchema>

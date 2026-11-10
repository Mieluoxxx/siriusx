/** Pure derivation of the seven user-visible Ticket stages. */

export const TICKET_STAGES = [
  'person/delivery',
  'person/answer',
  'person/review',
  'person/blocked_failed',
  'working',
  'working/queued',
  'idle',
] as const

export type TicketStage = typeof TICKET_STAGES[number]

export type AssignmentState =
  | 'preparing'
  | 'running'
  | 'backgrounded'
  | 'reported'
  | 'cancelled'
  | 'lost'

export type ReportKind = 'ready' | 'answer' | 'blocked' | 'failed' | 'waiting'

export interface LatestAssignmentStageFacts {
  readonly state: AssignmentState
  readonly reportKind?: ReportKind | undefined
}

export interface TicketStageInput {
  /** Last CreateAssignment delivery failed and has not succeeded after retry. */
  readonly deliveryFailing: boolean
  /** Newest Assignment, or undefined when the Ticket has never been dispatched. */
  readonly latest?: LatestAssignmentStageFacts | undefined
  /** Input exists that no Assignment has consumed yet. */
  readonly pendingInput: boolean
}

/**
 * Derive the display stage. The order of checks is part of the contract:
 * delivery > running > queued > person-facing reports > idle.
 */
export function deriveTicketStage(input: TicketStageInput): TicketStage {
  if (input.deliveryFailing) return 'person/delivery'

  const state = input.latest?.state
  if (state === 'preparing' || state === 'running' || state === 'backgrounded') return 'working'
  if (input.latest === undefined || input.pendingInput) return 'working/queued'

  switch (input.latest.reportKind) {
    case 'answer': return 'person/answer'
    case 'ready': return 'person/review'
    case 'blocked':
    case 'failed': return 'person/blocked_failed'
    case 'waiting': return 'idle'
    case undefined: return 'idle'
  }
}

/**
 * A ready assignment with no reviewable artifact ends the Ticket instead of
 * entering person/review. The caller supplies the reviewable facts because
 * only Executor/Bot can check live previews.
 */
export function readyNeedsReview(input: {
  readonly changeRequest: boolean
  readonly filesChanged: number
  readonly livePreviews: number
}): boolean {
  return input.changeRequest || input.filesChanged > 0 || input.livePreviews > 0
}

/** SiriusX team panel: bots, tickets, live state, report and approval placeholders. */
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { BotSummary, TicketDetail, TicketSummary } from '@siriusx/app-contract'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

const PANEL_ID = 'siriusx-team' as MainPanelId
const DEFAULT_API = 'http://127.0.0.1:4319'

function apiBase(): string {
  try { return localStorage.getItem('siriusx.botApi') ?? DEFAULT_API } catch { return DEFAULT_API }
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  const value = await response.json() as unknown
  if (!response.ok) throw new Error(typeof value === 'object' && value !== null && 'error' in value ? String(value.error) : `HTTP ${response.status}`)
  return value as T
}

const styles = {
  page: { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', color: 'inherit', background: 'transparent', font: '13px/1.45 system-ui, sans-serif' },
  header: { display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: '1px solid color-mix(in srgb, currentColor 14%, transparent)' },
  title: { fontWeight: 700, fontSize: 16 },
  tabs: { display: 'flex', gap: 6, marginLeft: 'auto' },
  body: { minHeight: 0, flex: 1, display: 'grid', gridTemplateColumns: 'minmax(300px, 38%) 1fr' },
  list: { minHeight: 0, overflow: 'auto', borderRight: '1px solid color-mix(in srgb, currentColor 14%, transparent)', padding: 12 },
  detail: { minHeight: 0, overflow: 'auto', padding: 16 },
  ticket: { width: '100%', textAlign: 'left', padding: 10, borderRadius: 8, border: '1px solid color-mix(in srgb, currentColor 14%, transparent)', background: 'transparent', color: 'inherit', cursor: 'pointer', marginBottom: 8 },
  stage: { fontSize: 11, opacity: 0.7 },
  form: { display: 'grid', gap: 8, padding: 12, borderBottom: '1px solid color-mix(in srgb, currentColor 14%, transparent)' },
  input: { width: '100%', boxSizing: 'border-box', padding: '7px 9px', borderRadius: 6, border: '1px solid color-mix(in srgb, currentColor 22%, transparent)', background: 'transparent', color: 'inherit' },
  button: { padding: '6px 10px', borderRadius: 6, border: '1px solid color-mix(in srgb, currentColor 22%, transparent)', background: 'color-mix(in srgb, currentColor 6%, transparent)', color: 'inherit', cursor: 'pointer' },
  report: { whiteSpace: 'pre-wrap', padding: 10, borderRadius: 8, background: 'color-mix(in srgb, currentColor 6%, transparent)', fontFamily: 'ui-monospace, monospace', fontSize: 12, overflowWrap: 'anywhere' },
  row: { display: 'flex', gap: 8, alignItems: 'center' },
} satisfies Record<string, CSSProperties>

function TicketPanel(): ReactNode {
  const [tab, setTab] = useState<'tickets' | 'bots' | 'approvals'>('tickets')
  const [bots, setBots] = useState<BotSummary[]>([])
  const [tickets, setTickets] = useState<TicketSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | undefined>()
  const [selected, setSelected] = useState<TicketDetail | undefined>()
  const [repo, setRepo] = useState('')
  const [prompt, setPrompt] = useState('')
  const [followUp, setFollowUp] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)

  const selectedTicket = useMemo(() => selected ?? tickets.find(ticket => ticket.ticketId === selectedId), [selected, tickets, selectedId])
  const selectedEvents = selected?.events ?? []
  const orderedTickets = useMemo(() => [...tickets].sort((left, right) => Number(right.stage.startsWith('person/')) - Number(left.stage.startsWith('person/'))), [tickets])

  const refresh = async (): Promise<void> => {
    try {
      const [botResult, ticketResult] = await Promise.all([
        json<{ bots: BotSummary[] }>('/api/bots'),
        json<{ tickets: TicketSummary[] }>('/api/tickets'),
      ])
      setBots(botResult.bots)
      setTickets(ticketResult.tickets)
      if (selectedId !== undefined) {
        setSelected(await json<TicketDetail>(`/api/tickets/${selectedId}`))
      }
      setError(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      // A disconnected Bot API must not leave stale tickets pretending to be live.
      setTickets([])
      setSelected(undefined)
    }
  }

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => { void refresh() }, 1500)
    return () => clearInterval(timer)
  }, [selectedId])

  const createTicket = async (): Promise<void> => {
    if (repo.trim() === '' || prompt.trim() === '') return
    setBusy(true)
    try {
      const created = await json<TicketSummary>('/api/tickets', { method: 'POST', body: JSON.stringify({ path: repo.trim(), prompt: prompt.trim() }) })
      setSelectedId(created.ticketId)
      setPrompt('')
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setBusy(false) }
  }

  const sendInput = async (): Promise<void> => {
    if (selectedId === undefined || followUp.trim() === '') return
    setBusy(true)
    try {
      await json(`/api/tickets/${selectedId}/input`, { method: 'POST', body: JSON.stringify({ text: followUp.trim() }) })
      setFollowUp('')
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setBusy(false) }
  }

  const cancel = async (): Promise<void> => {
    if (selectedId === undefined) return
    setBusy(true)
    try {
      await json(`/api/tickets/${selectedId}/cancel`, { method: 'POST', body: '{}' })
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setBusy(false) }
  }

  return (
    <div style={styles.page} data-testid="siriusx-team-panel">
      <div style={styles.header}>
        <span style={styles.title}>SiriusX Team</span>
        <span style={{ ...styles.stage, fontSize: 12 }}>{bots.length} bot · {tickets.length} ticket</span>
        <div style={styles.tabs}>
          {(['tickets', 'bots', 'approvals'] as const).map(item => (
            <button key={item} style={{ ...styles.button, fontWeight: tab === item ? 700 : 400 }} onClick={() => setTab(item)}>{item}</button>
          ))}
          <button style={styles.button} onClick={() => { void refresh() }}>Refresh</button>
        </div>
      </div>
      {error !== undefined ? <div style={{ padding: '8px 16px', color: '#d33' }}>Bot API: {error}</div> : null}
      {tab === 'tickets' ? (
        <div style={styles.body}>
          <div style={{ ...styles.list, display: 'flex', flexDirection: 'column' }}>
            <div style={styles.form}>
              <input style={styles.input} placeholder="Local repository path (absolute)" value={repo} onChange={event => setRepo(event.target.value)} />
              <textarea style={{ ...styles.input, minHeight: 54 }} placeholder="What should the bot do?" value={prompt} onChange={event => setPrompt(event.target.value)} />
              <button style={styles.button} disabled={busy || repo.trim() === '' || prompt.trim() === ''} onClick={() => { void createTicket() }}>Dispatch ticket</button>
            </div>
            <div style={{ overflow: 'auto' }}>
              {tickets.length === 0 ? <p style={{ opacity: 0.65 }}>No tickets yet. Dispatch one to the local Executor.</p> : null}
              {orderedTickets.map(ticket => (
                <button
                  key={ticket.ticketId}
                  style={{ ...styles.ticket, borderColor: ticket.ticketId === selectedId ? 'currentColor' : undefined }}
                  onClick={() => { setSelectedId(ticket.ticketId); setSelected(undefined) }}
                >
                  <div style={styles.row}>
                    <strong>{ticket.stage}</strong>
                    <span style={{ ...styles.stage, marginLeft: 'auto' }}>{ticket.closed ? 'closed' : 'open'}</span>
                  </div>
                  <div style={styles.stage}>{ticket.ticketId.slice(0, 13)} · {ticket.latestAssignment?.state ?? 'queued'}</div>
                  <div>{ticket.latestAssignment?.report?.summary ?? 'Waiting for report…'}</div>
                </button>
              ))}
            </div>
          </div>
          <div style={styles.detail}>
            {selectedTicket === undefined ? <p style={{ opacity: 0.65 }}>Select a ticket to inspect its report and events.</p> : (
              <>
                <div style={styles.row}>
                  <h2 style={{ margin: '0 0 8px', fontSize: 18 }}>{selectedTicket.stage}</h2>
                  <span style={{ ...styles.stage, marginLeft: 'auto' }}>{selectedTicket.latestAssignment?.state}</span>
                </div>
                <div style={{ ...styles.stage, marginBottom: 10 }}>{selectedTicket.ticketId}</div>
                {selectedTicket.latestAssignment?.report?.summary !== undefined
                  ? <div style={styles.report}>{selectedTicket.latestAssignment.report.summary}</div>
                  : <p style={{ opacity: 0.65 }}>No report yet.</p>}
                {selectedTicket.latestAssignment?.report?.diffStats !== undefined ? (
                  <pre style={{ ...styles.report, marginTop: 10 }}>{JSON.stringify(selectedTicket.latestAssignment.report.diffStats, undefined, 2)}</pre>
                ) : null}
                <div style={{ ...styles.row, marginTop: 14 }}>
                  <input style={styles.input} placeholder="Follow-up / interrupt text" value={followUp} onChange={event => setFollowUp(event.target.value)} />
                  <button style={styles.button} disabled={busy || followUp.trim() === ''} onClick={() => { void sendInput() }}>Send</button>
                  <button style={styles.button} disabled={busy} onClick={() => { void cancel() }}>Stop</button>
                </div>
                <h3 style={{ fontSize: 14, marginTop: 18 }}>Events</h3>
                <pre style={styles.report}>{selectedEvents.map(event => JSON.stringify(event)).join('\n') || 'No events'}</pre>
              </>
            )}
          </div>
        </div>
      ) : null}
      {tab === 'bots' ? (
        <div style={{ padding: 18, overflow: 'auto' }}>
          <h2 style={{ fontSize: 16 }}>Bots</h2>
          {bots.map(bot => <div key={bot.id} style={{ ...styles.ticket, cursor: 'default' }}><strong>{bot.name}</strong> <span style={styles.stage}>{bot.kind} · {bot.status}</span></div>)}
        </div>
      ) : null}
      {tab === 'approvals' ? (
        <div style={{ padding: 18 }}>
          <h2 style={{ fontSize: 16 }}>Approvals</h2>
          <p style={{ opacity: 0.65 }}>No pending approvals. The real approval API arrives with the tool gateway (S6).</p>
        </div>
      ) : null}
    </div>
  )
}

function TeamIcon({ size }: PropsRuntime<'sidebar.panellist'>): ReactNode {
  return <span style={{ fontSize: size, lineHeight: 1 }} aria-hidden="true">▣</span>
}

export const inject = ['slots']

export function apply(ctx: ClientContext): void {
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
  }, TicketPanel))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 20,
    label: () => 'Team',
  }, TeamIcon))
}

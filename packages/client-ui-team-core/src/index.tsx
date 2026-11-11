/** SiriusX team panel: bots, tickets, live state, report and approval placeholders. */
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ApprovalCard, BotSummary, DeviceSummary, TicketDetail, TicketSummary } from '@siriusx/app-contract'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

export type TeamTab = 'tickets' | 'bots' | 'devices' | 'approvals' | 'admin'
const DEFAULT_API = 'http://127.0.0.1:4319'
const DEFAULT_CONTROL_API = 'http://127.0.0.1:4320'

function gatewayMode(): boolean {
  try { return localStorage.getItem('siriusx.gatewayAuth') === '1' } catch { return false }
}

function apiBase(): string {
  try {
    const control = localStorage.getItem('siriusx.controlToken')
    if (control !== null && control !== '') return localStorage.getItem('siriusx.controlApi') ?? DEFAULT_CONTROL_API
    if (gatewayMode()) return ''
    return localStorage.getItem('siriusx.botApi') ?? DEFAULT_API
  } catch { return DEFAULT_API }
}

function controlToken(): string | undefined {
  try {
    const token = localStorage.getItem('siriusx.controlToken')
    return token === null || token === '' ? undefined : token
  } catch { return undefined }
}

function controlPath(path: string): string {
  if (path === '/api/bots') return '/v1/bots'
  if (path === '/api/approvals') return '/v1/approvals'
  if (path === '/api/me') return '/v1/me'
  if (path === '/api/users') return '/v1/users'
  if (path === '/api/settings') return '/v1/settings'
  if (path === '/api/tool-policies') return '/v1/tool-policies'
  return path.replace(/^\/api/, '/v1')
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const token = controlToken()
  const control = token !== undefined || gatewayMode()
  const response = await fetch(`${apiBase()}${control ? controlPath(path) : path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      ...(init?.headers ?? {}),
    },
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

function TicketPanel({ initialTab }: { initialTab: TeamTab }): ReactNode {
  const [tab, setTab] = useState<TeamTab>(initialTab)
  const [bots, setBots] = useState<BotSummary[]>([])
  const [tickets, setTickets] = useState<TicketSummary[]>([])
  const [approvals, setApprovals] = useState<ApprovalCard[]>([])
  const [devices, setDevices] = useState<DeviceSummary[]>([])
  const [deviceId, setDeviceId] = useState('')
  const [cloudRepo, setCloudRepo] = useState('')
  const [cloudBase, setCloudBase] = useState('main')
  const [selectedId, setSelectedId] = useState<string | undefined>()
  const [selected, setSelected] = useState<TicketDetail | undefined>()
  const [repo, setRepo] = useState('')
  const [prompt, setPrompt] = useState('')
  const [followUp, setFollowUp] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const [rotatedToken, setRotatedToken] = useState<{ deviceId: string; token: string } | undefined>()
  const [me, setMe] = useState<{ role: string } | undefined>()
  const [users, setUsers] = useState<Array<{ userId: string; email: string; role: string }>>([])
  const [settings, setSettings] = useState<{ nativeConversationEnabled: boolean; byokEnabled: boolean; localExecutionEnabled: boolean } | undefined>()
  const [toolPolicies, setToolPolicies] = useState<Array<{ actionClass: string; effect: string }>>([])
  const [policyAction, setPolicyAction] = useState('')
  const [policyEffect, setPolicyEffect] = useState<'approval' | 'deny'>('approval')
  const [newUserEmail, setNewUserEmail] = useState('')
  const [newUserRole, setNewUserRole] = useState<'admin' | 'member'>('member')
  const [pairName, setPairName] = useState('')
  const [pairCode, setPairCode] = useState('')
  const [pairingCode, setPairingCode] = useState<{ code: string; expiresAt: number } | undefined>()

  const selectedTicket = useMemo(() => selected ?? tickets.find(ticket => ticket.ticketId === selectedId), [selected, tickets, selectedId])
  const selectedEvents = selected?.events ?? []
  const orderedTickets = useMemo(() => [...tickets].sort((left, right) => Number(right.stage.startsWith('person/')) - Number(left.stage.startsWith('person/'))), [tickets])

  const refresh = async (): Promise<void> => {
    try {
      const [botResult, ticketResult, approvalResult, deviceResult] = await Promise.all([
        json<{ bots: BotSummary[] }>('/api/bots'),
        json<{ tickets: TicketSummary[] }>('/api/tickets'),
        json<{ approvals: ApprovalCard[] }>('/api/approvals'),
        json<{ devices: DeviceSummary[] }>('/api/devices').catch(() => ({ devices: [] })),
      ])
      setBots(botResult.bots.map(bot => ({
        id: bot.id,
        name: bot.name,
        kind: 'personal',
        status: 'online',
      })))
      setTickets(ticketResult.tickets)
      setApprovals(approvalResult.approvals)
      setDevices(deviceResult.devices)
      if (controlToken() !== undefined || gatewayMode()) {
        const current = await json<{ role: string }>('/api/me').catch(() => undefined)
        setMe(current)
        if (current?.role === 'admin') {
          const [userResult, settingResult, policyResult] = await Promise.all([
            json<{ users: Array<{ userId: string; email: string; role: string }> }>('/api/users').catch(() => ({ users: [] })),
            json<{ nativeConversationEnabled: boolean; byokEnabled: boolean; localExecutionEnabled: boolean }>('/api/settings').catch(() => undefined),
            json<{ policies: Array<{ actionClass: string; effect: string }> }>('/api/tool-policies').catch(() => ({ policies: [] })),
          ])
          setUsers(userResult.users)
          setSettings(settingResult)
          setToolPolicies(policyResult.policies)
        } else { setUsers([]); setSettings(undefined); setToolPolicies([]) }
      } else { setMe(undefined); setUsers([]); setSettings(undefined); setToolPolicies([]) }
      if (selectedId !== undefined) {
        setSelected(await json<TicketDetail>(`/api/tickets/${selectedId}`))
      }
      setError(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      // A disconnected Bot API must not leave stale tickets pretending to be live.
      setTickets([])
      setApprovals([])
      setDevices([])
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
      const endpoint = deviceId === '' ? '/api/tickets' : `/api/devices/${deviceId}/tickets`
      const created = await json<TicketSummary>(endpoint, { method: 'POST', body: JSON.stringify({ path: repo.trim(), prompt: prompt.trim() }) })
      setSelectedId(created.ticketId)
      setPrompt('')
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setBusy(false) }
  }

  const createCloudTicket = async (): Promise<void> => {
    if (cloudRepo.trim() === '' || prompt.trim() === '') return
    setBusy(true)
    try {
      const created = await json<{ ticketId: string }>('/api/cloud-projects/tickets', {
        method: 'POST',
        body: JSON.stringify({ repoUrl: cloudRepo.trim(), baseRef: cloudBase.trim() || 'main', prompt: prompt.trim() }),
      })
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

  const decideApproval = async (approvalId: string, approved: boolean): Promise<void> => {
    setBusy(true)
    try {
      await json(`/api/approvals/${approvalId}/decide`, { method: 'POST', body: JSON.stringify({ approved }) })
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setBusy(false) }
  }

  const startDevicePairing = async (): Promise<void> => {
    if (pairName.trim() === '') return
    setBusy(true)
    try {
      const pairing = await json<{ code: string; expiresAt: number }>('/api/devices/pair/start', { method: 'POST', body: JSON.stringify({ name: pairName.trim() }) })
      setPairingCode(pairing)
      setPairName('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) }
  }

  const confirmDevicePairing = async (): Promise<void> => {
    if (pairCode.trim() === '') return
    setBusy(true)
    try {
      await json('/api/devices/pair/confirm', { method: 'POST', body: JSON.stringify({ code: pairCode.trim().toUpperCase() }) })
      setPairCode(''); setPairingCode(undefined); await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) }
  }

  const rotateDevice = async (id: string): Promise<void> => {
    setBusy(true)
    try {
      const rotated = await json<{ token: string }>(`/api/devices/${id}/rotate-token`, { method: 'POST', body: '{}' })
      setRotatedToken({ deviceId: id, token: rotated.token })
      await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) }
  }

  const revokeDevice = async (id: string): Promise<void> => {
    setBusy(true)
    try {
      await json(`/api/devices/${id}/revoke`, { method: 'POST', body: '{}' })
      await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) }
  }

  const saveSettings = async (patch: Partial<{ nativeConversationEnabled: boolean; byokEnabled: boolean; localExecutionEnabled: boolean }>): Promise<void> => {
    setBusy(true)
    try { setSettings(await json('/api/settings', { method: 'PUT', body: JSON.stringify(patch) })) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) }
  }

  const addUser = async (): Promise<void> => {
    if (newUserEmail.trim() === '') return
    setBusy(true)
    try {
      await json('/api/users', { method: 'POST', body: JSON.stringify({ email: newUserEmail.trim(), role: newUserRole }) })
      setNewUserEmail('')
      await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) }
  }

  const changeUserRole = async (userId: string, role: 'admin' | 'member'): Promise<void> => {
    setBusy(true)
    try { await json(`/api/users/${userId}/role`, { method: 'PUT', body: JSON.stringify({ role }) }); await refresh() }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) }
  }

  const setToolPolicy = async (): Promise<void> => {
    if (policyAction.trim() === '') return
    setBusy(true)
    try {
      const result = await json<{ policies: Array<{ actionClass: string; effect: string }> }>(`/api/tool-policies/${encodeURIComponent(policyAction.trim())}`, { method: 'PUT', body: JSON.stringify({ effect: policyEffect }) })
      setToolPolicies(result.policies); setPolicyAction('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) }
  }

  const deleteToolPolicy = async (actionClass: string): Promise<void> => {
    setBusy(true)
    try {
      const result = await json<{ policies: Array<{ actionClass: string; effect: string }> }>(`/api/tool-policies/${encodeURIComponent(actionClass)}`, { method: 'DELETE' })
      setToolPolicies(result.policies)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) }
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
    <div style={styles.page} data-testid="siriusx-team-panel" className="sx-team-page">
      <style>{`
        @media (max-width: 760px) {
          .sx-team-header { flex-wrap: wrap; }
          .sx-team-header .sx-team-tabs { margin-left: 0; width: 100%; overflow-x: auto; }
          .sx-team-body { grid-template-columns: 1fr !important; }
          .sx-team-list { border-right: 0 !important; max-height: 48vh; }
          .sx-team-detail { border-top: 1px solid color-mix(in srgb, currentColor 14%, transparent); }
        }
      `}</style>
      <div style={styles.header} className="sx-team-header">
        <span style={styles.title}>SiriusX Team</span>
        <span style={{ ...styles.stage, fontSize: 12 }}>{bots.length} bot · {tickets.length} ticket</span>
        <div style={styles.tabs} className="sx-team-tabs">
          {(['tickets', 'bots', 'devices', 'approvals', 'admin'] as const).map(item => (
            <button key={item} style={{ ...styles.button, fontWeight: tab === item ? 700 : 400 }} onClick={() => setTab(item)}>{item}</button>
          ))}
          <button style={styles.button} onClick={() => { void refresh() }}>Refresh</button>
        </div>
      </div>
      {error !== undefined ? <div style={{ padding: '8px 16px', color: '#d33' }}>Bot API: {error}</div> : null}
      {tab === 'tickets' ? (
        <div style={styles.body} className="sx-team-body">
          <div style={{ ...styles.list, display: 'flex', flexDirection: 'column' }} className="sx-team-list">
            {gatewayMode() ? (
              <div style={styles.form}>
                <p style={{ margin: 0, opacity: 0.7 }}>Web 端只使用云端项目；本地目录请使用桌面端或已配对手机。</p>
                <input style={styles.input} placeholder="Cloud repository URL" value={cloudRepo} onChange={event => setCloudRepo(event.target.value)} />
                <input style={styles.input} placeholder="Base ref" value={cloudBase} onChange={event => setCloudBase(event.target.value)} />
                <textarea style={{ ...styles.input, minHeight: 54 }} placeholder="What should the bot do?" value={prompt} onChange={event => setPrompt(event.target.value)} />
                <button style={styles.button} disabled={busy || cloudRepo.trim() === '' || prompt.trim() === ''} onClick={() => { void createCloudTicket() }}>Dispatch cloud ticket</button>
              </div>
            ) : (
              <div style={styles.form}>
                <input style={styles.input} placeholder="Local repository path (absolute)" value={repo} onChange={event => setRepo(event.target.value)} />
                <textarea style={{ ...styles.input, minHeight: 54 }} placeholder="What should the bot do?" value={prompt} onChange={event => setPrompt(event.target.value)} />
                {devices.length === 0 ? null : (
                  <select style={styles.input} value={deviceId} onChange={event => setDeviceId(event.target.value)}>
                    <option value="">Cloud/local Bot runtime</option>
                    {devices.filter(device => !device.revoked).map(device => <option key={device.id} value={device.id}>Device: {device.name}</option>)}
                  </select>
                )}
                <button style={styles.button} disabled={busy || repo.trim() === '' || prompt.trim() === ''} onClick={() => { void createTicket() }}>Dispatch ticket</button>
              </div>
            )}
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
          <div style={styles.detail} className="sx-team-detail">
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
      {tab === 'devices' ? (
        <div style={{ padding: 18, overflow: 'auto' }}>
          <h2 style={{ fontSize: 16 }}>Devices</h2>
          <div style={styles.form}>
            <div style={styles.row}>
              <input style={styles.input} placeholder="New device name" value={pairName} onChange={event => setPairName(event.target.value)} />
              <button style={styles.button} disabled={busy || pairName.trim() === ''} onClick={() => { void startDevicePairing() }}>Pair device</button>
            </div>
            {pairingCode === undefined ? null : (
              <div style={{ ...styles.report, display: 'grid', gap: 8 }}>
                <div>Pairing code: <strong>{pairingCode.code}</strong></div>
                <div style={styles.row}>
                  <input style={styles.input} placeholder="Pairing code" value={pairCode} onChange={event => setPairCode(event.target.value)} />
                  <button style={styles.button} disabled={busy || pairCode.trim() === ''} onClick={() => { void confirmDevicePairing() }}>Confirm pairing</button>
                </div>
              </div>
            )}
          </div>
          {devices.length === 0 ? <p style={{ opacity: 0.65 }}>No paired devices for this tenant.</p> : null}
          {devices.map(device => (
            <div key={device.id} style={{ ...styles.ticket, cursor: 'default', opacity: device.revoked ? 0.55 : 1 }}>
              <div style={styles.row}>
                <strong>{device.name}</strong>
                <span style={{ ...styles.stage, marginLeft: 'auto' }}>{device.revoked ? 'revoked' : 'active'}</span>
              </div>
              <div style={styles.stage}>{device.id}</div>
              <div style={styles.stage}>last seen: {device.lastSeenAt === null || device.lastSeenAt === undefined ? 'never' : new Date(device.lastSeenAt).toLocaleString()}</div>
              <div style={styles.stage}>token expires: {device.tokenExpiresAt === null || device.tokenExpiresAt === undefined ? 'unknown' : new Date(device.tokenExpiresAt).toLocaleString()}</div>
              <div style={{ ...styles.row, marginTop: 8 }}>
                <button style={styles.button} disabled={busy || device.revoked} onClick={() => { void rotateDevice(device.id) }}>Rotate token</button>
                <button style={styles.button} disabled={busy || device.revoked} onClick={() => { void revokeDevice(device.id) }}>Revoke</button>
              </div>
              {rotatedToken?.deviceId === device.id ? (
                <div style={{ ...styles.report, marginTop: 8 }}>
                  New token (shown once): {rotatedToken.token}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {tab === 'admin' ? (
        <div style={{ padding: 18, overflow: 'auto' }}>
          <h2 style={{ fontSize: 16 }}>Admin</h2>
          {me?.role !== 'admin' ? <p style={{ opacity: 0.65 }}>Admin role required.</p> : (
            <>
              <h3 style={{ fontSize: 14 }}>Tenant settings</h3>
              {settings === undefined ? <p style={{ opacity: 0.65 }}>Settings unavailable.</p> : (
                <div style={{ display: 'grid', gap: 8, maxWidth: 480 }}>
                  <label><input type="checkbox" checked={settings.nativeConversationEnabled} disabled={busy} onChange={event => { void saveSettings({ nativeConversationEnabled: event.target.checked }) }} /> Native conversation</label>
                  <label><input type="checkbox" checked={settings.byokEnabled} disabled={busy} onChange={event => { void saveSettings({ byokEnabled: event.target.checked }) }} /> BYOK</label>
                  <label><input type="checkbox" checked={settings.localExecutionEnabled} disabled={busy} onChange={event => { void saveSettings({ localExecutionEnabled: event.target.checked }) }} /> Local execution</label>
                </div>
              )}
              <h3 style={{ fontSize: 14, marginTop: 22 }}>Users</h3>
              <div style={{ ...styles.row, maxWidth: 620, marginBottom: 12 }}>
                <input style={styles.input} placeholder="User email" value={newUserEmail} onChange={event => setNewUserEmail(event.target.value)} />
                <select style={styles.input} value={newUserRole} onChange={event => setNewUserRole(event.target.value === 'admin' ? 'admin' : 'member')}>
                  <option value="member">member</option><option value="admin">admin</option>
                </select>
                <button style={styles.button} disabled={busy || newUserEmail.trim() === ''} onClick={() => { void addUser() }}>Add user</button>
              </div>
              {users.map(user => (
                <div key={user.userId} style={{ ...styles.ticket, cursor: 'default', maxWidth: 620 }}>
                  <div style={styles.row}>
                    <strong>{user.email}</strong>
                    <select style={{ ...styles.input, width: 110, marginLeft: 'auto' }} value={user.role} disabled={busy} onChange={event => { void changeUserRole(user.userId, event.target.value === 'admin' ? 'admin' : 'member') }}>
                      <option value="member">member</option><option value="admin">admin</option>
                    </select>
                  </div>
                </div>
              ))}
              <h3 style={{ fontSize: 14, marginTop: 22 }}>Tool policies</h3>
              <div style={{ ...styles.row, maxWidth: 620, marginBottom: 12 }}>
                <input style={styles.input} placeholder="Action class" value={policyAction} onChange={event => setPolicyAction(event.target.value)} />
                <select style={styles.input} value={policyEffect} onChange={event => setPolicyEffect(event.target.value === 'deny' ? 'deny' : 'approval')}>
                  <option value="approval">approval</option><option value="deny">deny</option>
                </select>
                <button style={styles.button} disabled={busy || policyAction.trim() === ''} onClick={() => { void setToolPolicy() }}>Set policy</button>
              </div>
              {toolPolicies.map(policy => (
                <div key={policy.actionClass} style={{ ...styles.ticket, cursor: 'default', maxWidth: 620 }}>
                  <div style={styles.row}><strong>{policy.actionClass}</strong><span style={{ ...styles.stage, marginLeft: 'auto' }}>{policy.effect}</span><button style={styles.button} disabled={busy} onClick={() => { void deleteToolPolicy(policy.actionClass) }}>Delete</button></div>
                </div>
              ))}
            </>
          )}
        </div>
      ) : null}
      {tab === 'approvals' ? (
        <div style={{ padding: 18, overflow: 'auto' }}>
          <h2 style={{ fontSize: 16 }}>Approvals</h2>
          {approvals.length === 0 ? <p style={{ opacity: 0.65 }}>No approval cards for this tenant.</p> : null}
          {approvals.map(card => (
            <div key={card.approvalId} style={{ ...styles.ticket, cursor: 'default' }}>
              <div style={styles.row}>
                <strong>{card.title}</strong>
                <span style={{ ...styles.stage, marginLeft: 'auto' }}>{card.status} · {card.risk}</span>
              </div>
              <div style={{ ...styles.report, marginTop: 8 }}>{card.detail}</div>
              <div style={{ ...styles.row, marginTop: 8 }}>
                <span style={styles.stage}>ticket {card.ticketId}</span>
                <button style={{ ...styles.button, marginLeft: 'auto' }} disabled={busy || card.status !== 'pending'} onClick={() => { void decideApproval(card.approvalId, true) }}>Approve</button>
                <button style={styles.button} disabled={busy || card.status !== 'pending'} onClick={() => { void decideApproval(card.approvalId, false) }}>Reject</button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function TeamIcon({ size }: PropsRuntime<'sidebar.panellist'>): ReactNode {
  return <span style={{ fontSize: size, lineHeight: 1 }} aria-hidden="true">▣</span>
}

export const inject = ['slots']

export function createTeamApply(panelId: string, label: string, initialTab: TeamTab): (ctx: ClientContext) => void {
  return function apply(ctx: ClientContext): void {
    ctx.slots.inject('main', () => ctx.slots.register({
      name: 'main',
      key: panelId as MainPanelId,
    }, () => <TicketPanel initialTab={initialTab} />))
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
      name: 'sidebar.panellist',
      id: panelId as MainPanelId,
      order: 20,
      label: () => label,
    }, TeamIcon))
  }
}

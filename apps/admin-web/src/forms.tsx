/** SiriusX admin forms built only from shared Base UI primitives. */
import * as React from 'react'
import { Field } from '@base-ui-components/react/field'
import { Input } from '@base-ui-components/react/input'
import { BaseForm, Button, CheckboxField, FormActions, FormError, SelectField, SubmitButton, TextField, useSubmit, valueOf, type FormSubmit, type SelectOption } from './ui'

export { numberValue, valueOf } from './ui'

export interface AuthFormProps {
  initialToken: string
  onConnect: (token: string) => Promise<void>
  actions?: React.ReactNode
}

export function AuthForm({ initialToken, onConnect, actions }: AuthFormProps): React.ReactElement {
  const { busy, error, formRef, submit } = useSubmit(values => onConnect(valueOf(values, 'token')), false)
  return (
    <BaseForm formRef={formRef} onSubmit={submit}>
      <TextField name="token" label="Platform token" defaultValue={initialToken} type="password" required autoComplete="off" spellCheck={false} placeholder="Platform admin token" />
      <FormError message={error} />
      <FormActions className={actions === undefined ? undefined : 'form-actions-split'}>
        <SubmitButton busy={busy}>Connect</SubmitButton>
        {actions}
      </FormActions>
    </BaseForm>
  )
}

export function CreateTenantForm({ onSubmit }: { onSubmit: FormSubmit }): React.ReactElement {
  const { busy, error, formRef, submit } = useSubmit(onSubmit, true)
  return (
    <BaseForm formRef={formRef} onSubmit={submit}>
      <div className="form-grid">
        <TextField name="name" label="Name" required placeholder="Acme" />
        <TextField name="idpIssuer" label="IdP issuer" required placeholder="https://idp.example/realms/siriusx" />
        <TextField name="adminEmail" label="Admin email" type="email" required placeholder="admin@example.com" />
        <TextField name="tenantId" label="Tenant ID" placeholder="tenant-acme" />
      </div>
      <FormError message={error} />
      <FormActions><SubmitButton busy={busy}>Create tenant</SubmitButton></FormActions>
    </BaseForm>
  )
}

export function CreateModelForm({ upstreams, onSubmit }: { upstreams: SelectOption[]; onSubmit: FormSubmit }): React.ReactElement {
  const { busy, error, formRef, submit } = useSubmit(onSubmit, true)
  const upstreamOptions: SelectOption[] = [{ value: '', label: 'None (manual / tenant override)' }, ...upstreams]
  return (
    <BaseForm formRef={formRef} onSubmit={submit}>
      <div className="form-grid">
        <SelectField name="upstreamId" label="Platform upstream" options={upstreamOptions} />
        <TextField name="model" label="Upstream model ID" required placeholder="gpt-4.1" />
        <TextField name="name" label="Display name" required placeholder="Acme GPT-4.1" />
        <TextField name="id" label="Catalog ID" placeholder="Auto from model ID" />
        <TextField name="provider" label="Provider" required defaultValue="openai" placeholder="openai" />
      </div>
      <FormError message={error} />
      <FormActions><SubmitButton busy={busy}>Add model</SubmitButton></FormActions>
    </BaseForm>
  )
}

export interface PlatformUpstreamInitial {
  name: string
  protocol: string
  baseUrl: string
  hasApiKey: boolean
  enabled: boolean
}

export function PlatformUpstreamForm({ initial, onSubmit }: { initial?: PlatformUpstreamInitial; onSubmit: FormSubmit }): React.ReactElement {
  const { busy, error, formRef, submit } = useSubmit(onSubmit, initial === undefined)
  return (
    <BaseForm formRef={formRef} onSubmit={submit}>
      <div className="form-grid">
        <TextField name="name" label="Upstream name" defaultValue={initial?.name ?? ''} required placeholder="OpenAI Production" />
        <SelectField
          name="protocol"
          label="Protocol"
          defaultValue={initial?.protocol ?? 'chat'}
          options={[
            { value: 'chat', label: 'Chat Completions' },
            { value: 'responses', label: 'OpenAI Responses' },
            { value: 'claude', label: 'Anthropic Messages' },
          ]}
        />
        <TextField name="baseUrl" label="Base URL" type="url" defaultValue={initial?.baseUrl ?? ''} required placeholder="https://api.openai.com/v1" />
        <TextField
          name="apiKey"
          label="API key"
          type="password"
          autoComplete="off"
          placeholder={initial?.hasApiKey ? 'Leave blank to keep existing key' : 'sk-...'}
        />
        <CheckboxField name="enabled" label="Enabled" defaultChecked={initial?.enabled ?? true} />
      </div>
      <FormError message={error} />
      <FormActions><SubmitButton busy={busy}>{initial === undefined ? 'Add upstream' : 'Save upstream'}</SubmitButton></FormActions>
    </BaseForm>
  )
}

export interface FetchedUpstreamModel {
  model: string
  name: string
  alreadyAdded: boolean
}

export function ImportUpstreamModelsForm({ models, onImport }: {
  models: FetchedUpstreamModel[]
  onImport: (selected: FetchedUpstreamModel[]) => Promise<void>
}): React.ReactElement {
  const [query, setQuery] = React.useState('')
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set())
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const available = models.filter(item => !item.alreadyAdded)
  const normalized = query.trim().toLowerCase()
  const filtered = models.filter(item => normalized === '' || item.model.toLowerCase().includes(normalized) || item.name.toLowerCase().includes(normalized))
  const toggle = (model: string): void => {
    setSelected(current => {
      const next = new Set(current)
      if (next.has(model)) next.delete(model)
      else next.add(model)
      return next
    })
  }
  const selectAllAvailable = (): void => {
    setSelected(new Set(available.filter(item => normalized === '' || item.model.toLowerCase().includes(normalized) || item.name.toLowerCase().includes(normalized)).map(item => item.model)))
  }
  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (selected.size === 0) return
    setBusy(true)
    setError('')
    try {
      await onImport(models.filter(item => selected.has(item.model)))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="form" onSubmit={event => { void submit(event) }}>
      <div className="filter-bar">
        <Field.Root name="fetchModelFilter" className="filter-field filter-grow">
          <Field.Label className="filter-label">Filter fetched models</Field.Label>
          <Input className="input" type="search" value={query} onValueChange={setQuery} placeholder="Search model ID or name" autoComplete="off" />
        </Field.Root>
        <Button type="button" variant="ghost" disabled={available.length === 0} onClick={selectAllAvailable}>Select new</Button>
        <Button type="button" variant="ghost" disabled={selected.size === 0} onClick={() => setSelected(new Set())}>Clear</Button>
      </div>
      <div className="fetch-model-list" role="group" aria-label="Upstream models">
        {filtered.length === 0 ? <p className="empty">No models match this filter.</p> : filtered.map(item => {
          const checked = item.alreadyAdded || selected.has(item.model)
          return (
            <label key={item.model} className="fetch-model-item">
              <input
                type="checkbox"
                checked={checked}
                disabled={item.alreadyAdded || busy}
                onChange={() => toggle(item.model)}
              />
              <span className="fetch-model-info">
                <strong>{item.name}</strong>
                <span className="mono muted">{item.model}</span>
              </span>
              {item.alreadyAdded ? <span className="pill">Added</span> : null}
            </label>
          )
        })}
      </div>
      <FormError message={error} />
      <FormActions className="form-actions-split">
        <span className="muted">{selected.size} selected · {available.length} available</span>
        <Button type="submit" variant="primary" disabled={busy || selected.size === 0}>{busy ? 'Importing…' : `Import selected (${selected.size})`}</Button>
      </FormActions>
    </form>
  )
}

export function CreateBindingForm({ onSubmit }: { onSubmit: FormSubmit }): React.ReactElement {
  const { busy, error, formRef, submit } = useSubmit(onSubmit, true)
  return (
    <BaseForm formRef={formRef} onSubmit={submit}>
      <div className="form-grid">
        <TextField name="provider" label="Provider" required placeholder="gitlab" />
        <TextField name="externalId" label="External ID" required placeholder="group/project" />
        <TextField name="tenantId" label="Tenant ID" required placeholder="tenant-acme" />
        <TextField name="repoUrl" label="Repository URL" type="url" placeholder="https://github.com/acme/repo.git" />
        <TextField name="baseRef" label="Base ref" placeholder="main" />
        <CheckboxField name="autoDispatch" label="Auto-dispatch incoming events" />
      </div>
      <FormError message={error} />
      <FormActions><SubmitButton busy={busy}>Add binding</SubmitButton></FormActions>
    </BaseForm>
  )
}

export interface TenantFiltersProps {
  onChange: (query: string, status: string) => void
  total: number
}

export function TenantFilters({ onChange, total }: TenantFiltersProps): React.ReactElement {
  const [query, setQuery] = React.useState('')
  const [status, setStatus] = React.useState('')
  const update = (nextQuery: string, nextStatus: string): void => {
    setQuery(nextQuery)
    setStatus(nextStatus)
    onChange(nextQuery, nextStatus)
  }
  const statusOptions: SelectOption[] = [{ value: '', label: 'All' }, { value: 'active', label: 'Active' }, { value: 'suspended', label: 'Suspended' }]
  const dirty = query.trim() !== '' || status !== ''
  const countLabel = `${total} ${total === 1 ? 'tenant' : 'tenants'}`
  return (
    <div className="toolbar filter-bar">
      <Field.Root name="tenantQuery" className="filter-field filter-search">
        <Field.Label className="filter-label">Search tenants</Field.Label>
        <Input className="input" type="search" value={query} onValueChange={value => update(value, status)} placeholder="Name, ID, or issuer" autoComplete="off" />
      </Field.Root>
      <SelectField name="tenantStatus" label="Status" options={statusOptions} value={status} onValueChange={value => update(query, value)} className="filter-field filter-status" />
      {dirty ? <Button variant="ghost" onClick={() => update('', '')}>Reset</Button> : null}
      <output className="filter-output">{countLabel}</output>
    </div>
  )
}

export interface TenantInitialValues {
  name: string
  idpIssuer: string
  quota: { maxUsers: number; maxDevices: number; maxCloudTicketsPerDay: number; maxDeviceTicketsPerDay: number }
  billing: { currency: string; cloudTicketCents: number; deviceTicketCents: number; monthlyBudgetCents: number | null }
  models: string[]
  estimate?: string
}

export function TenantProfileForm({ initial, onSubmit }: { initial: TenantInitialValues; onSubmit: FormSubmit }): React.ReactElement {
  const form = useSubmit(onSubmit, false)
  return (
    <BaseForm formRef={form.formRef} onSubmit={form.submit}>
      <TextField name="name" label="Tenant name" defaultValue={initial.name} required />
      <TextField name="idpIssuer" label="IdP issuer" defaultValue={initial.idpIssuer} required />
      <FormError message={form.error} />
      <FormActions><SubmitButton busy={form.busy}>Save profile</SubmitButton></FormActions>
    </BaseForm>
  )
}

export function TenantQuotaForm({ initial, onSubmit }: { initial: TenantInitialValues; onSubmit: FormSubmit }): React.ReactElement {
  const form = useSubmit(onSubmit, false)
  return (
    <BaseForm formRef={form.formRef} onSubmit={form.submit}>
      <div className="form-grid">
        <TextField name="maxUsers" label="Max users" type="number" defaultValue={String(initial.quota.maxUsers)} required />
        <TextField name="maxDevices" label="Max devices" type="number" defaultValue={String(initial.quota.maxDevices)} required />
        <TextField name="maxCloudTicketsPerDay" label="Cloud tickets / day" type="number" defaultValue={String(initial.quota.maxCloudTicketsPerDay)} required />
        <TextField name="maxDeviceTicketsPerDay" label="Device tickets / day" type="number" defaultValue={String(initial.quota.maxDeviceTicketsPerDay)} required />
      </div>
      <FormError message={form.error} />
      <FormActions><SubmitButton busy={form.busy}>Save quota</SubmitButton></FormActions>
    </BaseForm>
  )
}

export function TenantBillingForm({ initial, onSubmit }: { initial: TenantInitialValues; onSubmit: FormSubmit }): React.ReactElement {
  const form = useSubmit(onSubmit, false)
  return (
    <BaseForm formRef={form.formRef} onSubmit={form.submit}>
      <div className="form-grid">
        <TextField name="currency" label="Currency" defaultValue={initial.billing.currency} required />
        <TextField name="cloudTicketCents" label="Cloud ticket cents" type="number" defaultValue={String(initial.billing.cloudTicketCents)} required />
        <TextField name="deviceTicketCents" label="Device ticket cents" type="number" defaultValue={String(initial.billing.deviceTicketCents)} required />
        <TextField name="monthlyBudgetCents" label="Monthly budget cents" type="number" defaultValue={initial.billing.monthlyBudgetCents === null ? '' : String(initial.billing.monthlyBudgetCents)} />
      </div>
      <FormError message={form.error} />
      <FormActions><SubmitButton busy={form.busy}>Save billing</SubmitButton></FormActions>
    </BaseForm>
  )
}

export function AddTenantUserForm({ onSubmit }: { onSubmit: FormSubmit }): React.ReactElement {
  const form = useSubmit(onSubmit, true)
  return (
    <BaseForm formRef={form.formRef} onSubmit={form.submit}>
      <div className="form-grid">
        <TextField name="email" label="User email" type="email" required placeholder="user@example.com" />
        <SelectField name="role" label="Role" options={[{ value: 'member', label: 'Member' }, { value: 'admin', label: 'Admin' }]} />
      </div>
      <FormError message={form.error} />
      <FormActions><SubmitButton busy={form.busy}>Add user</SubmitButton></FormActions>
    </BaseForm>
  )
}

export function AddUpstreamForm({ models, onSubmit }: { models: string[]; onSubmit: FormSubmit }): React.ReactElement {
  const form = useSubmit(onSubmit, true)
  const options: SelectOption[] = models.length === 0 ? [{ value: '', label: 'Enable a model first' }] : models.map(model => ({ value: model, label: model }))
  return (
    <BaseForm formRef={form.formRef} onSubmit={form.submit}>
      <div className="form-grid">
        <SelectField name="modelId" label="Model" options={options} disabled={models.length === 0} />
        <TextField name="name" label="Upstream name" required placeholder="openai-primary" />
        <SelectField name="protocol" label="Protocol" options={[{ value: 'chat', label: 'Chat Completions' }, { value: 'responses', label: 'OpenAI Responses' }, { value: 'claude', label: 'Anthropic Messages' }]} />
        <TextField name="baseUrl" label="Base URL" type="url" required placeholder="https://api.openai.com/v1" />
        <TextField name="upstreamModel" label="Upstream model" required placeholder="gpt-4.1" />
        <TextField name="apiKey" label="API key" type="password" placeholder="API key" />
        <TextField name="priority" label="Priority" type="number" defaultValue="0" />
        <CheckboxField name="enabled" label="Enabled" defaultChecked />
      </div>
      <FormError message={form.error} />
      <FormActions><SubmitButton busy={form.busy}>Add upstream</SubmitButton></FormActions>
    </BaseForm>
  )
}

export function RequestSupportForm({ onSubmit }: { onSubmit: FormSubmit }): React.ReactElement {
  const form = useSubmit(onSubmit, true)
  return (
    <BaseForm formRef={form.formRef} onSubmit={form.submit}>
      <TextField name="reason" label="Support reason" required placeholder="Reason" />
      <FormError message={form.error} />
      <FormActions><SubmitButton busy={form.busy}>Request support</SubmitButton></FormActions>
    </BaseForm>
  )
}

export interface AuditFilterValue {
  query: string
  action: string
  range: string
}

export interface AuditFiltersProps {
  actions: string[]
  onChange: (value: AuditFilterValue) => void
}

export function AuditFilters({ actions, onChange }: AuditFiltersProps): React.ReactElement {
  const [query, setQuery] = React.useState('')
  const [action, setAction] = React.useState('')
  const [range, setRange] = React.useState('all')
  const update = (next: Partial<AuditFilterValue>): void => {
    const value = { query, action, range, ...next }
    if (next.query !== undefined) setQuery(next.query)
    if (next.action !== undefined) setAction(next.action)
    if (next.range !== undefined) setRange(next.range)
    onChange(value)
  }
  const actionOptions: SelectOption[] = [{ value: '', label: 'All actions' }, ...actions.map(value => ({ value, label: value }))]
  const rangeOptions: SelectOption[] = [{ value: 'all', label: 'All time' }, { value: '24h', label: 'Last 24 hours' }, { value: '7d', label: 'Last 7 days' }, { value: '30d', label: 'Last 30 days' }]
  return (
    <div className="toolbar audit-filter-bar">
      <Field.Root name="auditQuery" className="filter-field filter-grow">
        <Field.Label className="filter-label">Search audit</Field.Label>
        <Input className="input" type="search" value={query} onValueChange={value => update({ query: value })} placeholder="Actor, target, or detail" autoComplete="off" />
      </Field.Root>
      <SelectField name="auditAction" label="Action" options={actionOptions} value={action} onValueChange={value => update({ action: value })} className="filter-field" />
      <SelectField name="auditRange" label="Date range" options={rangeOptions} value={range} onValueChange={value => update({ range: value || 'all' })} className="filter-field" />
      <Button variant="ghost" onClick={() => update({ query: '', action: '', range: 'all' })}>Reset</Button>
    </div>
  )
}

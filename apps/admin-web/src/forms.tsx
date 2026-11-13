/** Base UI + StyleX form primitives and SiriusX admin forms. */
import * as React from 'react'
import { Button } from '@base-ui-components/react/button'
import { Checkbox } from '@base-ui-components/react/checkbox'
import { Field } from '@base-ui-components/react/field'
import { Form } from '@base-ui-components/react/form'
import { Input } from '@base-ui-components/react/input'
import { Select } from '@base-ui-components/react/select'
import * as stylex from '@stylexjs/stylex'

type Values = Record<string, unknown>
type FormSubmit = (values: Values) => Promise<void> | void

type StyleArg = object

function cls(...values: StyleArg[]): string { return (stylex.props as unknown as (...args: StyleArg[]) => { className?: string })(...values).className ?? '' }

const styles = stylex.create({
  form: {
    display: 'grid',
    gap: '14px',
    inlineSize: '100%',
  },
  authForm: {
    display: 'flex',
    flexWrap: 'nowrap',
    alignItems: 'center',
    gap: '8px',
  },
  authField: {
    display: 'grid',
    gridTemplateColumns: 'auto minmax(0, 1fr)',
    alignItems: 'center',
    gap: '8px',
    flex: '1 1 0',
    minInlineSize: 0,
  },
  authError: {
    gridColumn: '1 / -1',
    color: '#f56c6c',
    fontSize: '11px',
    lineHeight: '14px',
  },
  authLabel: {
    color: '#606266',
    fontSize: '12px',
    fontWeight: 400,
    lineHeight: '20px',
    whiteSpace: 'nowrap',
    '@media (max-width: 980px)': { display: 'none' },
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
    gap: '16px',
    alignItems: 'start',
  },
  field: {
    display: 'grid',
    gridTemplateColumns: '128px minmax(0, 1fr)',
    gap: '8px 12px',
    alignItems: 'center',
    minInlineSize: 0,
    '@media (max-width: 560px)': { gridTemplateColumns: '1fr', gap: '4px' },
  },
  label: {
    color: '#6f6f6a',
    fontSize: '12px',
    fontWeight: 500,
    lineHeight: '32px',
    textAlign: 'end',
    whiteSpace: 'nowrap',
    '@media (max-width: 560px)': { lineHeight: '18px', textAlign: 'start' },
  },
  optional: {
    color: '#8a97aa',
    fontWeight: 400,
  },
  input: {
    boxSizing: 'border-box',
    inlineSize: '100%',
    minBlockSize: '38px',
    paddingBlock: '8px',
    paddingInline: '11px',
    border: '1px solid #e2e2dc',
    borderRadius: '8px',
    background: '#ffffff',
    color: '#181818',
    fontFamily: 'inherit',
    fontSize: '13px',
    lineHeight: '20px',
    transition: 'border-color 140ms ease, box-shadow 140ms ease',
    ':focus-visible': {
      borderColor: '#2563eb',
      outline: '3px solid color-mix(in srgb, #2563eb 20%, transparent)',
      outlineOffset: '1px',
    },
    ':user-invalid': {
      borderColor: '#b3261e',
    },
  },
  selectTrigger: {
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    inlineSize: '100%',
    minBlockSize: '38px',
    paddingBlock: '8px',
    paddingInline: '11px',
    border: '1px solid #e2e2dc',
    borderRadius: '8px',
    background: '#ffffff',
    color: '#181818',
    fontFamily: 'inherit',
    fontSize: '13px',
    lineHeight: '20px',
    textAlign: 'start',
    cursor: 'pointer',
    ':focus-visible': {
      borderColor: '#2563eb',
      outline: '3px solid color-mix(in srgb, #2563eb 20%, transparent)',
      outlineOffset: '1px',
    },
  },
  selectIcon: { color: '#8a8a85', fontSize: '10px' },
  positioner: { zIndex: 100 },
  popup: {
    minInlineSize: 'var(--anchor-width)',
    maxBlockSize: '260px',
    overflow: 'auto',
    padding: '4px',
    border: '1px solid #e7e7e2',
    borderRadius: '10px',
    background: '#ffffff',
    boxShadow: '0 12px 32px rgb(0 0 0 / 10%)',
  },
  item: {
    paddingBlock: '8px',
    paddingInline: '10px',
    borderRadius: '6px',
    color: '#181818',
    fontFamily: 'inherit',
    fontSize: '13px',
    cursor: 'pointer',
    outline: 'none',
    ':hover': { background: '#f7f7f4' },
    ':focus': { background: '#eef4ff', color: '#2563eb' },
  },
  checkboxRow: {
    gridColumn: '2 / 3',
    '@media (max-width: 560px)': { gridColumn: '1' },
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    minBlockSize: '38px',
    color: '#6f6f6a',
    fontSize: '13px',
  },
  checkbox: {
    display: 'grid',
    placeItems: 'center',
    inlineSize: '17px',
    blockSize: '17px',
    padding: 0,
    border: '1px solid #d7d7d1',
    borderRadius: '4px',
    background: '#ffffff',
    color: '#ffffff',
    cursor: 'pointer',
    ':focus-visible': {
      outline: '3px solid color-mix(in srgb, #2563eb 20%, transparent)',
      outlineOffset: '2px',
    },
  },
  checkboxIndicator: { fontSize: '12px', lineHeight: 1 },
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
    paddingBlockStart: '2px',
  },
  button: {
    minBlockSize: '36px',
    paddingBlock: '7px',
    paddingInline: '14px',
    border: '1px solid #e2e2dc',
    borderRadius: '8px',
    background: '#ffffff',
    color: '#181818',
    fontFamily: 'inherit',
    fontSize: '13px',
    fontWeight: 500,
    cursor: 'pointer',
    ':hover': { background: '#f7f7f4', borderColor: '#d7d7d1', color: '#181818' },
    ':focus-visible': {
      outline: '2px solid color-mix(in srgb, #409eff 28%, transparent)',
      outlineOffset: '0',
    },
  },
  buttonPrimary: {
    borderColor: '#2563eb',
    background: '#2563eb',
    color: '#ffffff',
    ':hover': { background: '#1d4ed8', borderColor: '#1d4ed8', color: '#ffffff' },
  },
  buttonDanger: {
    borderColor: '#fecaca',
    background: '#fef2f2',
    color: '#dc2626',
    ':hover': { background: '#dc2626', borderColor: '#dc2626', color: '#ffffff' },
  },
  error: {
    margin: 0,
    padding: '8px 10px',
    border: '1px solid #fecaca',
    borderRadius: '8px',
    background: '#fef2f2',
    color: '#dc2626',
    fontSize: '12px',
    lineHeight: '17px',
  },
  errorFull: { gridColumn: '1 / -1', flexBasis: '100%' },
  fieldError: {
    gridColumn: '2 / 3',
    color: '#dc2626',
    fontSize: '12px',
    lineHeight: '16px',
    '@media (max-width: 560px)': { gridColumn: '1' },
  },
  section: {
    display: 'grid',
    gap: '10px',
    alignContent: 'start',
    padding: '16px',
    border: '1px solid #e7e7e2',
    borderRadius: '10px',
    background: '#fafaf8',
    minInlineSize: 0,
  },
  sectionTitle: {
    margin: 0,
    color: '#181818',
    fontSize: '14px',
    fontWeight: 600,
    lineHeight: '18px',
  },
  detailGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
    gap: '12px',
    alignItems: 'start',
  },
  tenantFilterForm: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'end',
    gap: '12px',
    inlineSize: '100%',
    maxInlineSize: '1100px',
  },
  tenantSearchField: {
    display: 'grid',
    gridTemplateColumns: 'auto minmax(0, 1fr)',
    alignItems: 'center',
    gap: '8px',
    flex: '0 1 420px',
    minInlineSize: 0,
    '@media (max-width: 720px)': { flexBasis: '100%' },
  },
  tenantStatusField: {
    display: 'grid',
    gridTemplateColumns: 'auto 160px',
    alignItems: 'center',
    gap: '8px',
    flex: '0 0 auto',
    '@media (max-width: 720px)': { flexBasis: '100%', gridTemplateColumns: 'auto minmax(0, 1fr)' },
  },
  tenantFilterLabel: {
    color: '#6f6f6a',
    fontSize: '12px',
    fontWeight: 500,
    lineHeight: '20px',
    whiteSpace: 'nowrap',
  },
  tenantFilterOutput: {
    marginInlineStart: 'auto',
    alignSelf: 'center',
    color: '#8a8a85',
    fontSize: '12px',
    whiteSpace: 'nowrap',
    '@media (max-width: 720px)': { marginInlineStart: 0 },
  },
  auditFilterForm: {
    display: 'grid',
    gridTemplateColumns: 'minmax(220px, 1fr) 190px 170px auto',
    gap: '12px',
    alignItems: 'end',
    '@media (max-width: 760px)': { gridTemplateColumns: '1fr' },
  },
  filterField: {
    display: 'grid',
    gap: '6px',
    minInlineSize: 0,
  },
  filterLabel: {
    color: '#6f6f6a',
    fontSize: '11px',
    fontWeight: 600,
  },
})

function valueOf(values: Values, key: string): string {
  const value = values[key]
  return value === undefined || value === null ? '' : String(value)
}

function numberValue(values: Values, key: string): number {
  return Number(valueOf(values, key) || '0')
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function useSubmit(onSubmit: FormSubmit, resetOnSuccess: boolean): {
  busy: boolean
  error: string
  formRef: React.RefObject<HTMLFormElement | null>
  submit: (values: Values) => void
} {
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const formRef = React.useRef<HTMLFormElement>(null)
  const submit = (values: Values): void => {
    setBusy(true)
    setError('')
    void Promise.resolve(onSubmit(values))
      .then(() => { if (resetOnSuccess) formRef.current?.reset() })
      .catch((reason: unknown) => setError(errorText(reason)))
      .finally(() => setBusy(false))
  }
  return { busy, error, formRef, submit }
}

function ErrorMessage({ message, fullWidth = false }: { message: string; fullWidth?: boolean }): React.ReactElement | null {
  return message === '' ? null : <p className={cls(styles.error, fullWidth ? styles.errorFull : styles.error)} role="alert">{message}</p>
}

interface TextFieldProps {
  name: string
  label: string
  defaultValue?: string
  type?: React.HTMLInputTypeAttribute
  required?: boolean
  placeholder?: string
}

function TextField({ name, label, defaultValue = '', type = 'text', required = false, placeholder }: TextFieldProps): React.ReactElement {
  return (
    <Field.Root name={name} className={cls(styles.field)}>
      <Field.Label className={cls(styles.label)}>{label}</Field.Label>
      <Input className={cls(styles.input)} defaultValue={defaultValue} type={type} required={required} placeholder={placeholder} />
      <Field.Error className={cls(styles.fieldError)} />
    </Field.Root>
  )
}

interface SelectOption { value: string; label: string }
interface SelectFieldProps {
  name: string
  label: string
  options: SelectOption[]
  defaultValue?: string
  disabled?: boolean
  onValueChange?: (value: string) => void
}

function SelectField({ name, label, options, defaultValue, disabled = false, onValueChange }: SelectFieldProps): React.ReactElement {
  const items = Object.fromEntries(options.map(option => [option.value, option.label]))
  return (
    <Field.Root name={name} className={cls(styles.field)}>
      <Field.Label className={cls(styles.label)}>{label}</Field.Label>
      <Select.Root name={name} items={items} defaultValue={defaultValue ?? options[0]?.value ?? ''} disabled={disabled} onValueChange={value => onValueChange?.(value === null ? '' : String(value))}>
        <Select.Trigger className={cls(styles.selectTrigger)}>
          <Select.Value />
          <Select.Icon className={cls(styles.selectIcon)}>▾</Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Positioner className={cls(styles.positioner)} sideOffset={6}>
            <Select.Popup className={cls(styles.popup)}>
              <Select.List>
                {options.map(option => <Select.Item key={option.value} value={option.value} className={cls(styles.item)}>{option.label}</Select.Item>)}
              </Select.List>
            </Select.Popup>
          </Select.Positioner>
        </Select.Portal>
      </Select.Root>
    </Field.Root>
  )
}

function CheckboxField({ name, label, defaultChecked = false }: { name: string; label: string; defaultChecked?: boolean }): React.ReactElement {
  return (
    <Field.Root name={name} className={cls(styles.field)}>
      <Field.Label className={cls(styles.label)}>{label}</Field.Label>
      <Checkbox.Root name={name} defaultChecked={defaultChecked} className={cls(styles.checkbox)}>
        <Checkbox.Indicator className={cls(styles.checkboxIndicator)}>✓</Checkbox.Indicator>
      </Checkbox.Root>
    </Field.Root>
  )
}

function SubmitButton({ busy, children = 'Save changes' }: { busy: boolean; children?: string }): React.ReactElement {
  return <Button type="submit" disabled={busy} className={cls(styles.button, styles.buttonPrimary)}>{busy ? 'Saving…' : children}</Button>
}

export interface AuthFormProps {
  initialToken: string
  onConnect: (token: string) => Promise<void>
}

export function AuthForm({ initialToken, onConnect }: AuthFormProps): React.ReactElement {
  const { busy, error, formRef, submit } = useSubmit(values => onConnect(valueOf(values, 'token')), false)
  return (
    <Form ref={formRef} className={cls(styles.authForm)} onFormSubmit={values => submit(values as Values)}>
      <Field.Root name="token" className={cls(styles.authField)}>
        <Field.Label className={cls(styles.authLabel)}>Platform token</Field.Label>
        <Input className={cls(styles.input)} defaultValue={initialToken} type="password" required autoComplete="off" spellCheck={false} placeholder="Platform admin token" />
        <Field.Error className={cls(styles.authError)}>Platform token is required.</Field.Error>
      </Field.Root>
      <SubmitButton busy={busy}>Connect</SubmitButton>
      <ErrorMessage message={error} fullWidth />
    </Form>
  )
}

export function CreateTenantForm({ onSubmit }: { onSubmit: FormSubmit }): React.ReactElement {
  const { busy, error, formRef, submit } = useSubmit(onSubmit, true)
  return (
    <Form ref={formRef} className={cls(styles.form)} onFormSubmit={values => submit(values as Values)}>
      <div className={cls(styles.formGrid)}>
        <TextField name="name" label="Name" required placeholder="Acme" />
        <TextField name="idpIssuer" label="IdP issuer" required placeholder="https://idp.example/realms/siriusx" />
        <TextField name="adminEmail" label="Admin email" type="email" required placeholder="admin@example.com" />
        <TextField name="tenantId" label="Tenant ID" placeholder="tenant-acme" />
      </div>
      <ErrorMessage message={error} />
      <div className={cls(styles.actions)}><SubmitButton busy={busy}>Create tenant</SubmitButton></div>
    </Form>
  )
}

export function CreateModelForm({ onSubmit }: { onSubmit: FormSubmit }): React.ReactElement {
  const { busy, error, formRef, submit } = useSubmit(onSubmit, true)
  return (
    <Form ref={formRef} className={cls(styles.form)} onFormSubmit={values => submit(values as Values)}>
      <div className={cls(styles.formGrid)}>
        <TextField name="id" label="Model ID" placeholder="acme-gpt41" />
        <TextField name="name" label="Display name" required placeholder="Acme GPT-4.1" />
        <TextField name="provider" label="Provider" required placeholder="openai" />
        <TextField name="model" label="Provider model ID" required placeholder="gpt-4.1" />
      </div>
      <ErrorMessage message={error} />
      <div className={cls(styles.actions)}><SubmitButton busy={busy}>Add model</SubmitButton></div>
    </Form>
  )
}

export function CreateBindingForm({ onSubmit }: { onSubmit: FormSubmit }): React.ReactElement {
  const { busy, error, formRef, submit } = useSubmit(onSubmit, true)
  return (
    <Form ref={formRef} className={cls(styles.form)} onFormSubmit={values => submit(values as Values)}>
      <div className={cls(styles.formGrid)}>
        <TextField name="provider" label="Provider" required placeholder="gitlab" />
        <TextField name="externalId" label="External ID" required placeholder="group/project" />
        <TextField name="tenantId" label="Tenant ID" required placeholder="tenant-acme" />
        <TextField name="repoUrl" label="Repository URL" type="url" placeholder="https://github.com/acme/repo.git" />
        <TextField name="baseRef" label="Base ref" placeholder="main" />
        <CheckboxField name="autoDispatch" label="Auto-dispatch incoming events" />
      </div>
      <ErrorMessage message={error} />
      <div className={cls(styles.actions)}><SubmitButton busy={busy}>Add binding</SubmitButton></div>
    </Form>
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
    setQuery(nextQuery); setStatus(nextStatus); onChange(nextQuery, nextStatus)
  }
  const statusOptions = [{ value: '', label: 'All' }, { value: 'active', label: 'Active' }, { value: 'suspended', label: 'Suspended' }]
  const dirty = query.trim() !== '' || status !== ''
  return (
    <form className={cls(styles.tenantFilterForm)} onSubmit={event => event.preventDefault()}>
      <Field.Root name="tenantQuery" className={cls(styles.tenantSearchField)}>
        <Field.Label className={cls(styles.tenantFilterLabel)}>Search tenants</Field.Label>
        <Input className={cls(styles.input)} type="search" value={query} onValueChange={value => update(value, status)} placeholder="Name, ID, or issuer" autoComplete="off" />
      </Field.Root>
      <Field.Root name="tenantStatus" className={cls(styles.tenantStatusField)}>
        <Field.Label className={cls(styles.tenantFilterLabel)}>Status</Field.Label>
        <Select.Root name="tenantStatus" items={Object.fromEntries(statusOptions.map(item => [item.value, item.label]))} value={status} onValueChange={value => update(query, value === null ? '' : String(value))}>
          <Select.Trigger className={cls(styles.selectTrigger)}><Select.Value /><Select.Icon className={cls(styles.selectIcon)}>▾</Select.Icon></Select.Trigger>
          <Select.Portal><Select.Positioner className={cls(styles.positioner)} sideOffset={6}><Select.Popup className={cls(styles.popup)}><Select.List>{statusOptions.map(item => <Select.Item key={item.value} value={item.value} className={cls(styles.item)}>{item.label}</Select.Item>)}</Select.List></Select.Popup></Select.Positioner></Select.Portal>
        </Select.Root>
      </Field.Root>
      {dirty ? <button className={cls(styles.button)} type="button" onClick={() => update('', '')}>Reset</button> : null}
      {dirty ? <output id="tenant-count" className={cls(styles.tenantFilterOutput)}>{total} tenants</output> : null}
    </form>
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


export { valueOf, numberValue }

export function TenantProfileForm({ initial, onSubmit }: { initial: TenantInitialValues; onSubmit: FormSubmit }): React.ReactElement {
  const form = useSubmit(onSubmit, false)
  return (
    <Form ref={form.formRef} className={cls(styles.form)} onFormSubmit={values => form.submit(values as Values)}>
      <TextField name="name" label="Tenant name" defaultValue={initial.name} required />
      <TextField name="idpIssuer" label="IdP issuer" defaultValue={initial.idpIssuer} required />
      <ErrorMessage message={form.error} />
      <div className={cls(styles.actions)}><SubmitButton busy={form.busy}>Save profile</SubmitButton></div>
    </Form>
  )
}

export function TenantQuotaForm({ initial, onSubmit }: { initial: TenantInitialValues; onSubmit: FormSubmit }): React.ReactElement {
  const form = useSubmit(onSubmit, false)
  return (
    <Form ref={form.formRef} className={cls(styles.form)} onFormSubmit={values => form.submit(values as Values)}>
      <div className={cls(styles.formGrid)}>
        <TextField name="maxUsers" label="Max users" type="number" defaultValue={String(initial.quota.maxUsers)} required />
        <TextField name="maxDevices" label="Max devices" type="number" defaultValue={String(initial.quota.maxDevices)} required />
        <TextField name="maxCloudTicketsPerDay" label="Cloud tickets / day" type="number" defaultValue={String(initial.quota.maxCloudTicketsPerDay)} required />
        <TextField name="maxDeviceTicketsPerDay" label="Device tickets / day" type="number" defaultValue={String(initial.quota.maxDeviceTicketsPerDay)} required />
      </div>
      <ErrorMessage message={form.error} />
      <div className={cls(styles.actions)}><SubmitButton busy={form.busy}>Save quota</SubmitButton></div>
    </Form>
  )
}

export function TenantBillingForm({ initial, onSubmit }: { initial: TenantInitialValues; onSubmit: FormSubmit }): React.ReactElement {
  const form = useSubmit(onSubmit, false)
  return (
    <Form ref={form.formRef} className={cls(styles.form)} onFormSubmit={values => form.submit(values as Values)}>
      <div className={cls(styles.formGrid)}>
        <TextField name="currency" label="Currency" defaultValue={initial.billing.currency} required />
        <TextField name="cloudTicketCents" label="Cloud ticket cents" type="number" defaultValue={String(initial.billing.cloudTicketCents)} required />
        <TextField name="deviceTicketCents" label="Device ticket cents" type="number" defaultValue={String(initial.billing.deviceTicketCents)} required />
        <TextField name="monthlyBudgetCents" label="Monthly budget cents" type="number" defaultValue={initial.billing.monthlyBudgetCents === null ? '' : String(initial.billing.monthlyBudgetCents)} />
      </div>
      <ErrorMessage message={form.error} />
      <div className={cls(styles.actions)}><SubmitButton busy={form.busy}>Save billing</SubmitButton></div>
    </Form>
  )
}

export function AddTenantUserForm({ onSubmit }: { onSubmit: FormSubmit }): React.ReactElement {
  const form = useSubmit(onSubmit, true)
  return (
    <Form ref={form.formRef} className={cls(styles.form)} onFormSubmit={values => form.submit(values as Values)}>
      <div className={cls(styles.formGrid)}>
        <TextField name="email" label="User email" type="email" required placeholder="user@example.com" />
        <SelectField name="role" label="Role" options={[{ value: 'member', label: 'Member' }, { value: 'admin', label: 'Admin' }]} />
      </div>
      <ErrorMessage message={form.error} />
      <div className={cls(styles.actions)}><SubmitButton busy={form.busy}>Add user</SubmitButton></div>
    </Form>
  )
}

export function AddUpstreamForm({ models, onSubmit }: { models: string[]; onSubmit: FormSubmit }): React.ReactElement {
  const form = useSubmit(onSubmit, true)
  const options = models.length === 0 ? [{ value: '', label: 'Bind a model first' }] : models.map(model => ({ value: model, label: model }))
  return (
    <Form ref={form.formRef} className={cls(styles.form)} onFormSubmit={values => form.submit(values as Values)}>
      <div className={cls(styles.formGrid)}>
        <SelectField name="modelId" label="Model" options={options} disabled={models.length === 0} />
        <TextField name="name" label="Upstream name" required placeholder="openai-primary" />
        <SelectField name="protocol" label="Protocol" options={[{ value: 'chat', label: 'Chat Completions' }, { value: 'responses', label: 'OpenAI Responses' }, { value: 'claude', label: 'Anthropic Messages' }]} />
        <TextField name="baseUrl" label="Base URL" type="url" required placeholder="https://api.openai.com/v1" />
        <TextField name="upstreamModel" label="Upstream model" required placeholder="gpt-4.1" />
        <TextField name="apiKey" label="API key" type="password" placeholder="API key" />
        <TextField name="priority" label="Priority" type="number" defaultValue="0" />
        <CheckboxField name="enabled" label="Enabled" defaultChecked />
      </div>
      <ErrorMessage message={form.error} />
      <div className={cls(styles.actions)}><SubmitButton busy={form.busy}>Add upstream</SubmitButton></div>
    </Form>
  )
}

export function RequestSupportForm({ onSubmit }: { onSubmit: FormSubmit }): React.ReactElement {
  const form = useSubmit(onSubmit, true)
  return (
    <Form ref={form.formRef} className={cls(styles.form)} onFormSubmit={values => form.submit(values as Values)}>
      <TextField name="reason" label="Support reason" required placeholder="Reason" />
      <ErrorMessage message={form.error} />
      <div className={cls(styles.actions)}><SubmitButton busy={form.busy}>Request support</SubmitButton></div>
    </Form>
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
  const actionItems = [{ value: '', label: 'All actions' }, ...actions.map(value => ({ value, label: value }))]
  return (
    <form className={cls(styles.auditFilterForm)} onSubmit={event => event.preventDefault()}>
      <Field.Root name="auditQuery" className={cls(styles.filterField)}>
        <Field.Label className={cls(styles.filterLabel)}>Search audit</Field.Label>
        <Input className={cls(styles.input)} type="search" value={query} onValueChange={value => update({ query: value })} placeholder="Actor, target, or detail" autoComplete="off" />
      </Field.Root>
      <Field.Root name="auditAction" className={cls(styles.filterField)}>
        <Field.Label className={cls(styles.filterLabel)}>Action</Field.Label>
        <Select.Root name="auditAction" items={Object.fromEntries(actionItems.map(item => [item.value, item.label]))} value={action} onValueChange={value => update({ action: value === null ? '' : String(value) })}>
          <Select.Trigger className={cls(styles.selectTrigger)}><Select.Value /><Select.Icon className={cls(styles.selectIcon)}>▾</Select.Icon></Select.Trigger>
          <Select.Portal><Select.Positioner className={cls(styles.positioner)} sideOffset={6}><Select.Popup className={cls(styles.popup)}><Select.List>{actionItems.map(item => <Select.Item key={item.value} value={item.value} className={cls(styles.item)}>{item.label}</Select.Item>)}</Select.List></Select.Popup></Select.Positioner></Select.Portal>
        </Select.Root>
      </Field.Root>
      <Field.Root name="auditRange" className={cls(styles.filterField)}>
        <Field.Label className={cls(styles.filterLabel)}>Date range</Field.Label>
        <Select.Root name="auditRange" items={{ all: 'All time', '24h': 'Last 24 hours', '7d': 'Last 7 days', '30d': 'Last 30 days' }} value={range} onValueChange={value => update({ range: value === null ? 'all' : String(value) })}>
          <Select.Trigger className={cls(styles.selectTrigger)}><Select.Value /><Select.Icon className={cls(styles.selectIcon)}>▾</Select.Icon></Select.Trigger>
          <Select.Portal><Select.Positioner className={cls(styles.positioner)} sideOffset={6}><Select.Popup className={cls(styles.popup)}><Select.List>{[['all', 'All time'], ['24h', 'Last 24 hours'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days']].map(([value, label]) => <Select.Item key={value} value={value} className={cls(styles.item)}>{label}</Select.Item>)}</Select.List></Select.Popup></Select.Positioner></Select.Portal>
        </Select.Root>
      </Field.Root>
      <button className={cls(styles.button)} type="button" onClick={() => update({ query: '', action: '', range: 'all' })}>Reset</button>
    </form>
  )
}

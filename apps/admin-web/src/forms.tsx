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
    display: 'grid',
    gridTemplateColumns: 'minmax(190px, 280px) auto',
    gap: '8px',
    alignItems: 'end',
    '@media (max-width: 820px)': { gridTemplateColumns: '1fr' },
  },
  authLabel: {
    color: '#cbd5e1',
    fontSize: '12px',
    fontWeight: 650,
    lineHeight: '16px',
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
    gap: '14px',
    alignItems: 'start',
  },
  field: {
    display: 'grid',
    gap: '6px',
    minInlineSize: 0,
  },
  label: {
    color: '#61708a',
    fontSize: '12px',
    fontWeight: 650,
    lineHeight: '16px',
  },
  optional: {
    color: '#8a97aa',
    fontWeight: 400,
  },
  input: {
    boxSizing: 'border-box',
    inlineSize: '100%',
    minBlockSize: '40px',
    paddingBlock: '9px',
    paddingInline: '11px',
    border: '1px solid #c8d3e3',
    borderRadius: '9px',
    background: '#ffffff',
    color: '#142033',
    fontFamily: 'inherit',
    fontSize: '14px',
    lineHeight: '20px',
    transition: 'border-color 140ms ease, box-shadow 140ms ease',
    ':focus-visible': {
      borderColor: '#2457d6',
      outline: '3px solid color-mix(in srgb, #2457d6 32%, transparent)',
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
    minBlockSize: '40px',
    paddingBlock: '9px',
    paddingInline: '11px',
    border: '1px solid #c8d3e3',
    borderRadius: '9px',
    background: '#ffffff',
    color: '#142033',
    fontFamily: 'inherit',
    fontSize: '14px',
    lineHeight: '20px',
    textAlign: 'start',
    cursor: 'pointer',
    ':focus-visible': {
      borderColor: '#2457d6',
      outline: '3px solid color-mix(in srgb, #2457d6 32%, transparent)',
      outlineOffset: '1px',
    },
  },
  selectIcon: { color: '#61708a', fontSize: '12px' },
  positioner: { zIndex: 100 },
  popup: {
    minInlineSize: 'var(--anchor-width)',
    maxBlockSize: '260px',
    overflow: 'auto',
    padding: '4px',
    border: '1px solid #dde4ef',
    borderRadius: '10px',
    background: '#ffffff',
    boxShadow: '0 14px 36px rgb(15 23 42 / 14%)',
  },
  item: {
    paddingBlock: '8px',
    paddingInline: '10px',
    borderRadius: '7px',
    color: '#142033',
    fontFamily: 'inherit',
    fontSize: '13px',
    cursor: 'pointer',
    outline: 'none',
    ':hover': { background: '#f2f5fa' },
    ':focus': { background: '#e8efff', color: '#173b9c' },
  },
  checkboxRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    minBlockSize: '40px',
    color: '#142033',
    fontSize: '13px',
  },
  checkbox: {
    display: 'grid',
    placeItems: 'center',
    inlineSize: '18px',
    blockSize: '18px',
    padding: 0,
    border: '1px solid #c8d3e3',
    borderRadius: '5px',
    background: '#ffffff',
    color: '#ffffff',
    cursor: 'pointer',
    ':focus-visible': {
      outline: '3px solid color-mix(in srgb, #2457d6 32%, transparent)',
      outlineOffset: '1px',
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
    minBlockSize: '40px',
    paddingBlock: '8px',
    paddingInline: '14px',
    border: '1px solid #c8d3e3',
    borderRadius: '9px',
    background: '#ffffff',
    color: '#142033',
    fontFamily: 'inherit',
    fontSize: '13px',
    fontWeight: 650,
    cursor: 'pointer',
    ':hover': { background: '#f8fafc' },
    ':focus-visible': {
      outline: '3px solid color-mix(in srgb, #2457d6 32%, transparent)',
      outlineOffset: '2px',
    },
  },
  buttonPrimary: {
    borderColor: '#2457d6',
    background: '#2457d6',
    color: '#ffffff',
    ':hover': { background: '#173b9c' },
  },
  buttonDanger: {
    borderColor: '#f1b7b2',
    background: '#fde8e6',
    color: '#b3261e',
    ':hover': { background: '#fbd9d5' },
  },
  error: {
    margin: 0,
    padding: '8px 10px',
    border: '1px solid #f1b7b2',
    borderRadius: '8px',
    background: '#fde8e6',
    color: '#b3261e',
    fontSize: '12px',
    lineHeight: '17px',
  },
  errorFull: { gridColumn: '1 / -1' },
  fieldError: {
    color: '#b3261e',
    fontSize: '12px',
    lineHeight: '16px',
  },
  hint: {
    color: '#8a97aa',
    fontSize: '11px',
    lineHeight: '16px',
  },
  section: {
    display: 'grid',
    gap: '10px',
    alignContent: 'start',
    padding: '14px',
    border: '1px solid #dde4ef',
    borderRadius: '12px',
    background: '#f8fafc',
    minInlineSize: 0,
  },
  sectionTitle: {
    margin: 0,
    color: '#142033',
    fontSize: '13px',
    fontWeight: 750,
    lineHeight: '18px',
  },
  sectionLead: {
    margin: 0,
    color: '#8a97aa',
    fontSize: '11px',
    lineHeight: '16px',
  },
  detailGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: '12px',
    alignItems: 'start',
  },
  filterForm: {
    display: 'grid',
    gridTemplateColumns: 'minmax(220px, 1fr) 160px auto',
    gap: '12px',
    alignItems: 'end',
    '@media (max-width: 720px)': {
      gridTemplateColumns: '1fr',
    },
  },
  output: {
    alignSelf: 'center',
    color: '#61708a',
    fontSize: '12px',
    paddingBlockEnd: '10px',
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
  hint?: string
}

function TextField({ name, label, defaultValue = '', type = 'text', required = false, placeholder, hint }: TextFieldProps): React.ReactElement {
  return (
    <Field.Root name={name} className={cls(styles.field)}>
      <Field.Label className={cls(styles.label)}>{label}</Field.Label>
      <Input className={cls(styles.input)} defaultValue={defaultValue} type={type} required={required} placeholder={placeholder} />
      {hint === undefined ? null : <span className={cls(styles.hint)}>{hint}</span>}
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
      <label className={cls(styles.checkboxRow)}>
        <Checkbox.Root name={name} defaultChecked={defaultChecked} className={cls(styles.checkbox)}>
          <Checkbox.Indicator className={cls(styles.checkboxIndicator)}>✓</Checkbox.Indicator>
        </Checkbox.Root>
        {label}
      </label>
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
      <Field.Root name="token" className={cls(styles.field)}>
        <Field.Label className={cls(styles.authLabel)}>Platform token</Field.Label>
        <Input className={cls(styles.input)} defaultValue={initialToken} type="password" required autoComplete="off" spellCheck={false} placeholder="Platform admin token" />
        <Field.Error className={cls(styles.fieldError)}>Platform token is required.</Field.Error>
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
        <TextField name="tenantId" label="Tenant ID" hint="Optional. Must match the tenant claim." placeholder="tenant-acme" />
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
        <TextField name="id" label="Model ID" hint="Optional. This is the client-facing alias." placeholder="acme-gpt41" />
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
  return (
    <form className={cls(styles.filterForm)} onSubmit={event => event.preventDefault()}>
      <Field.Root name="tenantQuery" className={cls(styles.field)}>
        <Field.Label className={cls(styles.label)}>Search tenants</Field.Label>
        <Input className={cls(styles.input)} type="search" value={query} onValueChange={value => update(value, status)} placeholder="Name, ID, or issuer" autoComplete="off" />
      </Field.Root>
      <SelectField name="tenantStatus" label="Status" options={[{ value: '', label: 'All' }, { value: 'active', label: 'Active' }, { value: 'suspended', label: 'Suspended' }]} defaultValue={status} onValueChange={value => update(query, value)} />
      <output id="tenant-count" className={cls(styles.output)}>{total} tenants</output>
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

export interface TenantFormHandlers {
  onSaveTenant: FormSubmit
  onSaveQuota: FormSubmit
  onSaveBilling: FormSubmit
  onAddUser: FormSubmit
  onAddUpstream: FormSubmit
  onRequestSupport: FormSubmit
}

export function TenantForms({ initial, handlers }: { initial: TenantInitialValues; handlers: TenantFormHandlers }): React.ReactElement {
  const tenantForm = useSubmit(handlers.onSaveTenant, false)
  const quotaForm = useSubmit(handlers.onSaveQuota, false)
  const billingForm = useSubmit(handlers.onSaveBilling, false)
  const userForm = useSubmit(handlers.onAddUser, true)
  const upstreamForm = useSubmit(handlers.onAddUpstream, true)
  const supportForm = useSubmit(handlers.onRequestSupport, true)
  const modelOptions = initial.models.map(model => ({ value: model, label: model }))
  return (
    <div className={cls(styles.detailGrid)}>
      <section className={cls(styles.section)}>
        <h3 className={cls(styles.sectionTitle)}>Tenant config</h3>
        <Form ref={tenantForm.formRef} className={cls(styles.form)} onFormSubmit={values => tenantForm.submit(values as Values)}>
          <TextField name="name" label="Name" defaultValue={initial.name} required />
          <TextField name="idpIssuer" label="IdP issuer" defaultValue={initial.idpIssuer} required />
          <ErrorMessage message={tenantForm.error} />
          <div className={cls(styles.actions)}><SubmitButton busy={tenantForm.busy}>Save tenant</SubmitButton></div>
        </Form>
      </section>
      <section className={cls(styles.section)}>
        <h3 className={cls(styles.sectionTitle)}>Quota</h3>
        <Form ref={quotaForm.formRef} className={cls(styles.form)} onFormSubmit={values => quotaForm.submit(values as Values)}>
          <div className={cls(styles.formGrid)}>
            <TextField name="maxUsers" label="Max users" type="number" defaultValue={String(initial.quota.maxUsers)} required />
            <TextField name="maxDevices" label="Max devices" type="number" defaultValue={String(initial.quota.maxDevices)} required />
            <TextField name="maxCloudTicketsPerDay" label="Cloud tickets / day" type="number" defaultValue={String(initial.quota.maxCloudTicketsPerDay)} required />
            <TextField name="maxDeviceTicketsPerDay" label="Device tickets / day" type="number" defaultValue={String(initial.quota.maxDeviceTicketsPerDay)} required />
          </div>
          <ErrorMessage message={quotaForm.error} />
          <div className={cls(styles.actions)}><SubmitButton busy={quotaForm.busy}>Save quota</SubmitButton></div>
        </Form>
      </section>
      <section className={cls(styles.section)}>
        <h3 className={cls(styles.sectionTitle)}>Billing</h3>
        <Form ref={billingForm.formRef} className={cls(styles.form)} onFormSubmit={values => billingForm.submit(values as Values)}>
          <div className={cls(styles.formGrid)}>
            <TextField name="currency" label="Currency" defaultValue={initial.billing.currency} required />
            <TextField name="cloudTicketCents" label="Cloud ticket cents" type="number" defaultValue={String(initial.billing.cloudTicketCents)} required />
            <TextField name="deviceTicketCents" label="Device ticket cents" type="number" defaultValue={String(initial.billing.deviceTicketCents)} required />
            <TextField name="monthlyBudgetCents" label="Monthly budget cents" type="number" hint="Leave blank for no budget." defaultValue={initial.billing.monthlyBudgetCents === null ? '' : String(initial.billing.monthlyBudgetCents)} />
          </div>
          <ErrorMessage message={billingForm.error} />
          <div className={cls(styles.actions)}><SubmitButton busy={billingForm.busy}>Save billing</SubmitButton></div>
        </Form>
      </section>
      <section className={cls(styles.section)}>
        <h3 className={cls(styles.sectionTitle)}>Add user</h3>
        <Form ref={userForm.formRef} className={cls(styles.form)} onFormSubmit={values => userForm.submit(values as Values)}>
          <div className={cls(styles.formGrid)}>
            <TextField name="email" label="User email" type="email" required placeholder="user@example.com" />
            <SelectField name="role" label="Role" options={[{ value: 'member', label: 'Member' }, { value: 'admin', label: 'Admin' }]} />
          </div>
          <ErrorMessage message={userForm.error} />
          <div className={cls(styles.actions)}><SubmitButton busy={userForm.busy}>Add user</SubmitButton></div>
        </Form>
      </section>
      <section className={cls(styles.section)}>
        <h3 className={cls(styles.sectionTitle)}>Model upstream</h3>
        <p className={cls(styles.sectionLead)}>Add a provider endpoint for a bound tenant model.</p>
        <Form ref={upstreamForm.formRef} className={cls(styles.form)} onFormSubmit={values => upstreamForm.submit(values as Values)}>
          <div className={cls(styles.formGrid)}>
            <SelectField name="modelId" label="Model" options={modelOptions.length === 0 ? [{ value: '', label: 'Bind a model first' }] : modelOptions} disabled={modelOptions.length === 0} />
            <TextField name="name" label="Upstream name" required placeholder="openai-primary" />
            <SelectField name="protocol" label="Protocol" options={[{ value: 'chat', label: 'Chat Completions' }, { value: 'responses', label: 'OpenAI Responses' }, { value: 'claude', label: 'Anthropic Messages' }]} />
            <TextField name="baseUrl" label="Base URL" type="url" required placeholder="https://api.openai.com/v1" />
            <TextField name="upstreamModel" label="Upstream model" required placeholder="gpt-4.1" />
            <TextField name="apiKey" label="API key" type="password" placeholder="Leave blank to keep" />
            <TextField name="priority" label="Priority" type="number" defaultValue="0" hint="Lower number runs first." />
            <CheckboxField name="enabled" label="Enabled" defaultChecked />
          </div>
          <ErrorMessage message={upstreamForm.error} />
          <div className={cls(styles.actions)}><SubmitButton busy={upstreamForm.busy}>Add upstream</SubmitButton></div>
        </Form>
      </section>
      <section className={cls(styles.section)}>
        <h3 className={cls(styles.sectionTitle)}>Support access</h3>
        <Form ref={supportForm.formRef} className={cls(styles.form)} onFormSubmit={values => supportForm.submit(values as Values)}>
          <TextField name="reason" label="Support reason" required placeholder="Why do you need temporary access?" />
          <ErrorMessage message={supportForm.error} />
          <div className={cls(styles.actions)}><SubmitButton busy={supportForm.busy}>Request support</SubmitButton></div>
        </Form>
      </section>
    </div>
  )
}

export { valueOf, numberValue }

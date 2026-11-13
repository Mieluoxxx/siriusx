/** Shared Base UI primitives and the single SiriusX admin theme surface. */
import * as React from 'react'
import { Button as BaseButton } from '@base-ui-components/react/button'
import { Checkbox } from '@base-ui-components/react/checkbox'
import { Dialog } from '@base-ui-components/react/dialog'
import { Field } from '@base-ui-components/react/field'
import { Form } from '@base-ui-components/react/form'
import { Input } from '@base-ui-components/react/input'
import { Progress } from '@base-ui-components/react/progress'
import { Select } from '@base-ui-components/react/select'
import { Toast } from '@base-ui-components/react/toast'

export type Values = Record<string, unknown>
export type FormSubmit = (values: Values) => Promise<void> | void
export interface SelectOption { value: string; label: string }

export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ')
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function valueOf(values: Values, key: string): string {
  const value = values[key]
  return value === undefined || value === null ? '' : String(value)
}

export function numberValue(values: Values, key: string): number {
  return Number(valueOf(values, key) || '0')
}

type ButtonVariant = 'default' | 'primary' | 'danger' | 'danger-ghost' | 'ghost' | 'nav'

export function Button({ variant = 'default', className, ...props }: React.ComponentPropsWithoutRef<typeof BaseButton> & { variant?: ButtonVariant }): React.ReactElement {
  return <BaseButton {...props} className={state => cx('btn', `btn-${variant}`, typeof className === 'function' ? className(state) : className)} />
}

export function PageHeader({ title, actions }: { title: string; actions?: React.ReactNode }): React.ReactElement {
  return <div className="page-head"><h1 className="page-title">{title}</h1>{actions === undefined ? null : <div className="page-actions">{actions}</div>}</div>
}

export function Card({ children, className }: { children: React.ReactNode; className?: string }): React.ReactElement {
  return <section className={cx('card', className)}>{children}</section>
}

export function SectionHeading({ title, actions }: { title: string; actions?: React.ReactNode }): React.ReactElement {
  return <div className="section-heading"><h2>{title}</h2>{actions === undefined ? null : <div className="section-actions">{actions}</div>}</div>
}

export function DataTable({ headers, rows, empty = 'No data.', caption, columnClasses }: {
  headers: readonly string[]
  rows: ReadonlyArray<ReadonlyArray<React.ReactNode>>
  empty?: string
  caption?: string
  columnClasses?: ReadonlyArray<string | undefined>
}): React.ReactElement {
  if (rows.length === 0) return <div className="empty">{empty}</div>
  return (
    <div className="table-wrap" role="region" tabIndex={0} aria-label={caption ?? 'Data table'}>
      <table className="data-table">
        {caption === undefined ? null : <caption>{caption}</caption>}
        <thead><tr>{headers.map((header, index) => <th key={header || index} className={columnClasses?.[index]}>{header}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, cellIndex) => <td key={cellIndex} className={columnClasses?.[cellIndex]} data-label={headers[cellIndex] ?? ''}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const STATUS_LABELS: Record<string, string> = { active: 'Active', suspended: 'Suspended' }

export function StatusPill({ status }: { status: string }): React.ReactElement {
  const label = STATUS_LABELS[status] ?? status
  return <span className={cx('pill', status === 'active' ? 'pill-active' : status === 'suspended' ? 'pill-suspended' : '')}>{label}</span>
}

export function TextField({ name, label, className, ...inputProps }: { name: string; label: string; className?: string } & Omit<React.ComponentPropsWithoutRef<typeof Input>, 'name' | 'className'>): React.ReactElement {
  return (
    <Field.Root name={name} className={cx('field', className)}>
      <Field.Label className="field-label">{label}</Field.Label>
      <Input {...inputProps} className="input" />
      <Field.Error className="field-error" />
    </Field.Root>
  )
}

export function SelectField({ name, label, options, value, defaultValue, disabled = false, className, onValueChange }: {
  name: string
  label: string
  options: SelectOption[]
  value?: string
  defaultValue?: string
  disabled?: boolean
  className?: string
  onValueChange?: (value: string) => void
}): React.ReactElement {
  const items = Object.fromEntries(options.map(option => [option.value, option.label]))
  const valueProps = value === undefined
    ? { defaultValue: defaultValue ?? options[0]?.value ?? '' }
    : { value }
  return (
    <Field.Root name={name} className={cx('field', className)}>
      <Field.Label className="field-label">{label}</Field.Label>
      <Select.Root
        name={name}
        items={items}
        disabled={disabled}
        onValueChange={next => onValueChange?.(next === null ? '' : String(next))}
        {...valueProps}
      >
        <Select.Trigger className="select-trigger">
          <Select.Value />
          <Select.Icon className="select-icon" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Positioner className="select-positioner" sideOffset={6}>
            <Select.Popup className="select-popup">
              <Select.List>
                {options.map(option => <Select.Item key={option.value} value={option.value} className="select-item">{option.label}</Select.Item>)}
              </Select.List>
            </Select.Popup>
          </Select.Positioner>
        </Select.Portal>
      </Select.Root>
    </Field.Root>
  )
}

export function CheckboxField({ name, label, defaultChecked = false }: { name: string; label: string; defaultChecked?: boolean }): React.ReactElement {
  return (
    <Field.Root name={name} className="checkbox-field">
      <Checkbox.Root name={name} defaultChecked={defaultChecked} className="checkbox">
        <Checkbox.Indicator className="checkbox-indicator">✓</Checkbox.Indicator>
      </Checkbox.Root>
      <Field.Label className="checkbox-label">{label}</Field.Label>
    </Field.Root>
  )
}

export function SubmitButton({ busy, children = 'Save changes' }: { busy: boolean; children?: React.ReactNode }): React.ReactElement {
  return <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Saving…' : children}</Button>
}

export function FormError({ message }: { message: string }): React.ReactElement | null {
  return message === '' ? null : <p className="form-error" role="alert">{message}</p>
}

export function FormActions({ children, className }: { children: React.ReactNode; className?: string | undefined }): React.ReactElement {
  return <div className={cx('form-actions', className)}>{children}</div>
}

export function useSubmit(onSubmit: FormSubmit, resetOnSuccess = false): {
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

export function BaseForm({ formRef, onSubmit, children, className }: { formRef: React.RefObject<HTMLFormElement | null>; onSubmit: (values: Values) => void; children: React.ReactNode; className?: string }): React.ReactElement {
  return <Form ref={formRef} className={cx('form', className)} onFormSubmit={values => onSubmit(values as Values)}>{children}</Form>
}

export interface DialogShellProps {
  open: boolean
  title: string
  size?: 'sm' | 'md' | 'lg'
  children: React.ReactNode
  onOpenChange: (open: boolean) => void
}

export function DialogShell({ open, title, size = 'md', children, onOpenChange }: DialogShellProps): React.ReactElement {
  const popupRef = React.useRef<HTMLDivElement>(null)
  const bodyRef = React.useRef<HTMLDivElement>(null)
  return (
    <Dialog.Root open={open} onOpenChange={next => onOpenChange(next)}>
      <Dialog.Portal>
        <Dialog.Backdrop className="dialog-backdrop" />
        <Dialog.Popup
          ref={popupRef}
          className={cx('dialog-popup', `dialog-${size}`)}
          initialFocus={interactionType => {
            if (interactionType === 'touch') return popupRef.current
            return bodyRef.current?.querySelector<HTMLElement>('input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])') ?? true
          }}
        >
          <div className="dialog-head">
            <Dialog.Title className="dialog-title">{title}</Dialog.Title>
            <Dialog.Close className="btn btn-ghost dialog-close" aria-label="Close">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </Dialog.Close>
          </div>
          <div ref={bodyRef} className="dialog-body">{children}</div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function ConfirmDialog({ open, title, message, confirmLabel, onConfirm, onCancel }: { open: boolean; title: string; message: string; confirmLabel: string; onConfirm: () => void; onCancel: () => void }): React.ReactElement {
  return (
    <Dialog.Root open={open} onOpenChange={next => { if (!next) onCancel() }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="dialog-backdrop" />
        <Dialog.Popup className="dialog-popup dialog-sm" role="alertdialog">
          <div className="dialog-head"><Dialog.Title className="dialog-title">{title}</Dialog.Title></div>
          <div className="dialog-body">
            <p className="dialog-message">{message}</p>
            <div className="dialog-actions">
              <Button variant="ghost" onClick={onCancel}>Cancel</Button>
              <Button variant="danger" onClick={onConfirm}>{confirmLabel}</Button>
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function ToastHost(): React.ReactElement {
  const { toasts } = Toast.useToastManager()
  return (
    <Toast.Portal>
      <Toast.Viewport className="toast-viewport">
        {toasts.map(toast => (
          <Toast.Root key={toast.id} toast={toast} className="toast">
            <Toast.Title className="toast-title" />
            <Toast.Description className="toast-description" />
            <Toast.Close className="toast-close" aria-label="Dismiss notification">×</Toast.Close>
          </Toast.Root>
        ))}
      </Toast.Viewport>
    </Toast.Portal>
  )
}

export function QuotaProgress({ used, limit, label }: { used: number; limit: number; label: string }): React.ReactElement {
  return (
    <div className="quota-row">
      <div className="quota-meta"><span>{label}</span><strong>{used} / {limit}</strong></div>
      <Progress.Root value={Math.min(used, Math.max(limit, 1))} max={Math.max(limit, 1)} className="progress">
        <Progress.Track className="progress-track"><Progress.Indicator className="progress-indicator" /></Progress.Track>
      </Progress.Root>
    </div>
  )
}

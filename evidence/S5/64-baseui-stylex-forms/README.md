# Base UI + StyleX form migration

All admin-web forms are now React forms built from Base UI primitives:

- Base UI `Form`, `Field`, `Input`, `Select`, `Checkbox`, `Button`
- StyleX for form tokens, field layout, gaps, focus rings, validation and section cards
- Auth, tenant filters, create tenant/model/source, tenant config/quota/billing, add user, model upstream, and support access
- Native HTML validation messages from `Field.Error`
- Server errors stay in the form instead of becoming global toasts
- Vite/esbuild StyleX CSS extraction; CSP allows StyleX/Base UI inline style attributes only for styles
- Playwright verified required-field validation, filtering by search/status, quota save, toast, dialog and mobile reflow with no unexpected console errors

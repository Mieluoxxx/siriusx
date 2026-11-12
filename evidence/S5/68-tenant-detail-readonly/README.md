# Tenant detail is a read-only view

- Tenant detail no longer renders a wall of editable fields.
- Read-only hero: name, tenant ID, status, Edit profile, Suspend/Resume, Close.
- Metric cards: users, devices, cloud tickets, device tickets.
- Read-only panels: tenant profile, quota, billing with dedicated Edit buttons.
- Users / models / upstreams / support / usage / audit stay as tables.
- Add user, add upstream, request support and all edits open focused Base UI dialogs.
- Playwright verified zero editable controls in the detail view, edit dialog opening/closing, and Add user dialog.

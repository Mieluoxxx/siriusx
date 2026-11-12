# Tenant page action layout

- `.page-head > div` was applying `display:grid` to the action group and stacking Back / Edit / Suspend.
- Scoped `.page-head > .detail-actions` back to a horizontal flex row with `width:auto`.
- Added mobile left alignment for the action row.
- Verified tenant page, edit dialog, route reload/back, status filter and mobile overflow.

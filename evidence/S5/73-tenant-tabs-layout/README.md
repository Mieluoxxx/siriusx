# Tenant detail split layout

- Left 300px identity rail: avatar, name, tenant ID, status, IdP issuer, created, actions.
- Right workspace: compact 4-cell KPI strip, section tabs, tab panel.
- Overview tab contains Quota and Billing panels.
- Users, Models, Upstreams, Support, Usage and Audit are separate tab panels.
- Tab state is stored as `?tab=users` and survives reload.
- Tenant page scroll resets to top when opened.
- Mobile collapses the rail above the workspace and uses a horizontally scrollable tab bar.

# Shareable admin page routes

- `/overview`, `/tenants`, `/models`, `/sources`, `/support`, `/audit`
- `/tenants/<tenant-id>` for a tenant detail page
- `pushState` on navigation and tenant open; `popstate` restores the view
- Direct page loads are served by the admin-web SPA fallback
- Tenant detail reload keeps the page and the session token
- Unknown routes return 404 from the admin server
- Status filter select is 250px wide so value, arrow and result count do not overlap

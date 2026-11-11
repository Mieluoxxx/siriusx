# PostgreSQL cutover plan

## Current state

- Control-plane, autobot, tool-gateway and CloudExecutor assignment stores still use `node:sqlite`.
- PostgreSQL schema and offline migration are implemented:
  - `deploy/postgres/schema.sql`
  - `scripts/migrate-sqlite-to-postgres.mjs`
  - `scripts/postgres-preflight.mjs`
- The control-plane runtime is **not yet cut over**.

## Why runtime cutover is a separate project

`DatabaseSync` is synchronous and SQLite-specific SQL is embedded across the
services:

- `PRAGMA table_info`
- `AUTOINCREMENT`
- `INSERT OR IGNORE` / `REPLACE`
- `strftime`
- `VACUUM INTO`
- synchronous transactions and single-writer assumptions

The `pg` client is asynchronous. A cutover therefore requires an async storage
boundary, not just a connection string.

## Phase 2 work

1. [x] Add `packages/storage` with a narrow async interface:
   - `query`
   - `transaction`
   - `migrate`
2. Add `SqliteStorage` wrapper preserving current behavior.
3. Add `PostgresStorage` using `pg`.
4. Migrate control-plane management reads/writes first:
   - [x] platform_audit (runtime via `DATABASE_URL`; SQLite fallback)
   - [x] support_requests (runtime via `DATABASE_URL`; SQLite fallback)
   - [x] tenant_billing (runtime via `DATABASE_URL`; SQLite fallback)
   - [x] tenant/settings mirror on create/update/status
   - [x] users mirror on create/role update
   - [x] model_catalog / tenant_models runtime reads+writes
   - [x] source_bindings / source_events runtime reads+writes
   - [x] tenants/users primary reads via PostgreSQL-backed process cache
   - [x] settings/tenant_quotas primary reads via PostgreSQL-backed process cache
   - [x] periodic cache refresh (default 30s)
   - [x] LISTEN/NOTIFY immediate cache invalidation
   - tenants
   - users
   - quotas
   - billing
   - model catalog/bindings
   - source bindings/events
   - support requests
   - platform audit
5. Make the affected `ControlPlane` methods async and update server routes/tests.
6. [x] Tool-gateway approvals/policies/audit runtime cutover.
7. [x] Autobot PostgreSQL schema + offline migration
8. [ ] Autobot runtime storage cutover
9. Run dual-read/dual-write verification, then a maintenance-window cutover.
10. Keep SQLite as the offline/single-box mode.
7. Run dual-read/dual-write verification, then a maintenance-window cutover.
8. Keep SQLite as the offline/single-box mode.

## Migration rehearsal commands

```bash
psql "$DATABASE_URL" -f deploy/postgres/schema.sql
DATABASE_URL="$DATABASE_URL" node scripts/migrate-sqlite-to-postgres.mjs \
  --sqlite /data/control.sqlite --reset
DATABASE_URL="$DATABASE_URL" node scripts/postgres-preflight.mjs
```

`postgres-preflight.mjs` checks row counts and orphan relationships. It is a
preflight, not proof of runtime cutover.

## Hybrid runtime status (important)

`DATABASE_URL` currently routes only these tables through `PostgresStorage`:

- `platform_audit`
- `support_requests`
- `tenant_billing`

`tenants`, `users`, `settings`, `devices`, quotas, model catalog, source
bindings/events and tickets still use SQLite at runtime.

Tenant/settings/user rows are now mirrored to PostgreSQL during lifecycle
writes, so support/billing foreign keys work for new tenants. Tenant/user primary reads now come from the PostgreSQL-backed process cache when
`initialize()` has run. The cache is process-local and refreshable on a timer (default 30s); immediate cross-replica invalidation uses PostgreSQL
LISTEN/NOTIFY; the timer remains a fallback. Settings/quota reads use the same PostgreSQL-backed cache. Operational
ticket/device reads still use SQLite.

# PostgreSQL management-plane schema

This directory contains the PostgreSQL schema (27 tables), an offline
SQLite → PostgreSQL migration tool, and runtime support.

Runtime services now accept `DATABASE_URL`:

- control-plane
- tool-gateway
- autobot

SQLite remains the default offline/single-box backend. PostgreSQL mode keeps
tenant/user/settings/quota cache state in sync with LISTEN/NOTIFY plus a timer,
and stores autobot tickets/assignments/events/inputs/outbox and tool-gateway
approvals/policies/audit in PostgreSQL.

## Start a rehearsal database

```bash
POSTGRES_PASSWORD=replace-me docker compose -f deploy/postgres/docker-compose.postgres.yml up -d
```

Or apply `deploy/k8s/optional/postgres.yaml` on Kubernetes.

## Apply schema

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f deploy/postgres/schema.sql
```

## Migrate

```bash
DATABASE_URL=postgres://siriusx:...@127.0.0.1:5432/siriusx \
  node scripts/migrate-sqlite-to-postgres.mjs --sqlite /data/control.sqlite --reset
```

`--reset` truncates the target management tables first. Without it, existing
rows can cause constraint errors.

## Verify

```bash
psql "$DATABASE_URL" -c 'select count(*) from tenants;'
psql "$DATABASE_URL" -c 'select count(*) from platform_audit;'
```

## Runtime verification

All three services have real PostgreSQL 18 tests in their package suites. Run
the migration and preflight scripts before pointing production traffic at a
new database, and keep a SQLite backup until cutover is signed off.

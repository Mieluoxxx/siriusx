# PostgreSQL management-plane schema

This is the first cutover stage: a PostgreSQL schema and an offline
SQLite → PostgreSQL migration tool.

The control-plane runtime is still SQLite-backed. Full runtime cutover requires
making the storage layer asynchronous and replacing SQLite-specific SQL
(`PRAGMA`, `INSERT OR IGNORE`, `strftime`, `VACUUM INTO`, synchronous
`DatabaseSync` calls). Until that refactor lands, run this only for a
maintenance-window export, reporting copy, or migration rehearsal.

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

## Runtime cutover gate

Do not point production traffic at PostgreSQL until the control-plane,
autobot and tool-gateway storage adapters have been migrated and tested against
a real PostgreSQL instance. This directory does not claim that cutover.

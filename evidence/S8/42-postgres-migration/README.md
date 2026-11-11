# PostgreSQL management-plane migration stage 1

本轮完成的是 **schema + 离线数据迁移工具**，不是运行时切换：

- `deploy/postgres/schema.sql`：19 张管理/控制面表
- `scripts/migrate-sqlite-to-postgres.mjs`
  - 读取 SQLite
  - 事务写入 PostgreSQL
  - 支持 `--reset` / `--dry-run`
  - 保留 platform_audit id 并修正 sequence
- `deploy/postgres/docker-compose.postgres.yml`
- `deploy/k8s/optional/postgres.yaml`
- `scripts/check-postgres.py`

真实 PostgreSQL 18 本地验证：

- schema apply 成功
- 19 张表迁移
- tenants/users/quota/billing/source_bindings/source_events/support_requests/platform_audit 抽样校验通过
- `postgres schema OK: 19 tables`

**仍需完成**：控制面写入路径的异步存储适配、autobot/tool-gateway 迁移、运行时 cutover 与回滚。

证据：`schema-apply.txt`、`migrate.txt`、`verify.txt`、`schema-check.txt`。

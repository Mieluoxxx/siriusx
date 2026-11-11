# Tenant mirror to PostgreSQL

Stage 2.2d（tenant lifecycle groundwork）：

- `provisionTenant` 改为 async
- 配置 `DATABASE_URL` 时把 tenant + settings 同步写入 Postgres
- `updateTenant` / `setTenantStatus` 同步更新 Postgres
- SQLite 仍是当前主读取来源（hybrid）
- `DATABASE_URL` 下真实 PG 测试通过：32 tests

这解决了 support_requests / tenant_billing 对 tenants 外键的新租户问题。
主读取迁移仍需 Stage 2.2e。
证据：`test.txt`、`typecheck.txt`。

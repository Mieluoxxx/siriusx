# Tenant billing on PostgreSQL

Stage 2.2c：

- `getBilling` / `setBilling` / `billingEstimate` 改为 async
- 配置 `DATABASE_URL` 时走 PostgresStorage
- PostgreSQL upsert：`ON CONFLICT (tenant_id) DO UPDATE`
- 真实 PostgreSQL 18 测试设置/读取 EUR billing
- SQLite 模式保持默认

证据：`test.txt`、`typecheck.txt`、`control-typecheck.txt`。

# Platform audit on PostgreSQL

Stage 2.2（第一张运行时表）：

- `ControlPlaneOptions.storage`
- `recordPlatformAudit` / `listPlatformAudit` 改为 async
- `DATABASE_URL` 存在时 CLI 使用 `PostgresStorage`
- SQLite 模式保持默认
- 真实 PostgreSQL 18 测试写入/读取 platform_audit

证据：`test.txt`、`typecheck.txt`、`cli-typecheck.txt`。

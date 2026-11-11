# Settings and quota on PostgreSQL

Stage 2.2i：

- `initialize()` 加载 settings / tenant_quotas 到进程读模型
- `getSettings` / `getQuota` 使用 PG cache
- `updateSettings` / `setQuota` 改为 async，写 PG 并更新 cache
- `enforceQuota` 继续同步使用 cache
- 真实 PG 测试中删除 SQLite settings/quotas/tenants 后，读取仍正确
- 单副本前提；多副本需要共享失效机制

证据：`test.txt`、`typecheck.txt`。

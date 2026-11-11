# Tool gateway PostgreSQL storage

Stage 3a：

- `@siriusx/storage` 接入 tool-gateway
- 新增 `tg_approvals` / `tg_tenant_tool_policies` / `tg_audit`
- `initialize()` 从 PG 恢复 audit hash 链尾
- approvals / policies / audit 运行时走 PG
- `metrics` / `ready` / audit 查询改为 async
- CLI 支持 `DATABASE_URL`
- 真实 PG 测试：approval → decide → audit chain verify → policy CRUD
- SQLite 模式 18 tests 保持通过

证据：`test.txt`、`typecheck.txt`、`sqlite-test.txt`。

# Support requests on PostgreSQL

Stage 2.2b（第二张运行时表）：

- `createSupportRequest` / `listSupportRequests` / `decideSupportRequest` 改为 async
- 配置 `DATABASE_URL` 时走 `PostgresStorage`
- SQLite 模式保持默认
- 真实 PostgreSQL 18 测试：
  - 插入 tenant mirror（FK）
  - create/list/decide support request
  - 清理数据

证据：`test.txt`、`typecheck.txt`、`control-typecheck.txt`。

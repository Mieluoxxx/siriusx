# Source bindings/events on PostgreSQL

Stage 2.2g：

- `source_bindings` / `source_events` 读写走 Storage
- create/list/find/get/record/mark/list events async
- Webhook 幂等仍保持
- 真实 PostgreSQL 测试创建 binding、记录 event、list、清理
- SQLite 兼容写入保留

证据：`test.txt`、`typecheck.txt`。

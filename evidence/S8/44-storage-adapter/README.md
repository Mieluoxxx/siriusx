# Async storage boundary

Stage 2.1：新增 `@siriusx/storage`。

- `Storage` 异步接口：query / transaction / close
- `SqliteStorage`：包装现有 `node:sqlite` 行为
- `PostgresStorage`：pg Pool，支持 `? → $n` 占位符转换
- 事务回滚测试
- 真实 PostgreSQL 18 跑通 SQLite 和 PostgreSQL 两套测试

证据：`typecheck.txt`、`test.txt`。

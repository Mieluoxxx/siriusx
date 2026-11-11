# Autobot PostgreSQL preflight

`scripts/autobot-postgres-preflight.mjs` 在迁移演练后检查：

- 5 张 autobot 表的行数
- ticket 是否有 assignment
- assignment / event / pending input / outbox 的 orphan
- 真实 PostgreSQL 18 结果：failures: []

证据：`run.txt`。

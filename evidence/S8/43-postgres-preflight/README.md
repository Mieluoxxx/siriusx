# PostgreSQL migration preflight

`scripts/postgres-preflight.mjs` checks:

- all 19 management tables exist and return counts
- tenants have an admin
- no orphan users/devices/cloud tickets/tenant model bindings

真实 PostgreSQL 18 迁移后运行结果：

- counts 全部返回
- failures: []

证据：`run.txt`。

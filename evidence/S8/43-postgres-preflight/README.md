# PostgreSQL migration preflight

`scripts/postgres-preflight.mjs` checks:

- all 19 management tables exist and return counts
- tenants have an admin
- no orphan users/devices/cloud tickets/tenant model bindings

真实 PostgreSQL 18 迁移后运行结果（hybrid runtime 仍只覆盖 platform_audit/support_requests/tenant_billing）：

- counts 全部返回
- failures: []

证据：`run.txt`。

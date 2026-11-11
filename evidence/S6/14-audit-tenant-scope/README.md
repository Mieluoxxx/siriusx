# Tenant-scoped audit queries

- `auditForTicket(ticketId, tenantId?)` 支持按 tenant 过滤；
- tool-gateway `/v1/audit` 强制传入认证 context 的 tenantId；
- 测试构造 tenant-a/tenant-b 相同 ticketId，各只返回自己的 1 条；
- 无 tenant 参数仍可用于内部/测试全量查询。
- 证据：`test.txt`、`typecheck.txt`。

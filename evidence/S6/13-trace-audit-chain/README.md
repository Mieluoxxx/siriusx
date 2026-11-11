# Ticket trace includes audit chain status

- `/v1/tickets/:id/trace` 在合并 ticket/audit/analytics 时，再调用 tool-gateway `/v1/audit/verify`；
- 响应新增 `auditChain`；
- 测试断言 `auditChain.valid=true`。
- 证据：`test.txt`、`typecheck.txt`。

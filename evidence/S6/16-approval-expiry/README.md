# Approval expiry sweep

- `listApprovals(tenantId)` 会先把已超过 `expires_at` 的 pending approval 标记为 expired；
- 列表不再把过期审批显示成可操作 pending；
- 测试使用 10ms TTL，推进时间后列表返回 `expired`。
- 证据：`test.txt`、`typecheck.txt`。

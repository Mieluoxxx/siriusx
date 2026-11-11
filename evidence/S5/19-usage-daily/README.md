# Daily usage trend

新增：

- `ControlPlane.usageDaily(tenantId, days)`
- `GET /v1/usage-daily?days=30`
- `GET /v1/admin/tenants/:id/usage-daily?days=30`

返回按 UTC 日聚合的：

- cloudTickets
- deviceTickets

测试验证 7 天零填充；Platform Admin `/admin` 展示 14 天 usage 表。

证据：`test.txt`、`typecheck.txt`、`ui-typecheck.txt`、`../15-platform-admin-ui/admin.png`。

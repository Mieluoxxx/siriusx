# Tenant audit CSV export

- tool-gateway `GET /v1/audit/export?format=csv`
- 仅 admin
- control-plane 代理 `/v1/audit/export`
- Team Admin 增加 `Export CSV` 按钮
- 测试验证 content-type=text/csv、包含 `approved:human`
- 浏览器验证 Export CSV 按钮存在，console errors 为空

证据：`test.txt`、`typecheck.txt`、`proxy-typecheck.txt`、`ui-typecheck.txt`、`../18-tool-policy-ui/policy.png`。

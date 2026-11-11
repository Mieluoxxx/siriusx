# Platform audit CSV export

- `GET /v1/admin/audit/export?format=csv`
- 仅 platform admin token
- 导出 platform_audit：id / actor / action / target / detail / createdAt
- `/admin` 增加 Export CSV 按钮

浏览器验证 Export CSV 可见，console errors 为空。
证据：`typecheck.txt`、`../15-platform-admin-ui/admin.png`。

# Tenant suspend / resume

- `tenants.status`：active / suspended
- `POST /v1/admin/tenants/:id/status`
- suspended tenant：
  - 现有 session 访问返回 `TENANT_SUSPENDED`
  - 新 session 无法签发
- `/admin` 租户列表显示状态并支持 Suspend/Resume
- Platform audit 记录 `tenant.status`

浏览器实测：Suspend 后显示 suspended，再 Resume 恢复。
证据：`test.txt`、`typecheck.txt`、`ui-typecheck.txt`、`../15-platform-admin-ui/admin.png`。

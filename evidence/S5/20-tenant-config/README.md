# Tenant SSO/config editing

- `ControlPlane.updateTenant(tenantId, {name, idpIssuer})`
- `PUT /v1/admin/tenants/:id`
- 平台操作记录 `tenant.update` 到 Platform audit
- `/admin` 租户用户页新增 Tenant config 表单

浏览器实测：把 `Platform Tenant` 改为 `Platform Tenant 2` 并保存，页面刷新后读取到新名称。
证据：`typecheck.txt`、`ui-typecheck.txt`、`../15-platform-admin-ui/admin.png`。

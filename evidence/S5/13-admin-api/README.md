# Management plane API

新增 platform admin API：

- `GET /v1/admin/tenants`
- `POST /v1/admin/tenants`
- `GET /v1/admin/tenants/:id/users`
- `POST /v1/admin/tenants/:id/users`
- `PUT /v1/admin/tenants/:id/users/:userId/role`

认证：`X-SiriusX-Platform-Token`，对应 `SIRIUSX_PLATFORM_ADMIN_TOKEN`。

新增 tenant admin API：

- `GET /v1/users`
- `POST /v1/users`
- `PUT /v1/users/:id/role`

仅 admin session 可调用。

测试覆盖未认证 401、创建租户、添加用户、租户用户列表、角色更新。
证据：`test.txt`、`typecheck.txt`。

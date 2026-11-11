# Tenant quota enforcement

新增 `tenant_quotas`：

- maxUsers
- maxDevices
- maxCloudTicketsPerDay
- maxDeviceTicketsPerDay

默认：

- users 50
- devices 20
- cloud tickets/day 100
- device tickets/day 500

平台 API：

- `GET /v1/admin/tenants/:id/quota`
- `PUT /v1/admin/tenants/:id/quota`

执行点：

- `addUser`
- `startPairing`
- `createDeviceTicket`
- `createCloudTicket`

超限返回 `429 QUOTA_EXCEEDED`。

测试覆盖 user/device/device-ticket/cloud-ticket quota；Platform Admin `/admin` 增加 quota 编辑和浏览器实测。

证据：`test.txt`、`typecheck.txt`、`ui-typecheck.txt`、`../15-platform-admin-ui/admin.png`。

# Platform admin UI

Control Plane 新增独立 `/admin` 页面：

- Platform token 只保存在 sessionStorage；
- 创建租户；
- 租户列表；
- 每租户 usage：users / devices / device tickets / cloud tickets；
- 查看/新增租户用户。

浏览器实测：

- 创建 `tenant-platform`
- 页面显示 Platform Tenant 与 usage 计数
- 新增 `member@platform.example`
- 新增 Model UI，保存租户 quota，展示 14 天 usage，编辑 tenant name/issuer、Suspend/Resume，绑定模型，Platform audit 显示 tenant.create
- console errors 为空

CSP：

- `default-src 'none'`
- `script-src 'unsafe-inline'`
- `connect-src 'self'`
- `frame-ancestors 'none'`

证据：`run.txt`、`admin.png`。

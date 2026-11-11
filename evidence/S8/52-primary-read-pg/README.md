# Tenant/user primary read migration

Stage 2.2h：

- `ControlPlane.initialize()` 从 PostgreSQL 加载 tenants/users 到进程内读模型
- storage 模式下 `listTenants` / `findTenantByIssuer` / `listUsers` / `findUserByEmail` / `issueSession` / `verifySession` 使用 PG 缓存
- `provisionTenant` / `addUser` / `updateUserRole` / `updateTenant` / `setTenantStatus` 更新缓存
- 真实 PG 测试中删除 SQLite tenants/users 后，登录、角色校验、租户列表、suspend 仍可用
- 当前 control-plane 单副本，因此进程内读模型是可接受的；多副本前需要共享失效机制

证据：`test.txt`、`typecheck.txt`。

# User mirror to PostgreSQL

Stage 2.2d 继续：

- tenant 创建时 admin user 镜像到 Postgres
- `addUser` 改为 async，写入 Postgres
- `updateUserRole` 改为 async，更新 Postgres
- `ssoSession` 改为 async
- 真实 PostgreSQL 测试覆盖用户创建与角色更新
- SQLite 仍是用户主读取来源（hybrid）

证据：`test.txt`、`typecheck.txt`。

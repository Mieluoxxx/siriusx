# Agent 进程凭据隔离

- ToolGateway 持有 `CONNECTOR_SECRET_9c1e`；
- 执行 `github:read_issue`，connector 确实看到凭据；
- Docker sandbox 内 `env` 的 7 行中没有该 secret；
- audit JSON 中也没有 secret。
- 证据：`run.txt`。

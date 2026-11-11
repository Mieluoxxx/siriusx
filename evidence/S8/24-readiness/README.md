# Service readiness endpoints

- control-plane `/ready`：执行 SQLite `SELECT 1`，返回 `checks.database=ok`
- tool-gateway `/ready`：同样检查 SQLite
- web-gateway `/ready`：探测 control-plane `/health` 与 dsh-web 根路径
- dsh-web 不可达时 web-gateway 返回 503，`checks.dshWeb=false`
- 证据：`run.txt`。

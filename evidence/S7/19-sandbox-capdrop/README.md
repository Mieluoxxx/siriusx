# Sandbox capability hardening

新增 Docker sandbox 参数：

- `--cap-drop ALL`
- `--security-opt no-new-privileges`

验证：

- sandbox-hardening integration：CapDrop=`["ALL"]`、SecurityOpt 包含 `no-new-privileges`，资源限制仍生效；
- 真实 DSH ACP 在加固后的 sandbox 中仍成功返回 ready。

补充：`--tmpfs /tmp`（即使 exec）会破坏当前 DSH/opencode 运行，因此没有保留该参数；
后续如需临时目录隔离，需要单独验证。

证据：`test.txt`、`real-dsh.txt`、`typecheck.txt`。

# Health metadata

- control-plane/tool-gateway/web-gateway 的 `/health` 现在返回：
  - `version`（`SIRIUSX_VERSION`，默认 `dev`）
  - `commit`（`SIRIUSX_COMMIT`，默认 `dev`）
- 三个服务同一构建版本可被直接核对。
- 证据：`run.txt`。

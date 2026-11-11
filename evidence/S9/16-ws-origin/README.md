# WebSocket Origin 校验

- Web Gateway 的 HTTP upgrade 现在校验 `Origin`；
- 与 gateway 同源才允许；
- 跨源 WebSocket 升级返回 403；
- 登录后带合法 cookie、恶意 Origin 的 WS 请求被拒绝。
- 证据：`run.txt`、`typecheck.txt`。

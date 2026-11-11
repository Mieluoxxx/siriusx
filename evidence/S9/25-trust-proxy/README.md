# Trusted proxy client IP for login throttling

- Web Gateway 新增 `trustProxy`（`SIRIUSX_WEB_TRUST_PROXY=1`）；
- 开启后，登录限流使用 `X-Forwarded-For` 第一跳作为客户端 key；
- 未开启时仍使用 socket.remoteAddress，避免默认信任可伪造头；
- 测试：同一 forwarded IP 5 次 401 后 429；另一个 forwarded IP 仍 401。
- 证据：`run.txt`、`typecheck.txt`。

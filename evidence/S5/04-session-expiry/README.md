# Control-plane session expiry

- Control-plane issued tokens now include `exp`；
- `sessionTtlMs` 默认 12 小时；
- verify 时过期返回 `SESSION_EXPIRED`。
- 测试：TTL 1000ms，过期后 verify 抛错。
- 证据：`test.txt`、`typecheck.txt`。

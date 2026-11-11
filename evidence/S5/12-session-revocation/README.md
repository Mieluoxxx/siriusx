# Server-side session revocation

- session token 增加 `jti`；
- `revokeSession(token)` 写入 `revoked_sessions`；
- `verifySession` 对已撤销 jti 返回 `SESSION_REVOKED`；
- web-gateway `/auth/logout` 调用 control-plane `/v1/sessions/revoke` 后再清 cookie。
- 浏览器/HTTP 验证：login 204 → logout 302 → 原 token `/v1/me` 返回 `SESSION_REVOKED`。
- 证据：`run.txt`、`test.txt`、`typecheck.txt`。

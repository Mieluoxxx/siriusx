# HSTS on secure web gateway responses

- TLS 或 `X-Forwarded-Proto: https` 时，登录页与成功登录响应返回：
  - `Strict-Transport-Security: max-age=31536000`
- 普通 HTTP 不返回 HSTS。
- 证据：`run.txt`、`typecheck.txt`。

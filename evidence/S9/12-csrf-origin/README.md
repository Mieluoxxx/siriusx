# Web Gateway CSRF / security headers

- 跨源 `POST /auth/session` 被拒绝：403；
- 同源与无 Origin 的请求：204；
- `/login` 返回：
  - `x-content-type-options: nosniff`
  - `x-frame-options: DENY`
  - `referrer-policy: no-referrer`
- 证据：`run.txt`、`typecheck.txt`。

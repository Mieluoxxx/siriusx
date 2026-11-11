# Login CSP

`/login` 响应新增：

- `Content-Security-Policy`：
  - `default-src 'none'`
  - `script-src 'unsafe-inline'`
  - `style-src 'unsafe-inline'`
  - `form-action 'self'`
  - `frame-ancestors 'none'`
  - `base-uri 'none'`
- 保留 `X-Frame-Options: DENY`
- 保留 `X-Content-Type-Options: nosniff`

证据：`run.txt`、`typecheck.txt`。

# Forwarded HTTPS Origin validation

Web Gateway 的 HTTP/WS Origin 校验现在理解反向代理头：

- `X-Forwarded-Proto`
- `X-Forwarded-Host`

在 HTTPS 反向代理后：

- `Origin: https://app.example`
- `X-Forwarded-Proto: https`
- `X-Forwarded-Host: app.example`

不会被误判为 cross-origin。

测试中 login 与 WS 都从 403 变为预期业务错误 401，证明 Origin 校验通过。
证据：`run.txt`、`typecheck.txt`。

# Web Gateway cookie hardening

- 当 `X-Forwarded-Proto: https` 时，session cookie 带 `Secure`；
- logout 清除 cookie 也带 `Secure`；
- OIDC pending state 在 start 时清理超过 10 分钟的条目，最多 1000 个。
- 证据：`run.txt`、`typecheck.txt`。

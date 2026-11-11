# Web Gateway login rate limit

- 同一客户端 5 次 `/auth/session` 失败后，5 分钟窗口内返回 429；
- 成功登录会清除失败计数；
- 测试：前 5 次 401，第 6 次 429。
- 证据：`run.txt`、`typecheck.txt`。

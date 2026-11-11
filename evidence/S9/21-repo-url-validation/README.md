# Cloud repo URL validation

- cloud project 创建/follow-up 前校验 repo URL：
  - 只允许 `http:` / `https:`；
  - 拒绝 URL 内嵌用户名/密码；
  - 拒绝无效 URL。
- 测试覆盖 `file:///etc/passwd` 与 `https://user:pass@...`。
- 证据：`test.txt`、`typecheck.txt`。

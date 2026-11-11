# Device token rotation

- `POST /v1/devices/:id/rotate-token`：
  - admin 或 device owner 可调用；
  - 生成新 token；
  - 旧 token 立即失效；
  - gateway 关闭该设备现有长连接。
- 测试验证旧 token 401，新 token 可认证。
- 证据：`test.txt`、`typecheck.txt`。

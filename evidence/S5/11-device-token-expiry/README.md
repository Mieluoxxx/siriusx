# Device token expiry

- device token 配对/轮换后 30 天过期；
- 过期 token 返回 `DEVICE_UNAUTHORIZED: device token expired`；
- `rotateDeviceToken` 返回新的 `expiresAt`；
- Devices UI 展示 token 过期时间；
- 测试使用可控时钟推进 31 天验证过期，再轮换恢复。
- 证据：`test.txt`、`typecheck.txt`、`ui-build.txt`。

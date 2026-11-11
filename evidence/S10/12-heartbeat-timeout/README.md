# Device heartbeat timeout

- Device Gateway 增加 `heartbeatTimeoutMs`，默认 90s；
- 每 timeout/2 扫描连接；
- 超过 timeout 未收到任何消息的连接以 close code 4002 关闭；
- 测试使用 60ms timeout，未发送心跳的连接收到 4002。
- 证据：`test.txt`、`typecheck.txt`。

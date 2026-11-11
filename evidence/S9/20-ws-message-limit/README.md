# Device WebSocket message limit

- Device Gateway `WebSocketServer` 设置 `maxPayload: 1 MiB`；
- 超限帧由 ws 以 close code 1009 关闭；
- 增加 socket `error` 处理，避免超限产生 unhandled error；
- 测试发送 2 MiB 帧，断言 close code 1009。
- 证据：`test.txt`、`typecheck.txt`。

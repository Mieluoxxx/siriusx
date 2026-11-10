# 设备离线宽限期

- DeviceGateway 断开连接后，control-plane 启动 `deviceOfflineLostMs` 定时器（默认 15 分钟）；
- 同一设备在宽限期内重连会清除定时器；
- 超过宽限期且仍未连接时，`markDeviceOffline` 把 delivered-but-unreported 的 assignment 标为 `lost`；
- 测试用 100ms 宽限期验证 `running → lost`，ticket 阶段变为 `idle`。
- 证据：`test.txt`、`typecheck.txt`。
- 仍缺：宽限期内重连后的任务续跑/对账测试。

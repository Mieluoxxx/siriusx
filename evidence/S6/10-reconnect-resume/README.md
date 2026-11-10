# 设备宽限期内重连恢复

- control-plane 在 device 重连时补发 `recoverableDeviceAssignments`（已 delivered 但仍为 preparing/running/backgrounded）；
- 设备代理重连后重新执行同一 assignment，事件继续进入同一 ticket；
- 测试：慢任务断开后 1s 内以新 agent 重连，ticket 最终到 `person/review`、assignment `reported`；
- 超过宽限期则沿用 `09-offline-timeout` 的 lost 结算。
- 证据：`test.txt`、`typecheck.txt`。

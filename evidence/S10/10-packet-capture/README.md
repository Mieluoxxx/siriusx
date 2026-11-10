# Device WebSocket 帧级抓包

- 在 device-agent 与 device-gateway 之间插入透明 WebSocket 代理；
- 捕获所有 agent → gateway 的 WebSocket frame；
- 测试使用包含 `LOCAL_SECRET_CODE_42` 的本地仓库和 fake kernel 输出；
- 5 个上行 frame 中不含该 secret，control-plane 事件轨迹也不含；
- 工单正常到 `person/review`。

证据：`run.txt`。这是应用层帧级抓包，不是主机 tcpdump。

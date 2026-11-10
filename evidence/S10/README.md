# S10 证据：手机端评估

## 结论

响应式 Web 的第一版可用：在 390×844 viewport（Chromium mobile emulation）下，
Team panel 自动变为单列，工单列表、详情、diff 和事件流均可滚动查看，且能发起工单。

证据：`mobile-team-panel.png`、`mobile-run.txt`。

## 已补的服务端能力

- `POST /v1/devices/:id/tickets`：创建 `local_dir` 工单并把 `ticket.assign` 下发到该设备的长连接；
- 无 device gateway 时返回 503，设备离线时 `delivered=false`；
- 测试：`device-assign-test.txt`。

## 未完成

- iOS/Android 真机验证；
- 手机审批卡片真实操作（当前 approvals 仍是占位）；
- 手机选择已配对电脑/本地目录并发起 `local_dir` 任务：**服务端下发已完成，设备端执行器未实现**；
- 电脑离线 → `person/delivery` → 上线重试；
- 手机端云端抓包（只允许状态/摘要）。

因此当前结论是「先做响应式 Web」，原生端暂不启动。

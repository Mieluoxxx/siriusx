# S10 证据：手机端评估

## 结论

响应式 Web 的第一版可用：在 390×844 viewport（Chromium mobile emulation）下，
Team panel 自动变为单列，工单列表、详情、diff 和事件流均可滚动查看，且能发起工单。

证据：`mobile-team-panel.png`、`mobile-run.txt`。

## 手机审批（浏览器仿真）

在 390×844 viewport 下打开 approvals 页，批准一张 pending 卡后，UI 与 tool-gateway
状态都变为 `approved`。证据：`mobile-approval.png`、`mobile-approval-run.txt`。

## 已补的服务端能力

- `POST /v1/devices/:id/tickets`：创建 `local_dir` 工单并把 `ticket.assign` 下发到该设备的长连接；
- 无 device gateway 时返回 503，设备离线时 `delivered=false`；
- 测试：`device-assign-test.txt`。

## 已完成的端到端远程本地任务

- `apps/device-agent`：以配对 token 连接 control-plane WebSocket，接收 `ticket.assign`，
  在本地 `local_dir` 执行，并把生命周期/报告事件上行；日志原文不上行。
- control-plane 设备工单：离线时保持 `person/delivery`，设备上线后自动补发同一个 assignment。
- 设备工单支持 follow-up（新 assignment）与 Stop（网关 `ticket.cancel`）；事件使用 ticket 全局序号，不覆盖旧轨迹；设备代理只发尚未发送的事件，避免重复状态。
- 手机 viewport 下的 Team panel 已实际点击 follow-up Send，事件从 seq0-3 增长到 seq4-7。
- Team panel 在控制面模式下列出已配对设备，手机 viewport 可选设备、填本地目录并派工。
- 证据：`05-device-ui/run.txt`、`device-task.png`、`device-agent-test.txt`、`offline-retry-test.txt`、`06-device-followup/`。

## 未完成

- iOS/Android 真机验证；
- 手机审批卡片与电脑上等待任务的联动（卡已可批准，工具 connector 已执行，尚未接真实等待任务）；
- 手机选择已配对电脑/本地目录并发起 `local_dir` 任务：**已通过浏览器仿真端到端验证**；真机未验；
- 电脑离线 → `person/delivery` → 上线自动补发已通过设备代理测试；
- follow-up 与 cancel 已通过设备代理测试；follow-up Send 与 Stop 均通过 Team panel 真实 UI 验证。
- 手机端云端抓包（只允许状态/摘要）。

因此当前结论是「先做响应式 Web」，原生端暂不启动。

## 审批唤醒等待任务

- ToolGateway 决策后支持 `onApprovalDecided` 回调；
- control-plane `POST /v1/approvals/callback` 使用内部 service token 接收；
- 回调按 `ticketId` 向 BotService 注入审批结果 follow-up，触发 `resume` assignment；
- 测试：一个 waiting report 的工单在审批后出现 `start → resume` 两个 assignment，且都到 reported。
- 证据：`07-approval-resume/run.txt`。

仍缺：真实手机 UI 审批与真实等待中 agent 的同一条链路联调。

## 手机审批唤醒等待任务（浏览器仿真）

- control-plane 以 `SIRIUSX_BOT_SCENARIO=waiting` 创建一条等待工单；
- tool-gateway 产生与 ticketId 绑定的审批卡；
- 390×844 手机 viewport 经 web-gateway 打开 approvals，点击 Approve；
- tool-gateway callback 唤醒工单，数据库出现 `start → resume` 两个 assignment。
- 证据：`08-mobile-approval-resume/run.txt`、`mobile-approval-resume.png`。

仍缺：真实 iOS/Android 真机与真实等待中 agent 的同链路联调。

## 设备上行脱敏

- device agent 只上行 state/report/activity/turn 边界/permission，不上行 assistant.delta、assistant.message、tool.*、log；
- 测试用包含 `LOCAL_SECRET_CODE_42` 的本地仓库和 fake kernel 输出，control-plane 事件轨迹中不含该内容；
- 工单仍正常到 `person/review`。
- 证据：`09-uplink-redaction/test.txt`。

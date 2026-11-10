# S4 证据：工单界面插件

## 产出

- `packages/app-contract`：Bot ⇄ 应用类型（Bot、Ticket、Approval、请求/响应）。
- `plugins/client-ui-team`：DSH client plugin，挂在侧栏与 `main` 槽位。
  - Bot 列表
  - 工单列表与七阶段（`person/*` 置顶）
  - 工单详情、报告、`diffStats`、事件流
  - 补充输入 / Stop
  - 审批卡片页占位（S6 接真实审批 API）
- `apps/autobot/src/server.ts`：本地 Bot API + CORS，供 UI 插件读取。
- `pnpm --filter @siriusx/autobot autobot serve --port 4319`。

## 验证

真实 DSH Web Host + Chromium：

1. 安装 `@siriusx/dsh-client-ui-team` 到 `s4web` profile；
2. 启动本地 Bot API 与 DSH Web Host；
3. Playwright 打开 UI，点击 Team；
4. 通过 UI 表单填写仓库路径与任务，点击 Dispatch；
5. UI 显示 `person/review`、报告摘要、`diffStats` 和事件流；
6. 截图：`01-team-panel/team-panel-ticket.png`。

输出见 `01-team-panel/run.txt`：

```text
panel=1
1 bot · 1 ticket
person/review ... filesChanged=1 insertions=1 deletions=0
errors=[]
```

## 验收对照

| 验收项 | 状态 |
| --- | --- |
| 不碰命令行，在 DSH 内发起任务、看阶段、查看 diff | **通过** |
| 需要人处理的工单置顶 | **已实现排序**（UI 按 `person/*` 优先） |
| 界面插件不改 `apps/desktop` 之外的上游文件 | **通过**（插件全在 `plugins/`） |
| Bot 服务断开时不显示过期数据 | **已实现**：刷新失败清空列表并显示连接错误 |
| 打断 / 审批卡片完整操作 | **通过**：审批卡片在 Web UI 中批准（`02-approvals/`）；慢任务通过 Team panel 的 Stop 打断，工单变 idle/cancelled（`03-interrupt/`） |
| 连续 10 个工作日真实使用 | **未完成**：需要真实时间与真实任务 |

## 已知边界

- 目前是一个合并的 Team panel，而不是四个独立客户端 package；后续可按 Bot/工单/审批/Source 拆开。
- Bot API 仍使用确定性 fake kernel；真实 DSH Host Executor 插件已在 S3 验证，S5 把两者合成企业链路。
- 审批页已接 control-plane `/v1/approvals` 代理与 tool-gateway；真实审批审计见 S6 证据。
- 设备任务与 Stop：`evidence/S4/03-interrupt/run.txt`、`interrupt.png`。

## 四个独立 UI 插件

新增四个独立 client package，共享 `@siriusx/client-ui-team-core`：

- `@siriusx/dsh-client-ui-bots`
- `@siriusx/dsh-client-ui-tickets`
- `@siriusx/dsh-client-ui-sessions`
- `@siriusx/dsh-client-ui-approvals`

真实 DSH Web Host 同时加载四个插件，侧栏出现 Bots / Tickets / Sessions / Approvals；
点击 Approvals 打开对应 tab，控制台无错误。旧聚合 Team panel 保留兼容。

证据：`03-four-panels/run.txt`、`four-panels.png`。

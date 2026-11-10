# S9 证据：Web 端

## 结论：DSH `web` profile 可以复用桌面工单插件

- 真实 DSH Web Host 加载同一份 `@siriusx/dsh-client-ui-team` 插件；
- 浏览器打开后侧栏出现 Team，能发起工单、看七阶段、看报告与 `diffStats`；
- 与 S4 桌面窗口使用同一套客户端 bundle 与应用契约。

证据：

- `evidence/S4/01-team-panel/team-panel-ticket.png`（桌面 viewport）
- `evidence/S10/mobile-team-panel.png`（手机 viewport）
- `mobile-buttons.txt`（Web DOM 中 Team 入口与 ARIA）

## 未完成

- 浏览器 SSO 登录后把控制面 token 注入 Team panel；
- 未登录访问预览地址的 401；
- 两租户 Web 并排验证；
- 云端 `cloud_project` 任务发起（当前 Team panel 仍连本地 Bot API）；
- 带鉴权的预览反向代理；
- 关闭标签页后任务继续（Bot 侧可继续，但 Web 端未做任务恢复 UI）。

## 控制面 token 接入（最小可用）

Team panel 现在支持 `localStorage.siriusx.controlToken` 与 `siriusx.controlApi`：
- 有 token 时所有请求走 control-plane `/v1` 并带 `Authorization: Bearer`；
- 无 token 时仍走本地 Bot API。

真实 Chromium 验证：

- Acme token：创建工单、读回详情/事件，网络请求全部为 `127.0.0.1:4320/v1/...`；
- Beta token：同一 Web Host 下 `0 bot · 0 ticket`，看不到 Acme 工单；
- 截图：`01-control-plane/acme-ticket.png`、`01-control-plane/beta-empty.png`；
- 输出：`01-control-plane/run.txt`。

这证明 Web UI 可以按租户隔离，但 token 仍是开发期 localStorage 注入；正式入口必须由
带鉴权的反向代理/SSO 设置 HttpOnly 会话，不能把 token 放在 URL 或持久化到可读 JS 存储。

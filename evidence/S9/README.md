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

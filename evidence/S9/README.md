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

- 浏览器 SSO 登录后把控制面 token 注入 Team panel：**已由 web-gateway HttpOnly cookie + 同源 `/v1` 代理完成**；审批卡也已通过 Gateway 验证；
- 未登录访问预览地址的 401：**通过**，重定向 `/login`，`/v1` 返回 401；
- 两租户 Web 并排验证：**通过**，Acme 1 ticket / Beta 0 ticket；
- 云端 `cloud_project` 任务发起（当前 Team panel 仍连本地 Bot API）；
- 带鉴权的预览反向代理：**最小版通过**（web-gateway）；
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

## 鉴权 Web Gateway

`apps/web-gateway` 提供同源入口：

- `POST /auth/session`：校验 control-plane session，写 HttpOnly `siriusx_session` cookie；
- `/v1/*`：把 cookie 换成 Bearer 后代理到 control-plane；
- 其他路径：代理到 DSH Web Host，并在服务端附加 Host 的 authority-bound cookie；
- 未登录访问 `/` → `/login`；未登录 `/v1/*` → 401；
- Team panel 使用同源相对路径，不再把 token 放进可读 localStorage；
- Web 模式隐藏原生 New Session、发送、工作区与本地目录输入框；
- Team panel 保留工单列表、详情与审批。

验证：

- 未登录访问 → `/login`；
- Acme cookie：Team panel 显示 `1 ticket`；
- Beta cookie：同一 Web Host 下 `0 ticket`；
- 浏览器无控制台错误；
- `nativeNewSessionVisible=false`、`localPathVisible=false`。
- 证据：`02-gateway/run.txt`、`02-gateway/gateway.png`。

## Web Gateway 审批

- Web Gateway 同源代理 `/v1/approvals` 到 control-plane，再转发 tool-gateway；
- 浏览器 cookie 登录后，Team panel 看到真实审批卡；
- 点击 Approve 后，tool-gateway 状态变为 `approved`；
- 证据：`03-gateway-approval/run.txt`、`gateway-approval.png`。

## 云端项目（Docker + ACP）

- Web 模式表单改为云端项目：仓库 URL / baseRef / prompt；
- control-plane 调用 `CloudExecutor`，Docker 沙箱内启动 fake ACP agent；
- 工单阶段从 `working/queued` → `person/review`，报告含 `diffStats` 和 `diffBasis=baseRef`；
- 浏览器通过 web-gateway HttpOnly 会话发起，控制台无错误。
- 证据：`04-cloud-project/run.txt`、`cloud-project.png`、`direct-api-detail.json`。

注意：ACP agent 仍是 fake agent，用于验证云执行/UI 链路；真实仓库 clone 与 dsh/pi 镜像待接。

## 云端项目打断（Web UI）

- 云端任务配置 `SIRIUSX_CLOUD_START_DELAY_MS` 保持 sandbox 运行；
- Web UI 点击 Stop 后，control-plane 调用 CloudExecutor.cancelAssignment；
- 工单从 `working/queued` → `idle/cancelled`；
- 无控制台错误。
- 证据：`05-cloud-interrupt/run.txt`、`cloud-interrupt.png`。

## 浏览器 OIDC 登录

- `apps/web-gateway` 新增授权码 + PKCE + state/nonce 流程；
- 校验 ID token 的 issuer/audience/nonce；
- 通过 control-plane 的服务令牌端点换取租户用户 session，写入 HttpOnly cookie；
- 本地 discovery/authorize/token IdP 实测：start 302 → callback 302 → `/v1/me` 200。
- 证据：`06-oidc/run.txt`。

仍缺：真实企业 IdP 配置与 RS256/JWKS 凭证。

# S0 Spike 结论与施工图

> 状态：完成。
>
> 基线：`deepseek-harness` @ `fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159`
> （`dsh-v0.2.2-rc.1-811-gfcc0ad4621`，2026-11-10）。
> 环境：Node.js `v24.22.2`、pnpm `11.28.5`。上游 `pnpm run typecheck`
> 5/5 通过，`pnpm run build:artifacts` 8/8 通过。
>
> 本文所有源码行号都以该提交为准；上游升级后需重新核对。

## 1. 结论摘要

| # | 前提 | 结论 | 信心 | 证据 |
| --- | --- | --- | --- | --- |
| 1 | Host 的认证能否以插件方式替换成 SSO | **应用层认证：能，且已验证。** 替换 `deepseek-account` 服务即可让 Desktop 的登录/欢迎流程使用我们的 SSO provider。**传输层认证：不能直接换。** `client-connection` 的 launch-token Cookie 由包内部构造，没有配置缝；但产品不需要把它改成 SSO。 | 高 | `evidence/S0/01-auth/`、`evidence/S0/run-auth-tenant-executor.txt` |
| 2 | 租户上下文怎么进入 Host | **推荐由 Host 内的 SSO provider 产生，不经过 Electron session 或 Web Cookie。** provider 在 OIDC 回调里解析 tenant/subject，提供 Host 单例服务 `siriusxTenant`；Host 扩展与 Executor 注入该服务。已验证字段从初始值切换到 SSO 回调携带的新值。 | 高 | `evidence/S0/02-tenant/`、`evidence/S0/run-auth-tenant-executor.txt` |
| 3 | Executor 插件与界面前端能否在同一个 Host 里并存 | **能。** Web UI 与 Executor 形态插件在同一进程、同一 Cordis Context 中运行；插件能拿到 `agents` 与 `sessionController`，并跑完真实 Agent 轮次。同一会话的两个调用方拿到同一个 live Agent，输入都进入 durable inbox。第二个独立 `resume()` 会被拒绝。 | 高 | `evidence/S0/03-coexist/`、`ui-open.png` |
| 4 | dsh-TUI 的 AgentBackend 与 DSH 后端能否干净拆出 | **接口能，DSH 后端不能。** `src/agent` 加两个 port 类型共 12 个文件、3,240 行、零外部包依赖，空包严格类型检查通过。DSH 后端传递闭包是 237 个本地文件、54 个外部 specifier，拖入 Ink/React/UI 层，且原样类型检查失败。上游还明确把 DSH 当作特例：它不是 `AgentBackend`。 | 高 | `evidence/S0/04-agent-interface/` |

**对原计划的影响：**

- 不需要为了 SSO 修改 `packages/client/connection` 或 `apps/desktop-host`，fork 仍只改 `apps/desktop`。
- 原计划“把 dsh-TUI 的 DSH 后端拷进本仓”不成立。S2 应改为：
  1. 只拷入并裁剪 Agent Domain 接口；
  2. DSH 适配器按 DSH 公共 `Agent` API 自研；
  3. dsh-TUI 的 translator 只作为映射参考，不作为代码依赖。
- 建议在 roadmap #57 增加一条修订，明确上述边界。

---

## 2. 问题 1：Host 认证与 SSO

### 2.1 两个不同的“认证”

| 层 | 现状 | 能否插件替换 | 产品上要不要替换 |
| --- | --- | --- | --- |
| **应用登录**：欢迎页、账号状态、模型令牌、租户身份 | `deepseekAccount` 服务 | **能**。它就是 Cordis service seam，`account-controller` 只注入这个服务。 | **要**。这是企业 SSO 的入口。 |
| **本地 Host 传输**：`/api`、WebSocket、静态页 | 每次进程启动随机 launch token，换成本地签名 Cookie | **不能通过配置替换。** `BrowserAuth` 在 `client-connection` 内部 `new` 出来，`ConnectionConfig` 没有 provider 字段；除非重写整个 `dsh-client-connection` 包。 | **不要**。它是“本机页面访问本机 Host”的传输凭据，不是员工身份。 |

源码位置：

- `packages/client/connection/src/index.ts:126-140`：`BrowserAuth.create(...)` 在 `apply()` 内直接构造。
- `packages/client/connection/src/index.ts:96-117`：`ConnectionConfig` 只有 `recovery`、`trustedHosts`、`cookieMaxAgeDays`、`maxRequestBodyBytes`，没有认证提供方。
- `packages/client/connection/src/rpc-host.ts:128-137`：所有通过浏览器 Cookie 的请求共享同一个 `{ kind: 'owner' }` Peer。
- `packages/bundle/base/cordis.patch.yml:120-123`：`deepseek-account` 是独立的插件行，默认值为 `@deepseek-ai/dsh-deepseek-account-platform`。
- `packages/api/account-controller/src/index.ts:10-19`：controller 注入 `deepseekAccount`，所有登录/登出操作转发给它。
- `apps/desktop/src/main.ts:1428-1441`：Desktop 根据账号状态决定是否进入 Workspace。

### 2.2 不能直接改 row 的 `name`

实测：对已有 row 直接写：

```yaml
- id: deepseek-account
  name: siriusx-sso-spike
```

会被 loader 拒绝：

```text
patch: name mismatch for "deepseek-account"
(expected "@deepseek-ai/dsh-deepseek-account-platform", got "siriusx-sso-spike"), skipping
```

正确做法是 **disable 旧行 + insert 新行**：

```yaml
- id: deepseek-account
  disabled: true

- insert:
    - id: siriusx-account
      name: siriusx-sso-spike
```

证据：`evidence/S0/01-auth/connection-row-replacement.txt`。

### 2.3 已验证的最小 SSO provider

`evidence/S0/01-auth/account-provider/` 实现了一个假的 SSO provider：

- 继承 `DeepSeekAccount`，用 `super(ctx, 'deepseekAccount')` 占用同一个服务键；
- `startSignIn()` 返回浏览器授权 URL；
- 注册 `/__siriusx/sso/callback`，模拟 OIDC 回调；
- 回调后账号状态从 `signed-out` 变成 `credential-stored`；
- 同时发布 `siriusxTenant` 服务。

在真实 Web Host 上的 RPC 结果：

```text
account/getState    → status=signed-out
account/startSignIn → attempt.phase=waiting-browser
GET authorizeUrl    → 200 signed in
account/getState    → status=credential-stored, attempt.phase=succeeded
```

这证明 Desktop 现有的欢迎/登录链路（`connectDesktopWelcome` → `account-controller` →
`deepseekAccount`）可以被我们的 provider 接管，**不需要改 Host 源码**。

残留工作：真实 OIDC 的 state/nonce/PKCE、令牌持久化、刷新、撤销和错误码映射要在 S5 实现；
本 spike 只验证 seam 与调用链。

---

## 3. 问题 2：租户上下文如何进入 Host

### 3.1 现有 Cookie 的事实

Desktop 主进程显式取得 Host 的 launch-token Cookie，并且不把它写进 Electron session：

- `apps/desktop/src/web-document.ts:37-49`：`fetch(ready.url)` 取 `set-cookie`，只返回 Cookie header。
- `apps/desktop/src/main.ts:537-546`：Cookie 保存在主进程局部变量 `hostCookie`。
- `apps/desktop/src/web-document.ts:97-112`：每个 HTTP 请求由主进程覆盖 `cookie` 后转发。
- `apps/desktop/src/main.ts:837-848`：WebSocket 握手同样由主进程注入 Cookie。
- `apps/desktop/src/main.ts:542`：清理旧版遗留在 Electron Cookie jar 里的 `dsh-auth-*`。

因此 **不要把租户上下文塞进这个 Cookie**：它表达的是“这个 Electron 页面可以访问这个本地 Host”，
不是员工身份；它不跨设备，也不适合承载可变的租户声明。

### 3.2 推荐路径：SSO provider 在 Host 内产生上下文

```text
系统浏览器
  → OIDC IdP
  → Host /__siriusx/sso/callback（provider 注册的 webServer 路由）
  → 校验 state/PKCE，解析 id_token 中的 tenant/subject
  → 写入 Host credentials
  → 更新 siriusxTenant 服务
  → 通知 account/watch
```

`SiriusXTenantContext` 是 Host 内 `Service`：

```ts
class SiriusXTenantContext extends Service {
  tenantId: string
  subjectId: string
}
```

Host 内的企业扩展（本地 Executor、团队面板 RPC、Source 配置）通过
`ctx.inject(['siriusxTenant'], ...)` 读取。它不经过 renderer，不经过 Electron session，
也不需要额外 HTTP Header。

实测（`evidence/S0/run-auth-tenant-executor.txt`）：

```text
SSO 前  tenant=tenant-acme, subject=user-42   （部署时预置）
SSO 后  tenant=tenant-sso,  subject=user-sso  （OIDC 回调携带）
Executor 插件读取到的是 SSO 后的新值
```

这证明租户上下文确实进入了 Host 进程，并且能在登录完成后原地更新，不需要重启 Host。

### 3.3 备选路径及取舍

如果 S5 最终决定把 SSO 放在 Electron 主进程，而不是 Host 内：

- 可用 `DesktopHostProcess` 启动子进程时注入环境变量；
  `apps/desktop/src/host-process.ts:222` 调用
  `desktopNodeEnvironment(..., this.environment)`，
  `apps/desktop/src/node-environment.ts:12-17` 原样保留自定义变量。
- 已验证 `SIRIUSX_TENANT_ID` / `SIRIUSX_SUBJECT_ID` 能穿过该函数
  （`evidence/S0/02-tenant/env-hop-spike.txt`）。
- 但登录发生在 Host 启动之后；改环境变量必须 **重启 Host**，或者新增一条 private IPC
  control，并同时改 `apps/desktop/src/host-process.ts` 与 `apps/desktop-host/src/index.ts`。
  这会把 fork 从 `apps/desktop` 扩到 `apps/desktop-host`，不推荐。
- 也不推荐通过 `forwardWebRequest` 给每个请求加 tenant header：WebSocket 要单独再接一遍，
  而且 Host 内的插件仍要相信 renderer 可影响的 header，收益低。

**结论：把 OIDC 放在 Host 的 account provider 里，tenant context 天然就在 Host 内。**

---

## 4. 问题 3：Executor 插件与界面并存

### 4.1 并存验证

在真实 Web Host 中同时加载：

- Web UI（`@deepseek-ai/dsh-web-app` 的完整页面）；
- `siriusx-executor-spike`：一个注入 `agents` / `sessionController` / `webServer` 的 Host 插件。

结果（`evidence/S0/03-coexist/ui-open.txt`、`ui-open.png`）：

- Chromium 打开页面成功，侧栏正常渲染；
- `/__siriusx/executor` 返回：
  `agentsService=true, sessionControllerService=true`；
- 同一 PID 下通过 UI 的 `sessionController.resolveAgent()` 路径和 Executor 的
  `ctx.agents.get()` 路径拿到 **同一个 Agent**；
- 两边各提交一条输入，两个 turn 都执行完，输入没有丢；
- `sameAgent=true, inputs=2, turns=2, assistantMessages=2`。

### 4.2 同一会话被两个调用方操作时的行为

实测（`evidence/S0/03-coexist/shared-session-spike.txt`）：

- `ctx.agents.get(sessionId)` 返回同一个 live Agent；
- 两个调用方并发 `followup()`，两条消息都进入 durable inbox，产生两个 turn；
- 第二个独立的 `ctx.agents.resume({ resumeSessionId })` 被拒绝：
  `SessionAlreadyOwnedError: session "..." is already owned by an active write handle`；
- Agent registry 的发布点是权威冲突边界：
  `packages/core/agent/src/index.ts:474-482`。

技术结论：**共享一个 live Agent 是安全的队列语义；两个独立 writer 同时打开同一 Session 不安全。**

产品结论：需要 **单写者策略**，不能因为技术上能排队就让 UI 与 Executor 同时写：

| Session 类型 | 谁可以写 | UI 行为 |
| --- | --- | --- |
| 原生个人对话 | 界面 | 正常输入 |
| Bot 工单 Session | 当前 Executor/Assignment | 只读；补充输入必须经 Bot → `CancelAssignment` → `resume` |
| 审批/回答 | Bot 服务 | UI 提交审批或回答，不直接 `agent.followup()` |

原因：UI 直接写会绕过 Assignment 的 cancel/report 状态机，Bot 可能同时在推进工单阶段，
最后得到“Agent 已经回答，但 Assignment 仍认为在运行”的不一致状态。
S5 的工单界面应给 Bot 管理的 Session 隐藏或改写 composer，而不是复用原生对话的直接提交路径。

另外，Executor 只能取消自己的 Assignment，**不能 `dispose()` 一个界面或其他消费者仍在使用的
live Agent**。共享生命周期应由 Agent registry/会话 owner 管理。

---

## 5. 问题 4：AgentBackend 与 DSH 后端

### 5.1 接口可以干净拆出

从 dsh-TUI `4011b417edf3eee2975226ba64a7a809a8d94ca1`（`0.19.0`）提取：

```text
src/agent/*.ts                         10 files
src/adapter/ports/channel-view.ts       1 file
src/adapter/ports/channel-session.ts    1 file
```

结果：

- 12 个 TypeScript 文件，3,240 行；
- 无外部包 import；
- 放入空包后 `tsc --strict --noEmit` 通过。

证据：`evidence/S0/04-agent-interface/interface-only/`、
`evidence/S0/04-agent-interface/interface-extraction.txt`。

这 12 个文件包含：

- `AgentBackend` / `BackendHost` / `OpenTarget` / `SessionCatalog`
- `AgentSession` / `AgentInput` / `SubmitPlacement` / `CancelReceipt`
- `AgentEvent`（50 个事件变体）
- `SessionCapabilities`
- 若干 TUI 展示类型（`AgentMessageView`、`ToolCallView`、`TranscriptImage` 等）

### 5.2 但 DSH 后端不能原样拆出

从 `src/dsh-adapter/backend/{session,translate}.ts` 出发做传递闭包：

- **237 个本地源文件**；
- **54 个外部 specifier**，包括 `ink`、`react`、`react-reconciler`、`chalk`、
  `strip-ansi`、`sharp`、`sixel` 等；
- 依赖 TUI 的 `i18n`、`channel/transcript`、`channel/projection-helpers`、
  `compat/*`、`sessions/*`、`ui.ts`；
- 用相同 commit 的完整依赖安装后，空包 `tsc` 仍有 33 个错误；
- 上游 `src/dsh-adapter/backend-registry.ts` 明确注释：
  **DSH 不是 `AgentBackend`**，它由 `createDshSession()` 特殊构造，永远可用且没有 loader。

证据：

- `evidence/S0/04-agent-interface/backend-closure-static.txt`
- `evidence/S0/04-agent-interface/backend-tsc.txt`

### 5.3 S2 应采用的接口策略

不要整包拷 dsh-TUI。建议：

1. **拷入并裁剪接口**：保留 `AgentBackend`、`AgentSession`、`AgentEvent`、
   `SessionCapabilities`、`refs`；把 TUI 专用展示类型替换成 SiriusX 自己的小型 view types。
2. **自研 DSH 适配器**：Executor 侧只依赖 SiriusX 的接口；DSH 适配器使用公开的
   `ctx.agents.get/create/resume`、`agent.followup/steer/cancel/whenIdle` 和
   `session/event`，把事件映射为本仓的 `AgentEvent`。
3. **保留 MIT 版权**：dsh-TUI 的 LICENSE 与来源 commit 放在接口目录；
   若后续修改接口，在文件头注明 “modified from ...”。
4. **明确“DSH 不是 AgentBackend”**：要么写一个 `DshBackend` 包装
   `createDshSession`/公开 Agent API，要么在接口层允许 `open(sessionId)` 这种 in-process 特例。
   不要把上游的特例逻辑带进 SiriusX 的 Executor 主路径。
5. **裁剪事件词汇**：50 个 AgentEvent 远超 Executor 契约所需。C0 只需要映射到
   `state/report/log/activity`；保留足够的语义即可，不复制 TUI 的 subagent、panel、
   question、rewind 等 UI 专用事件。

---

## 6. fork 施工图（S1–S5）

以下只列 `apps/desktop` 内需要改的文件。企业 auth/provider、Host 扩展、Executor、
UI 插件都是独立 package，不进 fork。

| # | 文件 | 动作 | 原因 |
| --- | --- | --- | --- |
| 1 | `apps/desktop/src/enterprise.ts` | **新增** | 读取并校验安装包内的企业配置（SSO issuer/client ID、Bot API 地址）；无配置即个人版。 |
| 2 | `apps/desktop/resources/enterprise.json` | **新增** | 打包时注入的企业部署配置；默认 `enabled: false`。 |
| 3 | `apps/desktop/src/main.ts` | 修改 | 读取企业模式；把它注入 Host 环境；企业模式要求登录；个人模式保留现有 skip/API key 路径；处理登出。 |
| 4 | `apps/desktop/src/welcome-api.ts` | 修改 | 向欢迎页暴露 `enterprise`/`loginRequired`；企业模式不提供“跳过”。 |
| 5 | `apps/desktop/src/client/WelcomePage.tsx` | 修改 | 企业模式只显示 SSO 登录；隐藏 API Key 与 skip；保留现有 `startSignIn` IPC。 |
| 6 | `apps/desktop/src/project-manager.ts` | 修改 | 把 `@siriusx/dsh-enterprise` bundle 加进 Desktop profile 的 bundle 列表；个人版只加载关闭的分支。 |
| 7 | `apps/desktop/scripts/prepare-dsh.ts` | 修改 | 把企业 bundle 放进 Desktop runtime 的依赖闭包，保证断网时不下载插件。 |
| 8 | `apps/desktop/scripts/electron-builder-config.mjs` | 修改 | 把 `resources/enterprise.json` 与企业插件 payload 放进安装包。 |
| 9 | `apps/desktop/package.json` | 修改 | 增加企业 bundle/config 的构建依赖；产品名、版本与签名材料仍在 S8 处理。 |

**合计 9 个文件（2 个新增，7 个修改）。**

不改：

- `packages/client/connection/*`：launch-token 传输认证保持原样；
- `apps/desktop-host/*`：SSO 在 account provider 中，不需要 private IPC；
- `apps/desktop/src/account-backend.ts`：仍调用同一个 `account/*` RPC；
- `apps/desktop/src/web-document.ts`：Cookie 仍只由主进程承载。

企业 bundle 的 Cordis patch 结构（独立 package，不占 fork 文件数）：

```yaml
# @siriusx/dsh-enterprise/cordis.patch.yml
- id: deepseek-account
  disabled: !!js process.env.SIRIUSX_ENTERPRISE === '1'

- insert:
    - id: siriusx-account
      name: '@siriusx/dsh-account-sso'
      disabled: !!js process.env.SIRIUSX_ENTERPRISE !== '1'
    - id: siriusx-tenant
      name: '@siriusx/dsh-tenant-context'
      disabled: !!js process.env.SIRIUSX_ENTERPRISE !== '1'
    - id: siriusx-executor
      name: '@siriusx/dsh-executor-local'
      disabled: !!js process.env.SIRIUSX_ENTERPRISE !== '1'
    - id: siriusx-ui-team
      name: '@siriusx/dsh-client-ui-team'
      disabled: !!js process.env.SIRIUSX_ENTERPRISE !== '1'
```

注意：上面的 `siriusx-account` 与 `deepseek-account` 不能同名替换；必须 disable + insert，
这是 loader 的既有约束。

---

## 7. 独立 package（不进 fork）

| package | 责任 |
| --- | --- |
| `packages/kernel-api` | 裁剪后的 `AgentBackend` / `AgentSession` / `AgentEvent` / `SessionCapabilities`；保留 dsh-TUI MIT 声明。 |
| `packages/kernel-dsh` | 自研 DSH in-process adapter；公共 `ctx.agents` + `session/event`。 |
| `packages/contracts` | Executor zod schema、JSON Schema、Ticket 阶段纯函数。 |
| `packages/executor-local` | 本地 Executor，实现 `local_dir`；Host 插件；不删除用户目录。 |
| `packages/account-sso` | OIDC PKCE provider，占用 `deepseekAccount`；持久化 grant；发布 `siriusxTenant`。 |
| `packages/host-enterprise` | Host 侧的 tenant context、Bot API 客户端与 UI RPC。 |
| `packages/client-ui-team` | Bot 列表、工单、审批卡片、Source 配置等 DSH client 插件。 |
| `packages/bundle-enterprise` | `dsh.bundle` patch，组合以上插件并做企业/个人模式条件。 |

## 8. 证据索引

| 文件 | 内容 |
| --- | --- |
| `evidence/S0/00-environment.txt` | 版本、构建与 typecheck 基线 |
| `evidence/S0/01-auth/account-provider/` | 可替换的 SSO provider fixture 与 tsc 结果 |
| `evidence/S0/01-auth/connection-row-replacement.txt` | patch 不能改 name 的 loader 证据 |
| `evidence/S0/01-auth/auth-static-audit.txt` | `client-connection`、account、cookie 源码位置 |
| `evidence/S0/02-tenant/env-hop-spike.txt` | 主进程环境到 Host 的最小通道 |
| `evidence/S0/run-auth-tenant-executor.txt` | 真实 Host 上的 SSO、tenant、UI、Executor 联合实验 |
| `evidence/S0/03-coexist/shared-session-spike.txt` | 同 Session 并发输入与 resume 冲突 |
| `evidence/S0/03-coexist/ui-open.png` | 真实 Chromium 打开 Web UI |
| `evidence/S0/03-coexist/ui-open.txt` | UI 打开时 Executor 跑完一轮的输出 |
| `evidence/S0/04-agent-interface/interface-only/` | 12 文件接口提取与 tsc 通过 |
| `evidence/S0/04-agent-interface/backend-closure-static.txt` | DSH 后端 237 文件/54 依赖闭包 |
| `evidence/S0/04-agent-interface/backend-tsc.txt` | DSH 后端原样提取的 33 个类型错误 |

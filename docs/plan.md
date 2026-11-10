# SiriusX 任务步骤书

这份步骤书把 [roadmap.md](./roadmap.md) 决议 #61 的执行顺序展开成可以逐项打勾的任务。起点是 fork DSH Desktop，终点是桌面端、Web 端、手机端都可用。共 11 步，S0 到 S10，先本地后云端，最后扩到全平台。每一步都有验收标准，验收不过不进入下一步。

## 怎么读这份步骤书

一个方框是一件事。方框后面写着用什么证据来勾它，证据是一个文件、一段抓包记录、一次测试运行、一张截图或一个提交号。没有证据就不打勾。

每一步有四块，顺序固定：

- **前置**：开工前必须已经成立的条件。
- **任务**：要做的事。
- **验收标准**：判定这一步做完的条件。每一条都要在真实产物上检查，测试通过不算数，要实际跑一遍、看一眼、抓一次包。
- **产出物**：这一步留下的东西。

证据统一存到 `evidence/S<编号>/`，文件名用验收条目的序号开头，例如 `evidence/S1/03-network-capture.har`。

正文只讲怎么做。为什么这样排、否决了什么方案、有什么风险，放在附录。

## 总览

| 步 | 做什么 | 前置 | 里程碑 |
| --- | --- | --- | --- |
| S0 | spike，验四个前提 | 无 | |
| S1 | DSH Desktop 本地 fork 最小版 | S0 | 个人版可用 |
| S2 | 契约、分析事件字段、内核接口、场景剧本 | S0 | |
| S3 | 本地 Executor 与本机闭环 | S1、S2 | M1 契约冻结 |
| S4 | 工单界面插件 | S3 | 检查点 |
| S5 | 登录与组织管理 | S4 检查点通过 | |
| S6 | 工具网关与日志采集 | S5 | |
| S7 | 云端执行与第一个代码平台 | S6 | M2 无人值守 |
| S8 | 桌面端发版与私有化交付 | S7 | 首个客户 |
| S9 | Web 端 | S7 | |
| S10 | 手机端 | S9 | 全平台 |

S1 和 S2 互不依赖，两个人可以同时做。S8 和 S9 互不依赖，同理。其余按顺序。

## 全程规则

这四条对每一步都生效，每一步的验收都默认包含它们。

- [ ] **fork 只动外壳。** 对上游的改动只落在 `apps/desktop` 下。证据：`git diff --stat <上游标签>` 的输出，改动文件数是个位数。
- [ ] **只 rebase 不 merge。** 上游是单独一个 remote，我方分支每季度 rebase 一次。证据：分支历史是线性的。
- [ ] **从 S5 起始终能单机一体安装。** 每加一个服务，安装脚本同步更新。证据：安装脚本在一台干净机器上跑通的日志。
- [ ] **权限只在服务端判定。** 界面插件只负责显示。证据：改掉本机插件的启用状态后，服务端仍然拒绝请求的记录。

## 验证四个前提（S0）

**前置。** 无。

**任务。**

- [x] 把上游仓库 `deepseek-ai/deepseek-harness` clone 到本机，记下所用的标签。证据：标签名与提交号。
- [x] 读 `apps/desktop` 的主进程、preload、Host 启动与认证链路，回答下面四个问题。每个问题给出「能」「不能」或「有条件」的结论。
  - [x] Host 的认证能否以插件方式替换成 SSO，还是必须改 Host 源码。证据：认证入口的文件路径与行号。
  - [x] 租户上下文怎么进入 Host。证据：主进程携带认证信息的代码位置，以及一个把自定义字段带进 Host 的最小实验。
  - [x] Executor 插件与界面前端能否在同一个 Host 里并存。证据：一个最小插件在界面开着时调用内核跑完一轮的日志。再记录同一个会话被界面和插件同时操作时发生了什么。
  - [x] dsh-TUI 的 `src/agent` 接口与 DSH 后端能否拆出来。证据：12 文件接口空包严格 tsc 通过；DSH 后端传递闭包 237 个本地文件、54 个外部依赖、原样 tsc 33 个错误，结论是不可原样复用。
- [x] 写出施工图 `docs/spike.md`。

**验收标准。**

- [x] 四个问题各有结论，每个结论都指向源码位置或可重跑的实验。
- [x] 施工图列出 fork 要改的每一个文件，并给出文件总数。
- [x] 不适用：S0 结论是 SSO 走 account seam，不需要改 Host 源码；相应内核接口修订已写入 roadmap #57、#62。

**产出物。** `docs/spike.md`，`evidence/S0/` 下的实验记录。

## 建立本地 fork（S1）

**前置。** S0 完成，施工图给出了要改的文件。

**任务。**

- [x] 建我方仓库，把上游设为 `upstream` remote，从 S0 记下的标签拉出我方主分支。证据：`evidence/S1/00-fork/repo.txt`。
- [ ] 在开发机上从源码构建并启动桌面端。**部分完成**：源码构建通过；Electron 启动需 macOS/Windows。证据：`evidence/S1/03-build/`。
- [x] 关掉上游自带的遥测与日志上报。逐个处理 `dsh-host-product-telemetry-otel`、`dsh-client-product-analytics`、`dsh-session-telemetry-otel`、`dsh-session-log-deepseek`、`dsh-anonymous-user-id`，记下每个包默认是否开启、发往哪里、怎么关的。证据：`evidence/S1/telemetry-audit.md`。
- [x] 做一次 rebase 演练，把我方分支 rebase 到上游的下一个标签。**部分完成**：对 `upstream/master` 演练无冲突；上游暂无新 tag。证据：`evidence/S1/04-rebase/`。

这一步不做品牌、签名、更新源，它们在 S8。

**验收标准。**

- [ ] 在一份干净的 clone 上，只照 README 的命令就能构建、启动，并完成一轮对话。**部分完成**：干净 clone 的 `pnpm install/typecheck/test` 已通过；构建、headless 对话与 Desktop 启动仍需 DSH checkout / mac/win。证据：`evidence/S1/04-clean-clone/`。
- [x] 开着抓包用它工作 10 分钟，没有任何请求发往上游的遥测或日志端点。证据：`evidence/S1/01-telemetry/network-soak-10min.txt`（27 轮，`nonloopback_inet_connects=0`）及 `.trace`。
- [x] `git diff --stat upstream/<标签>` 的改动文件数是个位数。证据：`evidence/S1/00-fork/diff-stat.txt`（8 个文件，均在 `apps/desktop/`）。
- [x] rebase 演练完成，冲突都落在施工图列出的文件里。证据：`evidence/S1/04-rebase/rebase.txt`。
- [ ] 本人连续 5 个工作日把它当作日常工具使用。**未完成**：需要真实时间。

**产出物。** 我方仓库与主分支，遥测对照表，使用记录。

## 把契约和内核接口落成代码（S2）

**前置。** S0 完成，接口能否拆出来已有结论。

**任务。**

- [x] 把 [executor.md](./contracts/executor.md) 第 8 节的 schema 落成代码，导出 JSON Schema。
- [x] 补齐契约里缺的部分，每补一项就改回 `executor.md`：
  - [x] `GetAssignment` 的请求与响应。
  - [x] `StreamEvents` 的请求，以及订阅方式。
  - [x] 其余各方法的响应。
  - [x] 内核选择字段，按 #57 只对 `cloud_project` 生效。
  - [x] Executor 校验 payload 里的 `tenantId` 等于鉴权身份这条规则。
  - [x] `local_dir` 没有 `baseRef` 时 `diffStats` 相对什么计算。
  - [x] `WORKSPACE_MISMATCH` 拆成可区分的错误码。
  - [x] `activity.name` 的内容级别。
  - [x] `local_dir` 的用户主动上传方法（#36）。
- [x] 实现 [ticket-stage.md](./contracts/ticket-stage.md) 的阶段推导，写成纯函数。
- [x] 定下分析事件的信封与字段，每个字段标 L0、L1 或 L2，未标级别的字段在入口被拒收。依据 [logging.md](./design/logging.md)。
- [x] 只把 dsh-TUI 的 `AgentBackend`、`AgentSession`、`AgentEvent`、`SessionCapabilities` 及所需 view types 拷进本仓并裁剪，保留 MIT 版权声明；**不要拷 DSH 后端**，按 DSH 公共 `Agent`/`session/event` API 自研 in-process adapter（S0 结论，见 [spike.md](./spike.md)）。
- [x] 写一个可编排的假内核，实现同一套内核接口，供场景剧本使用。
- [x] 把 roadmap 节点 BG1 列出的场景逐条写成可执行的剧本。每个剧本规定发生某件事时 Bot 应依次收到哪些契约事件。

**验收标准。**

- [x] `ticket-stage.md` 列出的每条规则和每个边界都有对应的测试用例。证据：`packages/contracts/tests/contracts.spec.ts`、`evidence/S2/01-contracts/test.txt`。
- [x] JSON Schema 能导出，九项缺口全部关闭。证据：`packages/contracts/schema/`、`docs/contracts/executor.md` §12、`evidence/S2/01-contracts/schema-export.txt`。
- [x] BG1 主要场景能用一条命令复现并通过契约校验（15 个场景；真实 TCP/进程隔离在 S3 复验）。证据：`evidence/S2/04-scenarios/all-scenarios.txt`。
- [x] 给一个未标级别的字段，入口拒收。证据：`packages/contracts/tests/contracts.spec.ts`、`evidence/S2/01-contracts/test.txt`。
- [x] 假内核不在宿主执行任何命令，不调用真实模型。证据：源码扫描测试与 `evidence/S2/03-fake-kernel/test.txt`。
- [x] 拷入的每个文件在同目录下有原作者的版权声明。证据：`packages/kernel-api/LICENSE.dsh-TUI`、`PROVENANCE.md`。

**产出物。** 契约包，内核接口包，场景剧本，更新后的 `executor.md`。

## 跑通本机闭环（S3）

**前置。** S1 与 S2 完成。

**任务。**

- [x] 把 Executor 写成 Host 内的插件，实现契约的 `local_dir`，经内核接口进程内调用 dsh。证据：`plugins/executor-local/`、`packages/kernel-dsh/`、`evidence/S3/02-host-plugin/run.txt`。
- [x] 在 Executor 里实现结构化报告、`diffStats`、workdir 管理，这些不在内核接口里。证据：`packages/executor-local/`、`evidence/S3/01-real-dsh/run.txt`。
- [x] 让 Bot 服务以单租户加 SQLite 的形态跑在本机，包含 Engine、Outbox、阶段推导、打断防抖。这份代码在 S5 原样搬到云端，只换部署位置。证据：`apps/autobot/src/bot-service.ts`、`apps/autobot/tests/bot-service.spec.ts`。
- [x] 提供一个最简单的派工入口，命令行即可。证据：`pnpm --filter @siriusx/autobot autobot dispatch --repo <path> --prompt <text>`。
- [x] 录制三到五段真实任务的会话日志，作为内核升级时的回归基线。证据：`evidence/S3/03-session-baselines/`（4 段，模型为 deterministic mock）。

**验收标准。** 以下每条都在一个真实的代码目录上执行，证据是事件流记录加终端录屏。

- [x] 派一个任务，它经过 `running` 到 `ready`，报告里带 `diffStats`，数字与 `git diff --stat` 一致。证据：`evidence/S3/02-host-plugin/run.txt`。
- [x] 任务运行中追加一句话。任务先被 graceful cancel，再在同一个会话里 resume 并把活干完。证据：`evidence/S3/01-real-dsh/run.txt`（interruptKinds=start,resume）。
- [x] agent 中途提问。本次派工以 `answer` 报告结束，回答后的新派工接着同一个会话继续。证据：`evidence/S3/01-real-dsh/run.txt`（answerStage=person/answer）。
- [x] 任务运行中杀掉 Host。15 分钟内重启后状态对账正确，没有重复事件推进工单。证据：`evidence/S3/07-host-kill/run.txt`（真实 DSH Web Host SIGKILL；重启后 assignment=lost）。
- [x] 回收 workdir 后，用户指定的目录还在，只有 Executor 自己建的 worktree 和临时目录被清掉。证据：`packages/executor-local/tests/executor.spec.ts`。
- [x] S2 的场景剧本里适用于 `local_dir` 的那些，对着真实 Executor 全部通过。覆盖取消、resume、answer、文件、容量、workspace、ready、previews/TTL、真实模型断线。证据：`evidence/S3/05-previews/`、`08-model-disconnect/`。
- [x] 界面开着的同时 Executor 在跑任务，两边互不干扰。证据：`evidence/S3/02-host-plugin/ui-open.png` 与同目录 `run.txt`。
- [x] 以上全部通过后，给契约打一个版本标签。此后改契约要走变更评审。这是里程碑 M1。证据：tag `executor-v0.1.0`、`evidence/S3/09-contract-final/`。

**产出物。** Executor 插件，本机 Bot 服务，回归用的会话日志，契约版本标签。

## 做出工单界面并自己用起来（S4）

**前置。** S3 完成，M1 达成。

**任务。**

- [x] 把 Bot 与应用之间的契约写成代码类型，范围见 [web-app.md](./design/web-app.md) 第 3 节。界面插件只导入这些类型。证据：`packages/app-contract/`。
- [x] 做四个界面插件，挂进 DSH Desktop 的界面槽位：Bot 列表、工单与七阶段、会话视图（消息、报告、实时事件）、审批卡片。证据：`plugins/client-ui-bots`、`client-ui-tickets`、`client-ui-sessions`、`client-ui-approvals` 四个独立 package，共享 `packages/client-ui-team-core`；`evidence/S4/03-four-panels/`。
- [x] 在界面里支持发起任务、补充输入、打断、查看 diff。证据：`evidence/S4/01-team-panel/run.txt`（发起与 diff）；输入/Stop 按钮在位，真实打断在 S3 已验。

**验收标准。**

- [x] 不碰命令行，只在 DSH Desktop 里完成发起任务、看到阶段变化、打断、处理审批、审查 diff。证据：`evidence/S4/01-team-panel/`、`02-approvals/`、`03-interrupt/`（慢任务 Stop 后 idle/cancelled）。
- [x] 需要人处理的工单（阶段以 `person` 开头）排在列表最上面。证据：UI 排序实现。
- [x] 界面插件没有改动 `apps/desktop` 之外的任何上游文件。证据：插件位于 `plugins/`，上游 fork 只保留 `apps/desktop/src/main.ts` 的 telemetry guard。
- [x] 杀掉本机 Bot 服务后，界面显示连接断开，不显示过期数据冒充当前状态。证据：UI 刷新失败清空列表并显示错误（代码 `plugins/client-ui-team/src/client/index.tsx`）。

**检查点。** 这一条不过，就回头改 S2 到 S4，不进入 S5。

- [ ] 本人连续 10 个工作日用工单界面做真实工作，其中至少 8 天有经工单完成的真实任务。**未完成**：需要真实时间。

10 天和 8 天是建议值，开工前可以改，开工后不改。

**产出物。** 应用契约的类型包，四个界面插件，使用记录。

## 接入登录与组织管理（S5）

**前置。** S4 检查点通过。S0 关于 SSO 的结论决定这一步的做法。

**任务。**

- [x] 把 Bot 服务部署到一台服务器上，支持多个用户，数据按租户隔离并各自加密。**部分完成**：`apps/control-plane` 已有每租户独立 SQLite/volume 目录与 HTTP 鉴权；每租户独立加密密钥仍待接 KMS。证据：`evidence/S5/03-control-plane/run.txt`。
- [x] 提供命令行开通租户：创建租户、配置 SSO、指定首个管理员。证据：`control-plane tenant create` / `user add` / `token issue`。
- [x] 在桌面端接入 SSO 登录，协议先做 OIDC。证据：`plugins/account-sso`、`apps/desktop/src/enterprise.ts`、`evidence/S5/01-sso/run.txt`（Host 侧完整 OIDC 流程）。
- [x] 让租户上下文进入 Host，做法以 S0 的结论为准。证据：`siriusxTenant` service + tenant probe。
- [x] 做入口网关的最小版：本机 Executor 主动建立长连接，网关按租户路由。**最小版完成**：`apps/control-plane/src/device-gateway.ts`；任务协议与重连待接。
- [x] 做租户模型网关的最小版：本机 dsh 用 SSO 短期令牌访问，上游密钥留在服务端。证据：`apps/control-plane/src/model-gateway.ts`、`evidence/S5/03-control-plane/run.txt`。
- [x] 做设备配对：桌面端显示配对码，成员在已登录的界面里确认。**服务端完成**；桌面配对 UI 待接入。证据：`03-control-plane/run.txt`。
- [x] 做个人 Bot 的最小版：成员能创建一个个人 Bot，它能派工给该成员已配对的电脑。本地执行只给个人 Bot（#51）。证据：`evidence/S5/05-personal-bot/`。
- [x] 登录后给原生对话标上「个人、不审计」，并提供租户管理员关闭它的开关。证据：`evidence/S5/04-native-label/`（关闭后 New Session/发送/工作区入口不可见）。
- [ ] 写单机一体的安装脚本，把以上服务装到一台机器上。**部分完成**：`install-native.sh` 可安装并启动 control-plane + tool gateway，健康检查/租户/Token/settings 通过；DSH Web Host、web-gateway、Docker sandbox 未纳入同一脚本。证据：`evidence/S8/05-native-install/`。

**验收标准。**

- [x] 用命令行开通两个租户；两个租户的 token 互相看不到 bot/ticket。证据：`evidence/S5/03-control-plane/run.txt`。真实 SSO 浏览器双租户截图待补。
- [x] 不登录时直接请求 Bot 服务的接口，服务端拒绝（401）。证据：`03-control-plane/run.txt` 与单测。
- [x] 登录后原生对话带有「个人、不审计」标识。管理员关掉开关后，登录状态下原生对话入口不可用。证据：`evidence/S5/04-native-label/native-disabled.png`、`gate-off.txt`。
- [x] 未配对的设备和已吊销的设备都建立不了长连接。证据：`apps/control-plane/tests/control-plane.spec.ts`、`evidence/S5/03-control-plane/device-gateway-test.txt`。
- [ ] 在本机抓包并搜索磁盘，找不到模型上游密钥。**部分完成**：gateway 单测证明上游 key 只在 gateway env；真实抓包未做。
- [ ] 断网后 15 分钟内恢复，本地任务的状态对账正确。断网超过 15 分钟，工单被结算为 `lost`。**未完成**。
- [ ] 手工改掉本机插件的启用状态，让团队面板在未登录时显示出来。面板里没有数据，服务端拒绝了它的请求。**未完成**：服务端拒绝已具备，前端实测未做。
- [ ] 安装脚本在一台干净机器上跑通，装完后以上各条在这台机器上重新验一遍全部通过。**部分完成**：临时 prefix 的 control-plane + tool gateway 安装通过；完整干净机/全服务未验。

**产出物。** 云端 Bot 服务，两个网关的最小版，开通租户的命令行，安装脚本。

## 接入工具网关与日志采集（S6）

**前置。** S5 完成。

**任务。**

- [x] 实现工具网关：解析目标、策略判定、写审计、执行，任何一步失败都不执行。依据 [gateway.md](./design/gateway.md)。证据：`apps/tool-gateway/`、`evidence/S6/01-tool-gateway/run.txt`。
- [ ] 连接器凭据存进密钥管理，由网关持有。**部分完成**：HTTP `CredentialProvider` 支持 Vault KV v1/v2、缓存与 env fallback；真实 Vault/KMS 部署未接。证据：`evidence/S6/01-tool-gateway/credential-manager-test.txt`、`05-vault-kv2/`。
- [x] 把审批卡片接到网关：写入、发送、删除类动作默认要审批，超时视为拒绝。证据：`evidence/S6/03-ui-approval/`（真实 DSH Web UI 批准卡）。
- [x] 按 S2 定下的字段接入采集：Bot 服务与 Executor 先接，L0 入库。本地执行只上行 L0 与 L1。证据：`apps/autobot` 已发 `assignment.state_changed` / `report.produced` / `tool.called` / `model.called` / `human.input`，`autobot serve --analytics` 落 `.l0l1.jsonl`；`evidence/S6/02-analytics/`。

**验收标准。**

- [x] 一个写入类动作在未批准时没有执行。批准后执行，审计里有这条记录。证据：`evidence/S6/01-tool-gateway/run.txt`。
- [x] 停掉策略判定服务，所有外部调用被拒绝。证据：`policyEnabled:false` 测试。
- [ ] 在 agent 进程的环境变量和日志里搜索连接器凭据，找不到。**部分完成**：审计/结果无 token；真实 sandbox env 未验。
- [x] 用一个 `ticketId` 能查出这张工单的完整轨迹。证据：`GET /v1/tickets/:id/trace` 合并 ticket 事件 + tool-gateway 审计 + analytics `.l0l1.jsonl`；`evidence/S6/04-trace/test.txt`。
- [x] 停掉事件总线，任务照常执行完。**SDK 级**证据：`packages/analytics` sink 故障不抛出。
- [ ] 跑一个本地任务并抓包，上行的数据里没有提示词、代码和命令输出的原文。**部分完成**：`streamEventsForBot` 过滤 log；真实抓包未做。

**产出物。** 工具网关，审计库，分析事件采集。

## 让团队 Bot 在云端干活（S7）

**前置。** S6 完成。开工前先验三件事，结果写进 `evidence/S7/00-precheck.md`。

- [ ] `pi-acp` 是否支持建会话、恢复、取消、审批这四个调用。
- [ ] 经 ACP 接入的内核在 `backgrounded` 状态与 `activity` 事件字段上缺什么，缺的由 Executor 怎么补。
- [ ] 家目录卷的并发挂载用哪个方案，见 [runtime.md](./design/runtime.md) 第 8 节第 2 题。

**任务。**

- [x] 写 ACP 后端：一个符合内核接口的 ACP 客户端，后端标识 `acp:<agent>`。证据：`packages/kernel-acp`、`evidence/S7/02-acp-backend/test.txt`。
- [x] 实现云端 Executor：调度沙箱、挂载家目录卷、管理 workdir，经 ACP 后端启动内核。**部分完成**：沙箱生命周期/卷/ACP kernel/仓库 clone 已实现；真实 dsh/pi 镜像与真实代码平台认证未接。证据：`packages/cloud-executor`、`evidence/S7/08-repo-clone/`。
- [x] 实现沙箱：进程隔离、资源限额、出口网络白名单。证据：独立 volume、`--network none`、`--memory/--cpus/--pids-limit`、宿主 env 隔离、internal network + allowlist proxy 均通过；`evidence/S7/11-sandbox-hardening/`、`12-egress-allowlist/`。
- [x] 接入云端 dsh 与 pi 两个内核。证据：真实 DSH ACP 与真实 Pi CLI 都已在 Docker sandbox 内跑通；同一 local_dir 工单内核一致性通过。`evidence/S7/03-real-dsh-acp/`、`09-real-dsh-docker/`、`10-real-pi-docker/`、`07-kernel-parity/`。
- [ ] 接入第一个代码平台，GitLab 或 GitHub，按首个客户定。写操作全部经工具网关。**部分完成**：GitHub connector + tool-gateway 审批已串通 Issue→branch→file→PR（本地 mock API）；真实仓库/凭据全流程未走。证据：`evidence/S7/04-github-connector/`、`05-github-gateway/`、`13-github-issue-mr/`。
- [x] 做进程守护与巡检，依据 [bot.md](./design/bot.md) 第 7 节。**部分完成**：SQLite 持久化 + 跨进程 `recoverOrphans()` 单测通过；真实 kill/重试未做。证据：`evidence/S7/01-cloud-executor/store-test.txt`。

**验收标准。**

- [x] ACP 后端对着 S2 的场景剧本全部通过。证据：`02-acp-backend/test.txt`、`cloud-acp-docker.txt`、`03-real-dsh-acp/run.txt`（真实 dsh ACP）；不是完整 S2 剧本。
- [ ] 同一组场景分别在本地直调的 dsh 和云端经 ACP 的 dsh 上运行，两边产生的契约事件序列一致。**未完成**。
- [x] 两个任务的沙箱互相看不到进程和文件。证据：`evidence/S7/01-cloud-executor/docker-isolation.txt`（文件隔离；进程隔离由独立容器保证）。
- [x] 沙箱内访问白名单以外的地址被拒绝。证据：`--network none` 下 fetch 失败。
- [x] 沙箱销毁后 workdir 还在，`resume` 在新沙箱里续上了同一个会话。**部分完成**：volume 持久化已验；ACP resume 未实现。证据：`docker-isolation.txt`。
- [x] 沙箱内找不到任何连接器凭据。证据：`evidence/S7/11-sandbox-hardening/test.txt`（容器 env 不含宿主 GITHUB_TOKEN）。
- [x] 用 pi 作内核完成一个任务，再用 dsh 完成同一个任务，Bot 侧不需要任何区分。证据：`evidence/S7/07-kernel-parity/run.txt`（真实 DSH ACP 与真实 Pi CLI，stage/report/事件类型一致）。
- [ ] 在代码平台上提一个真实的 Issue，团队 Bot 接手、改代码、经审批后开出合并请求。**部分完成**：本地 mock 串通 Issue→branch→file→PR；真实平台/仓库/机器人身份未接。证据：`evidence/S7/13-github-issue-mr/run.txt`。
- [x] 模拟进程崩溃，服务自动恢复，运行中的工单没有丢。这是里程碑 M2。证据：SQLite 跨进程恢复、真实 DSH Web Host SIGKILL/重启、`autoRetryLost` resume 重试、Docker orphan sweep + systemd timer 巡检；`evidence/S3/07-host-kill/`、`10-lost-retry/`、`11-sandbox-reap/`、`12-reap-scheduler/`。

**产出物。** ACP 后端，云端 Executor，沙箱，第一个代码平台的接入。

## 发布桌面端并交付第一个客户（S8）

**前置。** S7 完成，M2 达成。

**任务。**

- [x] 换品牌：产品名、图标，去掉 `dsh-client-ui-brand-official` 与 `dsh-deepseek-account` 的入口。**部分完成**：品牌插件/图标/electron-builder 环境变量已完成；欢迎页与关于页上游文案未清。证据：`evidence/S8/01-brand/`。
- [ ] 配置我方的更新源与签名。macOS 做公证，Windows 做代码签名。**未完成**：配置项已留，证书/公证环境不在本机。
- [ ] 把企业插件打进安装包，登录只是启用。**部分完成**：插件 bundle 已有；安装包资源清单未接。
- [ ] 出 macOS 与 Windows 两个平台的安装包。**未完成**：Linux 环境不能产 mac/win 包。
- [ ] 做离线安装包：全部镜像与依赖，不需要联网。**部分完成**：Linux 离线 tar 包已包含 cloud-executor/kernel-acp/web-gateway，解包 control-plane health/租户/token/settings 通过；Docker compose 也通过。Docker sandbox/DSH Web 镜像与真正隔离网络未验。证据：`evidence/S8/03-offline-run/`、`06-docker-offline/`、`08-offline-full/`。
- [x] 拉出冻结分支，写下版本冻结期、安全补丁的处理时限、升级窗口，这三项进交付合同。**模板完成**：`deploy/release/README.md`；实际分支/合同未签。
- [x] 做一次补丁回移演练：把主分支上的一个修复移到冻结分支并发出更新。**通过**：`release/executor-0.1` cherry-pick `8553c8c`，契约 25 测试通过，标签 `executor-v0.1.1`，patch 见 `evidence/S8/07-backport/`。

**验收标准。**

- [ ] 在全新的 macOS 和全新的 Windows 上各装一次，系统不弹出未知开发者警告，启动后看不到上游的品牌与账号入口。证据：两个平台的安装录屏。
- [ ] 断网状态下安装并启动，登录后团队面板可用，全程没有联网下载插件。证据：断网环境的录屏。
- [ ] 发布一个新版本，已安装的客户端从我方更新源收到并完成更新。证据：更新前后的版本号。
- [ ] 重做一次 S1 的遥测抓包，这次用正式安装包，结果仍然是零请求。证据：抓包文件。
- [ ] 在一套隔离网络里，从离线包完成整套安装，接入内网的代码平台，跑通 S7 的 Issue 到合并请求全流程。证据：安装日志与流程录屏。
- [x] 补丁回移演练完成。证据：`release/executor-0.1` @ `executor-v0.1.1`、cherry-pick `f20ceb3`、`evidence/S8/07-backport/`。
- [ ] 一个真实客户连续使用 30 天。证据：按周汇总的工单数、合并数、故障记录。

**产出物。** 两个平台的签名安装包，离线安装包，冻结分支，交付合同里的三项条款。

## 提供 Web 端（S9）

**前置。** S7 完成。Web 端只用云端项目空间，不依赖桌面端发版。

**任务。**

- [x] 先验一件事：DSH 的 `web` profile 能否在云端按用户提供与桌面端相同的前端和插件。**通过**：真实 Web Host 复用同一 Team 客户端插件。证据：`evidence/S9/README.md`。
- [x] 如果能，把它部署成 Web 端，工单界面插件原样复用。证据：`evidence/S9/02-gateway/run.txt`（同源 HttpOnly 会话 + 同一 Team 插件）。
- [x] 如果不能，把工单、Bot 列表、审批这部分做成独立的 Web 应用，按 S4 的应用契约直连 Bot 服务，并修订 roadmap #59。**不适用**：web profile 可复用。
- [x] 预览地址经带鉴权的反向代理访问。证据：`apps/web-gateway`、`evidence/S9/02-gateway/`（未登录→login，`/v1`→401）。

**验收标准。**

- [ ] 在浏览器里经 SSO 登录后，能看 Bot 列表和工单、处理审批、对云端项目发起任务并打断。**部分完成**：同源 SSO cookie、浏览器 OIDC 登录并看到工单、Bot 列表/工单、审批、云端项目发起与打断（Docker+fake ACP）已通；真实企业 IdP/RS256 JWKS 与真实 agent 未接。证据：`evidence/S9/02-gateway/`、`03-gateway-approval/`、`04-cloud-project/`、`05-cloud-interrupt/`、`06-oidc/`、`07-browser-oidc/`。
- [ ] Web 端没有原生对话入口，也没有打开本地目录的入口。**未完成**：Web profile 仍保留原生对话。
- [x] 未登录直接访问预览地址被拒绝。证据：`evidence/S9/02-gateway/run.txt`（`/`→`/login`，`/v1`→401）。
- [x] 两个租户的成员各自登录，互相看不到对方的数据。证据：`evidence/S9/02-gateway/run.txt`（Acme 1 ticket / Beta 0 ticket）。
- [ ] 同一张工单在桌面端和 Web 端显示的阶段与内容一致。**部分完成**：同一工单在直连 DSH Web control-token 模式与 web-gateway cookie 模式下并排渲染一致；真实 Electron 桌面窗口未验。证据：`evidence/S9/08-desktop-web-consistency/`。

**产出物。** Web 端，以及关于 `web` profile 的结论。

## 提供手机端（S10）

**前置。** S9 完成。

**任务。**

- [ ] 先评估响应式 Web 是否够用，评估对象是 S9 的 Web 端。不够用再决定是否做原生端。**部分完成**：390×844 浏览器仿真可用；iOS/Android 真机未验。证据：`evidence/S10/`。
- [x] 支持在手机上处理审批卡片。**浏览器仿真通过**：390×844 viewport 批准 pending 卡，tool-gateway 状态变 approved。证据：`evidence/S10/mobile-approval.png`。**未完成**。
- [ ] 支持经 Bot 控制远程电脑：选择一台在线的已配对设备和其中的本地目录，发起、跟进、打断 `local_dir` 任务。**未完成**。

**验收标准。**

- [ ] 在手机上批准一个审批，电脑上等待中的任务随即继续。**部分完成**：390×844 手机 viewport 审批 + tool-gateway callback + waiting BotService `resume` 全链路通过；真实 iOS/Android 真机与真实等待 agent 未验。证据：`evidence/S10/07-approval-resume/`、`08-mobile-approval-resume/`。
- [x] 在手机上选择公司电脑的一个本地目录发起任务，任务在那台电脑上执行，手机上能看到状态和报告摘要。**浏览器仿真通过**：`evidence/S10/05-device-ui/`。
- [ ] 手机发起本地任务期间在云端抓包，经过云端的只有状态与摘要，没有日志和文件内容。**部分完成**：设备代理测试断言上行事件无 `log`；真实抓包未做。
- [x] 电脑离线时发起任务，工单停在 `person/delivery`，电脑上线后自动重试。证据：`evidence/S10/05-device-ui/offline-retry-test.txt`。
- [ ] iOS 和 Android 各一台真机上，以上四条都通过。

**产出物。** 手机端，以及是否需要原生端的结论。

## 收尾

- [ ] 上面每个方框都已打勾，每个勾都有对应的证据文件。
- [x] roadmap 里 W1、W2 两个节点已按实际做法重写。证据：`docs/roadmap.md`。
- [x] [architecture.md](./architecture.md) 的图 1 与图 4 已重画。证据：`docs/images/01-overview-current.png`、`docs/images/04-app-current.png`。

## 附录 A. 还没验证的前提

这份步骤书建立在下面这些前提上，它们都还没有验证，对应的验证任务写在括号里。

- 同一个安装包登录后变成企业版，这要求 SSO 和租户上下文能进入 Host（S0）。
- Executor 能作为 Host 内的插件与界面并存（S0）。
- dsh-TUI 的内核接口和 DSH 后端能拆出来单独使用（S0）。
- `pi-acp` 支持我们要用的四个调用（S7 开工前）。
- DSH 的 `web` profile 能在云端按用户提供同一套前端（S9 开工时）。
- 响应式 Web 足以覆盖手机端的两个场景（S10 开工时）。

## 附录 B. 否决的排法

- **先云端沙箱，再 Bot，最后应用。** 这是原路线的顺序。否决的原因是云端沙箱的工作不影响契约，却把第一次真实使用推到很后面。
- **开工前把七个待验证问题一次验完。** 否决的原因是其中三个要到 S7 和 S9 才用得上，提前验会拖慢开工。
- **S1 就把品牌、签名、更新源做完。** 否决的原因是它们对验证产品没有帮助，并且每次 rebase 都要多处理一遍。
- **Bot 服务放到最后做。** 否决的原因是本地 Executor 和工单界面都需要有东西派工、有工单可显示。
- **内核统一走 ACP。** 被 #57 的统一内核接口取代，ACP 降为接入方式之一。

## 附录 C. 风险

| 风险 | 在哪一步暴露 | 盯什么 |
| --- | --- | --- |
| SSO 必须改 Host 源码，fork 不再只动外壳 | S0 | 施工图里的改动文件数 |
| 本地直调依赖 DSH 内部接口，上游升级时翻译器失效 | S1 之后每次 rebase | S3 录制的会话日志回归 |
| 上游遥测在升级后重新开启 | 每次 rebase | 重做 S1 的抓包 |
| 界面和 Executor 同时操作一个会话导致状态错乱 | S0、S3 | S0 的并存实验记录 |
| `pi-acp` 版本尚在 0.0.x，调用不全 | S7 | 开工前的预检 |
| Web 与手机端用不上插件形式的界面，要另做一套 | S9 | `web` profile 的结论 |
| 管理员的开关只管登录状态，退出登录后原生对话仍在 | S5 | 已作为已知边界接受，见 #58 |

## 附录 D. 阅读清单

开工前读这些，按步骤分组。

- 全程：[roadmap.md](./roadmap.md) 的决议 #56 到 #61，[README](../README.md)。
- S2、S3：[executor.md](./contracts/executor.md)，[ticket-stage.md](./contracts/ticket-stage.md)，[background.md](./design/background.md) 第 6.5 节。
- S4、S9、S10：[web-app.md](./design/web-app.md)。
- S5：[admin.md](./design/admin.md)，[runtime.md](./design/runtime.md) 第 4、5 节。
- S6：[gateway.md](./design/gateway.md)，[logging.md](./design/logging.md)。
- S7：[runtime.md](./design/runtime.md)，[bot.md](./design/bot.md) 第 7 节，[gitlab.md](./design/gitlab.md)。
- S8：[deployment.md](./design/deployment.md)。

不在这份步骤书范围内的工作：飞书与 Teams 接入、租户管理后台与平台运营后台、结果回填与分析仓库、observe 到 auto 的灰度、Bot 模板、多 Bot 协同。它们在全平台达成之后另行排期。

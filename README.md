# SiriusX

## 产品定义

一个安装包：**DSH Desktop 薄 fork**（品牌、更新源、签名、登录入口）。

- **个人版** = 不登录。就是这个安装包本身，Host 是 DSH 自带的。
- **企业版** = 同一个安装包，SSO 登录后多出四样：
  1. Host 侧扩展（SSO、租户上下文、本地 Executor）
  2. 我们的界面插件（团队面板、审批卡片、Source 配置）
  3. 自研云端（沙箱、卷）
  4. Bot 服务（Engine、准入、网关、审计）

前两样装在桌面端里，后两样是独立的云端服务，与 DSH Desktop 无关。

## 登录即受组织管理

登录是一条分界线：登录了就受组织管理，才能用手机、Bot 和云端。

登录后桌面端有两条路让 agent 干活，两条都保留：

| | 原生对话 | Bot 派工 |
| --- | --- | --- |
| 路径 | 界面 → 本机 Host | 云端 Bot → ACP → 本机 Host，或云端沙箱 |
| 工单、阶段、审计、用量 | 没有 | 有 |
| 手机可见、可控 | 否 | 是 |
| 界面标识 | 明确标为「个人、不审计」 | — |

- 租户管理员可以关闭登录状态下的原生对话。
- 已知边界：这个开关只管登录状态。用户退出登录后就是个人版，原生对话仍在；要彻底禁止需要靠设备管理手段，不在本产品范围内。

## 工单界面

工单、Bot 列表、审批卡片、团队面板全部做成 **DSH 插件**，挂在 DSH Desktop 的界面槽位里，不另做独立应用。

待定：纯浏览器端与手机端没有本机 Host，这套插件界面在它们上面怎么提供（见待验证第 5 条）。

## 魔改纪律

- 只 fork 桌面外壳（`apps/desktop`），不改 agent 内核。
- 能用插件或独立 package 做的，不进 fork；fork 里改动的文件数控制在个位数。
- 上游单独一个 remote，我们的分支只 rebase 不 merge，每季度一次。
- 私有化客户用冻结版本，我们自己 backport 安全补丁；其余用户跟上游。

## 发版前必办

1. **审掉上游自带的遥测与日志上报。** 逐个查清默认是否开启、发往哪里，关掉或改指向我们自己的端点：`dsh-host-product-telemetry-otel`、`dsh-client-product-analytics`、`dsh-session-telemetry-otel`、`dsh-session-log-deepseek`、`dsh-anonymous-user-id`。我们承诺「内容默认只属于租户」「私有化数据不出客户网络」，漏一个就是合规事故。
2. **品牌换干净。** MIT 允许改和卖，但不授予商标。去掉官方品牌（`dsh-client-ui-brand-official`）与官方账号入口（`dsh-deepseek-account`）。
3. **企业插件打进安装包。** DSH 装插件要联网用 pnpm 拉包，内网客户做不到；所以插件随安装包分发，登录只是「启用」而不是「下载」。
4. **权限只在服务端判定。** 插件都在本机，用户有办法不登录就打开团队面板，所以界面只负责显示，鉴权与数据全部由 Bot 服务决定。

## 执行内核怎么接

内核接入标准是一套与内核无关的接口：`AgentBackend`（检测、打开会话）、`AgentSession`（历史、订阅、提交、取消、释放）、`AgentEvent`（统一事件）、`SessionCapabilities`（能力清单，缺席即不支持）。接口取自 [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI)（MIT）的 `src/agent/`，拷入本仓自己维护，不作为依赖。Executor 只面向这套接口，把 `AgentEvent` 映射成契约事件的代码只写一份。

| 批次 | 内核 | 怎么接 |
| --- | --- | --- |
| 首批 | dsh | 本地：Host 进程内直接调用（dsh-TUI 已有的 DSH 后端）。云端：经下面的 ACP 后端连 `dsh --profile acp` |
| 首批 | pi | 经 ACP 后端 |
| 备选 | codex、claude | dsh-TUI 已有实现，需改成无人值守，并确认能指向租户模型网关 |
| 其他 | — | 必须符合准入标准 |

**ACP 后端**是我们自己要写的唯一一个后端：一个符合 `AgentBackend` 的 ACP 客户端，后端标识 `acp:<agent>`。任何会说 ACP 的 agent 都经它接入。

| 接口 | ACP |
| --- | --- |
| `open` 新建 / 恢复 | `session/new` / `session/resume` |
| `submit` | `session/prompt`（一个会话同时只收一个；运行中的追加输入由后端排队，打断 = 先取消再提交） |
| `cancel` | `session/cancel` |
| `subscribe` | `session/update` |
| 状态「等待人处理」 | `session/request_permission` |
| 能力清单 | 只声明 ACP 给得出的：审批、模型、推理强度；不声明分叉、回退、历史回放 |

**准入标准**（其他内核想接入）：实现接口；如实声明能力清单；通过同一套场景测试；满足最低能力门槛（门槛待定，云端内核至少要有审批与自定义模型端点）；会话记录能放到家目录卷上（云端每次派工都是新沙箱，续跑靠卷里的会话记录）。

**已知代价**：本地直调 dsh 用的是 DSH 的内部接口（`dsh-agent`、`dsh-session`），不是对外协议，上游升级时最容易变。对策：用录制的会话日志做回归，每次升级 DSH 跑一遍；成本不可接受时，本地也改经 ACP 后端（Host 里挂 `dsh-acp`），Executor 只认接口，上层不受影响。

不在这套接口里、由 Executor 自己做的：结构化报告（`ready` / `answer` / `blocked`）、`diffStats`、workdir、预览。

Desktop 自己的界面仍然直连 Host，与 Executor 无关。

## 待验证

**开工前（S0，一周）**，只验会挡住前五步的四条：

1. Host 的认证能否以插件方式替换成 SSO，还是必须改 Host 源码。目前没有线索：`dsh-authorization` 是「插件经对话向用户索取凭据」的流程，不是应用登录，切入点只能从 `apps/desktop` 源码里找。
2. 租户上下文怎么进入 Host（Desktop 的认证 Cookie 由主进程显式携带，不进任何 Electron session）。
3. 本地 Executor 作为 Host 内的插件直接调用内核，与界面前端能否并存；同一个会话被界面和 Executor 同时操作时的行为。
4. dsh-TUI 的接口定义与 DSH 后端能否干净地拆出来（接口里引用了两个界面侧的类型；后端按规则只依赖接口目录与共享目录，未逐个文件核对）。

产出：一页施工图，列出要改的文件和改动点。

**用到之前再验**：

- 云端执行（S7）之前：`pi-acp` 是否支持我们要用的调用：建会话、恢复、取消、审批（版本尚在 0.0.x，未读过实现）。
- 云端执行（S7）之前：这套接口能否支撑契约要求的 `backgrounded` 状态与 `activity` 事件字段；经 ACP 后端接入的内核（pi、云端 dsh）在这两项上会缺什么。
- Web 与手机端开工之前：Web 与手机端怎么用上插件形式的工单界面：DSH 的 `web` profile 能否在云端按用户提供同一套前端，还是这两端另行处理。

## 图

![图 11 · 桌面端组成](docs/images/11-desktop-composition.png)

![图 12 · 登录前后](docs/images/12-login-modes.png)

![图 13 · 内核接入](docs/images/13-kernel-backends.png)

![图 14 · 执行顺序](docs/images/14-execution-order.png)

![图 15 · fork 与上游](docs/images/15-fork-branches.png)

## 文档

- [架构总览](docs/architecture.md)
- [任务步骤书](docs/plan.md)：从 fork 到全平台的逐步任务与验收标准
- [路线图与决议](docs/roadmap.md)（桌面端与内核接入见 #56、#57，登录与工单界面见 #58、#59，发版前必办见 #60，**执行顺序见 #61**）
- [Executor 契约](docs/contracts/executor.md)
- 设计文档见 `docs/design/`

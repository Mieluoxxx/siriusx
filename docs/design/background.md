# 云端 Background 设计

> 总览见 [architecture.md](../architecture.md)，落地顺序见 [roadmap.md](../roadmap.md)（节点 BG1–BG3）。
>
> roadmap #45、#47：云端执行在**执行面**进行，每个 Assignment 一个沙箱，文件靠家目录卷持久；决策与连接器凭据不进沙箱。运行形态见 [runtime.md](./runtime.md)。下文的「容器」均指这种每任务沙箱（具体技术待选型）。

## 1. 定位与边界

Background 是**执行层**：在脱离开发者本机实时干预的前提下，提供带完整编译与测试依赖的隔离环境，并在长耗时命令执行期间保持会话响应与故障自愈。

| 负责 | 不负责（归 Bot） |
| --- | --- |
| 单次执行（Assignment）的准备、运行、取消、事件回报 | 工单阶段、人类交互、回复渠道、准入 |
| workdir 与预览进程的生命周期 | 打断决策与防抖 |
| 执行内核的调用与隔离 | 全局暂停 |

对外接口：[contracts/executor.md](../contracts/executor.md)。本文描述契约背后的实现。

## 2. 计算 / 状态 / 机器三层解耦

本地 CLI 智能体合上笔记本或断网就终止；纯云端容器又难以访问本机未提交代码和内网环境。因此物理拓扑上把三者彻底分离：

1. **无状态计算（Stateless Compute）**：驱动 Agent Loop 的计算节点运行在无状态容器中，按工单并发量扩缩容或随时重启，不保留持久化业务状态。
2. **中央状态库（Central Store）**：Triggers、Threads、Decisions、Tickets、Assignments 全部从计算节点剥离，集中持久化在 Bot 服务的数据库中（按租户隔离，见 [bot.md §5.4](./bot.md#54-部署单元多租户-bot-服务)）。
3. **执行环境（Execution Host）**：
   - 标准仓库任务：独立容器 + 隔离文件系统，跑测试与构建。
   - 使用本地目录的任务（Bring Your Own Machine）：由桌面端的**本地 Executor** 执行，实现同一份 Executor 契约（`workspace.kind = local_dir`）。它主动向 Bot 建立长连接，可以间歇在线，可使用本地凭据和未提交变更。W2 实现，见 [web-app.md §6.1](./web-app.md#61-桌面端相对-web-的增量)。

本文其余部分描述**云端** Background（`workspace.kind = cloud_project`）。

**多租户隔离**：云端 Background 由所有租户共享，按 `tenantId` 隔离：

- 容器、workdir、预览进程不跨租户共享；同一宿主上的不同租户容器之间网络互不可达。
- `secretRefs` 只在本租户的密钥范围内解析；**连接器凭据不注入沙箱**，由工具网关持有（[gateway.md §5](./gateway.md#5-凭据)）。
- 文件持久靠**家目录卷**：团队卷与成员卷，沙箱内挂载为 `/home/team`、`/home/<成员>`；卷不跨租户挂载（[runtime.md §2](./runtime.md#2-隔离)）。
- 沙箱的出口网络只通租户模型网关、工具网关与白名单依赖源。
- 依赖缓存与镜像层可以跨租户共享**只读**的公共部分（如公共基础镜像），但仓库源码与项目依赖缓存按租户隔离。
- 并发槽位、Extra Slot、预览进程上限按租户配额计算。
- SaaS 访问客户自建 GitLab 时使用固定出口 IP，便于客户配置白名单；内网 GitLab 的客户走私有化部署（见 [deployment.md](./deployment.md)）。
- 私有化部署时容器运行时、镜像仓库、密钥后端均使用客户内网设施。

宿主进程重启时直接终止失联的后台任务，活跃 Assignment 标为 `lost`。Bot 发起的 `resume` 注入恢复提示，要求先检查目录、git 历史和 GitHub 状态，再执行外部操作。

## 3. 执行环境

> **决议**：原蓝图中的 `.cursor/environment.json` + VM 磁盘快照是 Cursor Cloud Agents 的平台功能。自建系统用 **Dockerfile + 每任务容器** 实现同等效果，下表保留原有三阶段的划分。

| 阶段 | 原蓝图 | 自建实现 | 执行时机 | 内容 |
| --- | --- | --- | --- | --- |
| 1. 基础镜像 | `snapshot.sh` → `snapshot` | Dockerfile 基础层 | 镜像构建时 | OS 级软件包（编译链、mise、DB 客户端）、全局 CLI |
| 2. 项目依赖 | `install.sh` → `install` | 依赖缓存层（按 lockfile 哈希做 key） | 依赖变更时 | 语言运行时与依赖、测试库与 Seed；小版本依赖升级无需重建基础镜像 |
| 3. 服务启动 | `start.sh` → `start` / `terminals` | 容器启动脚本 | 每次容器启动 | 拉起 PostgreSQL、Redis 等服务，校验依赖变更；启动伴随进程 |

### 3.1 凭据

- 镜像构建期间**不得**在磁盘上留下含真实密钥的 `.env`，否则会固化进镜像、暴露给之后的每次运行。
- 项目自己需要的运行时密钥（如测试数据库口令）通过 `secretRefs` 由宿主在运行时注入（见 [executor.md §2](../contracts/executor.md#2-传输层约定)）。代码平台、IM、邮箱等**连接器凭据不在此列**，不注入沙箱。
- 仓库的 `.env` 必须在 `.gitignore` 中。

### 3.2 持久化主机兜底

如果重度状态化的项目跨轮次重建容器时频繁崩溃，说明它更适合常驻机器，可以切换到持久化主机，直接托管 DSH。

## 4. 隔离与安全

> **注意**：`git worktree` 只隔离代码检出，**不隔离文件系统权限**。防止 Worker 越界的是每任务沙箱。

| 防线 | 作用 |
| --- | --- |
| 沙箱内的低权限用户 | Agent 不以 root 运行；沙箱只挂载本任务所属的家目录卷，读不到其他成员与其他租户的文件 |
| 容器 | 文件系统、进程可见性、网络隔离 |
| 文件沙箱（三级） | read-only / workspace-write / danger-full-access |
| 出口网络白名单 | 沙箱只能访问模型网关、工具网关与白名单依赖源，绕不过工具网关 |
| Fail-Closed 审批 | 对外动作的审批在工具网关（[gateway.md](./gateway.md)）；本机危险命令的审批由内核处理。任一审批服务故障时默认阻断；支持单次授权（One-shot grant） |
| 禁用命令 | `DSH_SUPERAGENT_BLOCKED_COMMANDS` 黑名单 |

文件沙箱只约束磁盘写入，网络访问和进程可见性靠每任务沙箱与出口网络白名单约束。

## 5. workdir 准备

- 工单首次派工且 workdir 不存在时，运行一次 **prepare command**（典型做法：`git worktree` 检出独立分支，PR 分支末段与 Ticket 短名一致），限时 10 分钟。
- 未配置 prepare command 时，Worker 在空目录启动；超时或失败则 Assignment 报告 `failed`。
- 存储引擎基线：`git worktree` + 共享 pnpm store / Docker Volume。分层 CoW 方案见 [RFC：LayerFS](./layerfs.md)。

注入到 prepare command 与执行器的环境变量：

| 类别 | 变量 |
| --- | --- |
| 目录与工单 | `DSH_SUPERAGENT_DIR`、`DSH_SUPERAGENT_NAME`、`DSH_SUPERAGENT_TICKET` |
| 禁用命令 | `DSH_SUPERAGENT_BLOCKED_COMMANDS` |
| GitHub | `DSH_SUPERAGENT_GITHUB_REPOSITORY`、`DSH_SUPERAGENT_GITHUB_ACCOUNT`、`DSH_SUPERAGENT_GITHUB_COMMIT_EMAIL`、`DSH_SUPERAGENT_GITHUB_NUMBER`、`DSH_SUPERAGENT_GITHUB_PR_HEAD` |
| 飞书 | `DSH_SUPERAGENT_FEISHU_BOT`、`DSH_SUPERAGENT_FEISHU_CHAT` |

> 变量名沿用原型的 `DSH_SUPERAGENT_*` 前缀；各 Source 通过 `environment` 声明自己的变量（见 [bot.md §5.1](./bot.md#51-统一接入sourcekind)）。

## 6. 执行内核：DSH

执行内核**可替换**（roadmap #32）：Executor 经内核适配层（§6.5）接入内核，云端 Background 与桌面端本地 Executor 可以使用不同的内核。**首个实现**是 **DeepSeek Harness（DSH，[deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)，MIT）**，§6.1–§6.4 描述的是 DSH 实现；其他内核（如 pi、自研 Agent）按 §6.5 的要求接入。

- **每个 Ticket 一个 DSH Session 和一个工作目录**（沿用原型的 `DshExecutor`）。Assignment 是 Session 中的一个或多个轮次；`cancel` 停止当前轮次，Session 保留，`resume` 在同一 Session 中继续。每个 Assignment 是一个新沙箱（roadmap #47），所以 **Session 记录必须存放在家目录卷的 workdir 旁**，新沙箱启动后从卷里恢复；不能依赖沙箱内的进程或内存常驻。
- DSH 处于 **Developer Preview**，插件接口可能有不兼容变更：**锁定版本号**，升级前在 Mock 场景与端到端用例上回归。
- DSH 自带的文件沙箱只约束磁盘写入，网络与进程隔离靠每任务沙箱（§4）。

### 6.1 模型路由

DSH 通过 `llm-pi-ai` 插件配置模型 Provider，支持内置供应商与**自定义端点**（协议：`openai-completions`、`openai-responses`、`anthropic-messages`）。凭据以 `apiKeyEnv` 引用，**每次请求时解析**，配置变更下一次请求即生效。见 DSH 文档 `docs/user/guide/providers.md`。

| 场景 | DSH Provider 配置 |
| --- | --- |
| 云端执行（`model.source = tenant`） | Provider 指向租户模型网关；`apiKeyEnv` 解析为该租户、该次 Assignment 的网关凭据 |
| 本地执行，租户模型（`tenant`） | Provider 指向租户模型网关；`apiKeyEnv` 解析为用户的 SSO 短期 Token，过期自动刷新 |
| 本地执行，BYOK（`byok`） | 用户在桌面端配置的供应商与 Key，Key 只存本机。不经过租户模型网关，Token 用量由内核适配层经 `activity` 事件上报 |
| 私有化 + 内网模型 | 租户模型网关（或直接的 Provider）指向客户内网模型，只要它支持上述三种协议之一 |

> 常见的 OpenAI 兼容网关可能拒绝 `developer` 角色或 `max_completion_tokens` 字段，需要在 Provider 上设置 `compat.supportsDeveloperRole: false` / `compat.maxTokensField: max_tokens`。

### 6.2 前台转后台

工具调用从阻塞式改为异步：`start()` 立即返回 Started，主循环继续响应，后台完成后输出作为新事件回注会话。该能力 DSH 已实现但**默认关闭，需要显式开启**。

- Router / Worker 预设：前台 Shell 满 **5 秒**转入后台。
- Worker 派生的 Subagent：**60 秒**。
- 工具层护栏在代码级拒绝：`sleep`、超过 30 秒的 Shell 超时设定、超过 5 秒的后台作业阻塞等待。

### 6.3 槽位与超时

- 单轮结束但仍有后台 Shell 或 Subagent 在运行：Assignment 处于 `backgrounded`，继续持有槽位。
- 单轮后台工作上限 **30 分钟**：到点强杀所有 Shell 作业，报告 `waiting`（列出被杀作业和仍活跃的 Subagent）。
- 报告（ready / answer / blocked / failed）后立即释放槽位并停止所有 Subagent。已登记的预览进程不受影响（见 [executor.md §7.2](../contracts/executor.md#72-预览进程)）。
- 常规槽位满载时，`CreateAssignment` 返回 `NO_CAPACITY`，由 Bot 排队。始终额外预留 **1 个 Extra Slot** 给 `priority = human` 的派工（由 Bot 在 `CreateAssignment` 中标记）。

### 6.4 时间边界

| 项 | 值 |
| --- | --- |
| prepare command 超时 | 10 分钟 |
| Router / Worker 前台转后台 | 5 秒 |
| Subagent 前台转后台 | 60 秒 |
| Shell 超时设定上限 | 30 秒 |
| 后台作业阻塞等待上限 | 5 秒 |
| 单轮后台工作上限 | 30 分钟 |
| graceful cancel 收尾 | 10 秒 |

### 6.5 内核适配层

取消任务迁移（roadmap #31）后，一个任务的会话始终留在同一个 Executor 上，不需要在云端与本地之间搬运，因此不要求所有 Executor 使用同一个内核。Executor 契约本身不依赖内核（提问即报告、续跑即新 Assignment），内核差异全部收在适配层内。

规则：

- **契约不暴露内核**：Bot 只看到 Assignment 状态、事件与报告，不知道背后是哪个内核。
- **内核按 Ticket 固定**：会话状态是各内核的私有格式，不能跨内核续跑。任务开始后不换内核。
- **同一套验收**：每个内核的适配层都必须通过 BG1 的全部 Mock 场景与 BOT1 的端到端用例，才能启用。
- **产出同一套分析事件**：每个内核的适配层必须产出相同的 `model.called`、`tool.called` 事件（[logging.md §3](./logging.md#3-数据模型一个工单一条轨迹)），否则不同内核之间无法比较。
- **不可用时降级**：某个内核未安装或适配层启动失败时，只把它标记为「不可用」并说明原因，不影响其他内核与 Bot（借鉴 OpenMausBot 的驱动层）。
- **统一的内核接口**（roadmap #57）：适配层对 Executor 暴露同一套接口：`AgentBackend`（检测、打开会话）、`AgentSession`（历史、订阅、提交、取消、释放）、`AgentEvent`（统一事件词汇，实时与回放共用）、`SessionCapabilities`（能力清单）。接口取自 dsh-TUI（MIT）的 `src/agent/`，拷入本仓自己维护。每个内核各有一个翻译器把自己的输出翻成 `AgentEvent`；Executor 把 `AgentEvent` 映射成契约事件的代码只有一份。**S0 已验**：接口可以干净拆出，但 dsh-TUI 的 DSH 后端不能原样复用；DSH 适配器由我们按公共 `Agent` / `session/event` API 自研（[spike](../spike.md)）。
- **能力缺席即不支持**：内核不支持的能力不声明，Executor 据此决定该内核能否用于某类任务，不在适配层里造假事件。下表「内核不原生支持时」一栏的兜底仍由 Executor 负责。
- **首批内核 dsh 与 pi，备选 codex 与 claude**。dsh 在本地由 Host 进程内直接调用，但经**我们自研的 in-process adapter**（桌面端是 DSH Desktop 的薄 fork，roadmap #56，本地内核固定为 dsh）；上游 DSH 不是 `AgentBackend`，不要照搬 dsh-TUI 的 DSH 后端。pi 与云端 dsh 经 **ACP 后端**接入。codex 与 claude 在 dsh-TUI 已有实现，启用前须改成无人值守并确认能指向租户模型网关。
- **ACP 后端**：我们自己写的、符合上述接口的 ACP 客户端（后端标识 `acp:<agent>`），任何会说 ACP 的 agent 都经它接入。`open` 对应 `session/new` / `session/resume`，`submit` 对应 `session/prompt`，`cancel` 对应 `session/cancel`，事件来自 `session/update`，「等待人处理」来自 `session/request_permission`。ACP 一个会话同时只收一个 prompt，运行中的追加输入由后端排队，打断即先取消再提交。能力清单只声明 ACP 给得出的项，不声明分叉、回退、历史回放。
- **其他内核的准入**：实现接口、如实声明能力清单、通过同一套验收、满足最低能力门槛（待定；云端内核至少要有审批与自定义模型端点）、会话记录能放到家目录卷上（每个 Assignment 是新沙箱，续跑靠卷里的会话记录）。
- **本地直调的代价**：dsh 的进程内后端依赖 DSH 的内部接口而非对外协议，上游升级时最容易变。用录制的会话日志做回归，每次升级 DSH 跑一遍；成本不可接受时，本地也改经 ACP 后端，Executor 只认接口，上层不受影响。
- **换内核就是重建上下文**：确需为一个任务换内核时，新内核拿到的是交接说明与工作目录，不是旧内核的内部状态（与 cindy 的做法一致）。
- **Bot 不受影响**：Bot 服务是独立的服务，不运行在任何执行内核上（roadmap #46），Router 与 Eval 直接经租户模型网关调用模型，与执行内核的选择无关。

适配层必须向 Executor 提供的能力：

| 能力 | 要求 | 内核不原生支持时 |
| --- | --- | --- |
| 会话 | 每个 Ticket 一个会话；`start`、带 `followUps` 的 `resume`；取消只停止当前轮次，会话保留 | 适配层自己持久化对话历史并重放；做不到时每次 `resume` 都按「会话丢失」注入恢复提示 |
| 结构化报告 | 每个 Assignment 以 `ready` / `answer` / `blocked` / `failed` / `waiting` 之一结束，`ready` 附 `diffStats` | 适配层提供报告工具或解析最终输出；`diffStats` 由适配层用 Git 计算 |
| 事件 | 内核输出映射为 `log` 事件；轮次状态映射为 `running` / `backgrounded` | 没有后台执行的内核不产生 `backgrounded` |
| 取消 | 进程组 SIGTERM 后 10 秒内收尾，保留 workdir 现场 | 由 Executor 升级为 SIGKILL |
| 时间边界 | 单轮后台工作 30 分钟上限（§6.3） | 由 Executor 计时强杀并报告 `waiting` |
| 模型 | 可指向自定义端点（租户模型网关），凭据在每次请求时解析 | 该内核不能用于 `model.source = tenant` |
| 安全 | 禁用命令、文件沙箱级别、Fail-Closed 审批 | 由每任务沙箱兜底（§4）；不能兜底的项使该内核不得用于云端执行 |
| 工具集 | 排除面向人类 UI 与修改宿主配置的工具 | 适配层在启动参数中禁用 |

代价：每多一个内核，就多一份适配层和一轮完整回归；Prompt（[bot.md §6](./bot.md#6-prompt-组装)）也要按内核分别调校。

## 7. 实施要点

| 节点 | 任务 | 验收 | 风险与回退 |
| --- | --- | --- | --- |
| BG1 | 可编排 Mock（场景清单见 roadmap） | `autobot run --scenario <name>` 复现全部场景 | Mock 不得在宿主执行任何命令 |
| BG2 | 沙箱基础镜像：Node.js 22.19+、pnpm 10.x、git 2.32+、git-lfs；沙箱调度、家目录卷、出口网络白名单 | 两个任务的沙箱互相看不到进程与文件；沙箱内找不到连接器凭据；访问白名单外的地址被拒绝 | 沙箱技术先用成熟的沙箱容器，契约不变 |
| BG2 | 基础镜像与依赖缓存层 | 新容器从镜像快速启动，自动完成依赖安装与服务启动，在隔离容器内跑通完整测试 | 审查构建过程，确认未生成 `.env`；私源依赖失败时排查版本锁后重建 |
| BG2 | prepare command、槽位、超时 | 超过 5 秒的长命令运行时仍能接收新输入；超过 30 分钟的任务按时强杀并报告 `waiting` | prepare 超 10 分钟或失败时报告 `failed` 并保留日志，排查 Git 锁或网络后重试 |
| BG3 | 接入 DSH（锁定版本，开启异步工具），配置租户模型网关 Provider，替换 Mock | 宿主目录对 Worker 不可写；BOT1 的端到端用例全部通过；采集 LayerFS RFC §6 基线指标 | — |

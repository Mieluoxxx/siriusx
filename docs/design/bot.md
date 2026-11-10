# 云端 Bot 设计

> 总览见 [architecture.md](../architecture.md)，落地顺序见 [roadmap.md](../roadmap.md)（节点 BOT1–BOT6）。

## 1. 定位与边界

云端 Bot 不是简单的 Webhook 聊天机器人，而是常驻在团队协作流（GitHub、飞书等 IM，以及自有应用）中、同时推进多项松散关联的异步工程任务、并严格克制发言频率的**调度中枢**。

| 负责 | 不负责（归 Background） |
| --- | --- |
| 事件接入、准入、工单（Ticket）生命周期 | 进程管理、workdir、执行内核 |
| 派工（按 `workspace.kind` 路由到云端或本地 Executor）、打断决策与防抖 | 槽位内的超时与强杀 |
| 7 阶段推导（[ticket-stage.md](../contracts/ticket-stage.md)）、回复、全局暂停 | — |
| 应用 Source 与应用 API（W0 契约） | — |

## 2. Router / Worker / Watchdog

两种极端都不行：

- 每个外部事件各起一个会话 → 上下文碎片化，多个会话重复回复。
- 单个主会话串行处理，或由重型 Team Lead 频繁拆解子任务 → 主会话成为推理瓶颈。

原型方的合成对比测试（每轮约 300 条消息、约 20 个真实工作请求，每种方案 5 轮，自报数据，未经本项目验证）：

| 方案 | p50 | p95 | 缓存读取 Token |
| --- | --- | --- | --- |
| 单会话 + Subagents（中性提示词，5 轮中 Subagent 调用 0 次） | — | 29.5 分钟 | 6.05M / 10.82M |
| Router + Worker | 12.4 分钟 | 15.7 分钟 | 23.23M |
| Router + Worker，取消跟进消息直达 Worker | 相近 | 相近 | 31.77M（Router 决策次数 +约 30%） |

Bot 由控制面的 **Bot 服务**处理（§5.4），不是 DSH 插件（roadmap #46）。Router 是 Bot 服务里的一次模型调用，用租户模型目录中的轻量模型；Worker 的执行发生在执行面的沙箱里，见 [background.md §6](./background.md#6-执行内核dsh)。下文沿用原型的 Router / Worker / Watchdog 分工，逻辑从原型移植。

Bot 服务同时是分析日志的主要来源（roadmap #53、#55，见 [logging.md](./logging.md)）：触发、Eval 裁决、阶段变化、人类输入都由它写事件；创建工单时确定并记录本工单使用的版本（Prompt、策略、模型、内核）；工单结束后继续观察 MR / PR 的结局并回填结果。

### 2.1 常驻 Router

- 全局唯一排序点、跨任务协调点、全局记忆中枢；只负责接收全渠道人类交互、评估新事件、派发工单。
- **不拆解**单任务内部步骤，不读取 `AGENTS.md` 或编码提示词，不挂 Bash，用轻量高吞吐模型。
- **批量裁决**：思考期间到达的新 Trigger 自动合并进下一次 LLM 调用，单次路由工具调用裁决所有候选（备注 ≤ 30 词）。原型方数据：负载从约 1 个/分钟升到 40 个/分钟时，单请求延迟 2.5 秒 → 3.9 秒，单决策分摊推理时间 6.4 秒 → 1.6 秒（平均批大小 2.8），单个 Router 足以支撑常规研发团队。
- **Inline & Spill + Chain of Recall**：短摘要（如消息前 50 字符）直接内联，超长内容截断并保留指针；Trigger、Thread、Assignment 各有唯一 ID，模型按 ID 逐跳回溯重建跨渠道上下文。

### 2.2 Worker

Worker 是**调度角色**：Bot 决定给它什么输入，执行发生在 Executor（云端 Background 或本地 Executor，经 `CreateAssignment`）。

- 每个工单独占一个 workdir；同一时刻最多一个非终态 Assignment。
- 工具集排除面向人类 UI 或修改配置的宿主工具（`ask_user_question`、`present`、`plugin_manager` 等），用最强推理模型。
- 不直接与用户对话：报告给 Bot，由 Bot 经 Replies 代为回复。内部可以拉起 Subagents。
- **线程订阅**：初始事件经 Router 实例化工单后，工单订阅该 Thread ID；后续跟进（PR 评审、CI 结果）走 Fast Path 直达该工单，绕过 Router。支持多对多订阅，多个工单可订阅同一个共享 PR。
- 跟进消息超出 Mandate 或属于其他工单：可以退回（Hand back）主会话一次；附着线程与本工单无关：调用 `orchestrator_thread_unrelated` 解绑。

### 2.3 Watchdog

- 定时消息驱动的独立会话，作为主架构之外的外部控制闭环。
- 处理 API 报错、状态恢复失败等基础设施故障；定期判断每个活跃 Assignment 是在取得实质进展，还是已经偏航。
- 维护者可以用自然语言询问故障原因，让它在线编辑系统提示词（`orchestrator_prompts_save`）或修改触发规则。

## 3. 准入、三态模式与 Mandate

宿主强制执行原则：白名单、准入规则、工作授权令（Mandate）完全由宿主代码控制；用户消息、评论、引用文档只是评估输入，无权篡改权限或规则（防 Prompt Injection）。

### 3.1 双路径

- **Fast Path**（确定性门控）：按来源、白名单、准入表判定强度；已订阅线程的跟进消息直达工单。
- **Slow Path**（LLM 研判）：输出 accept（生成 Mandate）/ stop / ignore / unavailable。

### 3.2 接收范围与准入表

| 来源 | 接收范围 |
| --- | --- |
| GitHub | 新 Issue、新 PR、评论、默认分支 CI |
| 飞书（BOT4） | 已配置群聊、接收 @mention 的其他群聊、私聊（DM） |
| GitLab（BOT8） | 新 Issue、新 MR、评论、默认分支 Pipeline |
| Teams（BOT7） | 已配置的团队频道、@ 智能体的对话、私聊 |
| 应用（BOT6） | 登录用户在应用（Web / 桌面 / 移动）会话中发起的任务与消息，白名单（应用身份）成员为 explicit（见 [web-app.md §2](./web-app.md#2-应用作为-source)） |

准入表按「接收范围 × 发送者身份 × 是否直接寻址智能体」把消息映射为 explicit / inferred / ignore；未寻址消息只在开启「接收全部消息」的范围内生效。

### 3.3 准入强度

| 强度 | 条件 |
| --- | --- |
| explicit | 白名单成员直接寻址智能体；在已有工单线程跟进；准入表显式指定 |
| inferred | 非白名单成员在工单线程跟进；准入表设为推断；白名单内 Bot 账号发出的消息 |
| not admitted | 未列入白名单的 Bot；准入表忽略项；off 模式下的所有推断项 |

护栏：

- Bot 账号**永远只能**产生 inferred 候选，不能发起 explicit 请求，也无权停止工单；主会话的直接接受操作在代码层拒绝任何非 explicit 的 Trigger。
- 用普通人类账号运行的自动代码审查工具，须在团队提示词中声明为自动审查账号，且每 PR 最多响应 3 轮。

### 3.4 三态接受模式

| 模式 | 行为 |
| --- | --- |
| off | 所有 inferred 触发器直接拒绝 |
| **observe**（默认） | 对 inferred 候选做完整规则评估；匹配则记为 ignore 并标记 "would accept"，不执行 |
| auto | 匹配启用规则的 inferred 候选自动获批并派工 |

- 新团队或新增主动规则时，从窄白名单 + observe 起步；"would accept" 的模拟裁决验证准确后才切到 auto（BOT3）。
- 策略版本一变更，立即作废所有在途 Eval，按新版本重新入队。

### 3.5 Mandate 生命周期与恢复重验

- 只有三种操作可修改 Mandate：accept 创建、人类 stop 撤回、恢复重验失败吊销。
- 已结束的工单保留 Mandate。人类（Bot 和 CI 无权恢复）在原线程发消息唤醒工单时强制重验：
  - Source 是否仍在监听该线程；
  - inferred 工单是否仍处于 auto 模式，所匹配规则是否仍启用；
  - 发送者是否仍在白名单，强度是否未降级。
- 重验失败：工单保持结束，消息转交 Eval 重新走门控。

## 4. 人类指令与打断

| 入口 | 动作 |
| --- | --- |
| Issue / PR 评论 `/stop` | `CancelAssignment{reason: user_stop}`，撤回 Mandate |
| Issue / PR 评论 `/resume` | 以新 Assignment 续跑 |
| 运行中追加评论 | 按 [executor.md §5.3](../contracts/executor.md#53-打断防抖按阶段区分) 防抖后打断续跑 |
| 应用会话 | 停止 / 续跑按钮与评论指令等价；运行中追加消息同样走防抖打断 |
| 本地 CLI | 与评论指令等价，供操作员使用 |

只有人类输入触发打断；CI / Bot 输入暂存到本次 Assignment 结束后并入下一次 `resume`。

## 5. 单写者 Engine

通过单向模块依赖和单写者规则保证并发下的状态一致。

- **组合根 Runtime**（`src/app/runtime.ts`）：不含领域规则，只负责锁定 `<stateDir>`、打开 Store、执行 Setup 探测，并通过窄接口（`ExecutorHost`、`AssessorHost`、`SourceHost`）组装模块。
- **Engine**（`src/core/engine.ts`）：Triggers、Threads、Decisions、Tickets、Assignments 的唯一合法写入者。Source 插件只能经 `SourceContext` 写自己的读取位置和线程元数据；配置与历史只由 Settings 写入。
- Engine 方法全部同步，纯函数、零 I/O，在单一事务内完成状态变更并把外部工作入队；事务提交后由 Passes 调度器（每 2 秒一轮）和唯一写回执的 Outbox 异步执行。
- 严格幂等：同一 Trigger 重复接收只生成一个 Ticket。
- 存储：Bot 服务的数据库，每个租户独立的数据空间与加密密钥；单写者靠数据库租约保证，见 §5.4。
- **Executor 注册表**：云端 Background 常驻注册；桌面端的本地 Executor 上线时经长连接注册，按 `deviceId` 寻址。派工时按 `workspace.kind` 选择 Executor；目标设备离线时得到 `EXECUTOR_OFFLINE`，工单进入 `person/delivery`，设备上线后重试。执行位置在工单创建时选定并写入工单，之后的每次派工都用同一个 `workspace`，不改派到另一种 Executor（roadmap #31）。

| 组件 | 依赖 | 职责 |
| --- | --- | --- |
| Intake | Tickets | 存储去重、订阅扇出 |
| Evals | Tickets | 线程批次评估、门控强度计算、超时重排 |
| Tickets | Replies | 工单生命周期、关联 PR 关闭判定（`followsDone`）、恢复重验、workdir 续租与销毁 |
| Assignments | Tickets、Replies | 派工（含 `priority`）、事件对账、打断防抖、进度与人类提问 |
| Replies | — | 按权限规则经 Outbox 分渠道发送确认、回答、结果、提醒 |

### 5.1 统一接入：SourceKind

> 采用 [dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype)（MIT）的 Source 统一接入模型，见其 `docs/001-domain.md`、`007-architecture.md`、`008-cookbook.md`。

每个平台是一个 **Source kind**（插件），核心层只认 Trigger / Thread / Channel，不认识具体平台。一个 kind 是可复用的实现；一个 Source **实例**是该 kind 的一份配置（是否运行、监听什么）。

**SourceKind 接口**：

| 部分 | 必选 | 职责 |
| --- | --- | --- |
| `kind` / `title` / `description` | 是 | 标识与展示名（中英） |
| `schema` / `fields` | 是 | 配置校验；`fields` 自动生成应用 Settings 里的配置表单 |
| `health` | 是 | 声明自己占用的健康条目，供控制台与巡检（Exit 2）使用 |
| `scope(meta, config)` | 否 | 判定某个 Trigger 是否在监听范围内（`listened`），是否观察未寻址消息（`observed`），对应准入表哪一行（`row`）。只依赖 `meta` 与配置，恢复重验时复用 |
| `channel` | 否 | 回复的写端：`allowed`（地址是否仍可投递）、`send`（**幂等**，以 `message.id` 为幂等键；返回 `sent` / `gone`，其他失败抛错由 Outbox 重试，5 秒起翻倍至 300 秒）、`link`（控制台显示的链接） |
| `threadContext` | 否 | 给 Eval 读取 Thread 上下文（分页、根消息、被回复消息、图片） |
| `find(query)` | 否 | 平台特有引用的搜索（如消息 ID、URL、`#12`、`!12`） |
| `policy` | 否 | 该 Source 在 Policy 中的部分：`allowed`（能发起工作的人，**用本平台的 ID**）、`bots`（可产生 inferred 候选的 Bot）、`rows`（准入表行）、`sync`（同步成员，如飞书群成员） |
| `environment` | 否 | 声明注入给 Executor 的环境变量（前缀 `DSH_SUPERAGENT_<KIND>_`，来自其他 Source 的工单取空值，**不得包含凭据**） |
| `repliesTo` | 否 | 消息回复关系，用于在跟进输入中展示被回复的原文 |

**Trigger 统一结构**：

```ts
{
  id,          // key(kind, 平台消息 ID)：稳定 ID，重复接收只生成一个 Ticket；编辑视为新事件时把版本号拼进 ID
  source,      // kind
  threads,     // [{ source, id }]，第一个为主 Thread（拥有 Eval），其余只提供关联上下文
  actor,       // { source, id }：平台原生 ID
  human,       // Bot / CI 为 false
  addressed,   // 'mention' | 'direct'，仅在确实寻址智能体时设置
  at, text, url,
  channel,     // { source, thread, address }：回复投递地址；同一工单的消息按 thread 顺序投递
  meta,        // 平台特有字段只放这里，核心层不读
}
```

**SourceContext**（插件能拿到的窄接口）：`receive`（交给 Engine）、`state`（读取游标，必须在 `receive` 之后推进）、`threads.describe`（写自己 Thread 的元数据）、`tickets.bindThread` / `threadClosed`（唯一能影响工单的途径）、`notify`（经 Outbox）、`report`（上报健康）、`commands`、`ready` / `configured` / `problem`（Setup 状态）。

**插件生命周期**：注册 kind → 等待 Setup 就绪 → 循环读取（或接收推送）→ 每条消息独立容错 → 连续 3 次失败上报 `error` → 卸载时中止并等待循环结束。

**新增一个 Source 的检查清单**（沿用原型 008）：映射 Trigger / Thread / actor / Channel 地址 / 接收范围 → 写 kind → 事件转 Trigger（稳定 ID，丢弃自己的消息）→ `scope` → 幂等的 Channel → Thread 上下文 → Policy 部分 → 环境变量 → 插件入口与循环 → 注册 → 测试。

### 5.2 身份：不跨 Source 映射

沿用原型的领域规则：

- **人不是领域概念**。Trigger 只携带平台给出的 actor ID；白名单是**各 Source 自己的** Policy 部分，用该平台的 ID。
- **不同 Source 的身份永远不做映射**。同一个人在 GitLab、飞书、Teams、应用里各有账号，这种对应关系只作为提示文本（`identities` 技能）供 Agent 阅读，不参与准入判定。
- 因此每个 Source 各自维护 `allowed` 名单；应用 Source 的名单使用应用登录身份（SSO 用户 ID）。

### 5.3 已接入与计划接入的 Source

| Source | 角色 | 接入方式 | 节点 |
| --- | --- | --- | --- |
| GitLab | 代码平台：Issue、MR、评论、Pipeline | 支持 gitlab.com 与**企业自建实例**（每个租户配置自己的 `host`）。SaaS 下以 Webhook 为主（每租户独立回调地址与 Secret Token），轮询 REST API 兜底补漏；Bot 身份用租户提供的 Group / Project Access Token 或专用 Bot 用户。详见 [gitlab.md](./gitlab.md) | BOT8 |
| 飞书 | IM | `lark-cli`；事件长连接，无需公网入口 | BOT4 |
| Microsoft Teams | IM | Bot Framework 推送（需公网 HTTPS 与 Entra ID 应用注册）→ 入站队列 → Source 读取 | BOT7 |
| 应用 | Web / 桌面 / 移动 | 进程内；应用会话即 Thread | BOT6 |
| GitHub | 代码平台 | **保留**。原型已有实现，但原型用个人账号 + `gh` 轮询 Notifications；SaaS 下改为每租户安装 **GitHub App** + Webhook | BOT1 |

### 5.4 部署单元：多租户 Bot 服务

> roadmap #45、#46。运行形态的完整说明见 [runtime.md](./runtime.md)。

**Bot 是数据，不是进程**。Bot（Router、Eval、Engine、Sources、Outbox、Prompts 的配置与状态）存放在数据库里，由控制面的一组无状态 **Bot 服务**实例按事件加载处理。Bot 服务是我们自己的服务，逻辑从原型移植；**不再构建为 DSH 插件**，DSH 只作为执行内核出现在沙箱里。

```text
控制面：入口网关（Webhook 按租户路由、SSO）· Bot 服务 · 工具网关 · 租户模型网关 · 管理面
   │ Executor 契约
   ├─► 执行面：云端 Executor → 每任务沙箱 + 家目录卷
   └─► 用户电脑：本地 Executor（主动经入口网关建立长连接，SSO 鉴权并已配对）
```

| 方面 | 规则 |
| --- | --- |
| 单写者 | 每个 Bot 的 Engine 同一时刻只由一个 Bot 服务实例处理，靠**数据库租约**保证；实例崩溃后租约到期，由另一个实例接手 |
| 租户边界 | 每个租户独立的数据空间与加密密钥；一次处理只绑定一个租户身份，Policy、Source 实例、Prompt 版本、记忆都按租户与 Bot 存放 |
| Source 实例 | 每个 Bot 有自己的 Source 配置；入站 Webhook 由入口网关按回调地址或签名找到租户与连接 |
| 凭据 | 连接器凭据由工具网关持有（[gateway.md §5](./gateway.md#5-凭据)），Bot 服务与执行沙箱都拿不到原始值 |
| 应用鉴权 | SSO（OIDC / SAML），每个租户配置自己的 IdP；应用 Source 的白名单使用该租户的 SSO 用户 ID |
| 模型 | 租户模型目录由管理面维护；Router、Eval 与云端执行都经租户模型网关使用。本地执行可用租户模型、BYOK 或本地模型；租户可禁用 BYOK，Bot 在派工前校验 |
| 配额 | 并发 Assignment、Extra Slot、预览进程数按租户计算（契约中的 `tenantId`）；每个成员的个人 Bot 数量有上限 |
| 审计 | 准入裁决、Mandate 变更、人类指令、配置变更按租户留存，并汇总到管理面 |
| 版本 | Bot 服务统一发版；新行为用按租户的功能开关灰度。执行内核的版本按租户锁定 |
| 自建 GitLab 的可达性 | 自建 GitLab 对公网开放时走 SaaS；位于客户内网、不对外开放时，**整套系统私有化部署进客户内网**，不做 SaaS 穿透连接器 |

取舍：放弃了「原型几乎原样复用」，换来的是 Bot 数量不受进程数限制、控制面一次升级、决策与凭据不和 Agent 待在同一个环境里。移植工作量取决于原型里的逻辑与 DSH 插件机制耦合多深（[runtime.md §8](./runtime.md#8-待定问题) 第 4 题）。

### 5.5 需要从原型中去除的平台耦合

原型自述有些通用模块直接引用了 GitHub / 飞书（`007-architecture.md` 的 Source-specific dependencies）。自研时这些要做成 Source 能力，而不是写死在核心层：

| 原型中的耦合 | 处理 |
| --- | --- |
| PR 绑定（`readPull` / `claimPull`）、工单卡片的 `pullOf`、合并 / 关闭通知 | 抽象为代码平台 Source 的「变更请求」能力（GitLab MR / GitHub PR），对应契约中的 `report.changeRequest` |
| Outbox 中的飞书字数上限 | 改为 Channel 自己声明消息长度上限（Teams 同理） |
| Setup 只探测 GitHub 与飞书账号 | 每个 kind 声明自己的 Setup 探测项 |
| 内置 Skill 只为 GitHub 与飞书注册 | 每个 kind 可附带自己的 Skill |

## 6. Prompt 组装

BOT1 先做第 1、2、8 层（共享 / 角色 / 策略），其余在 BOT5 补齐。

| 层 | 内容 |
| --- | --- |
| 1 | 共享指令与角色定义：`runtime/shared`、`runtime/orchestrator`、`runtime/worker` |
| 2 | 团队可编辑区块：**Hold / 沟通规范**（默认首行声明 "This is by an automated agent, not a human"）、**Ticket Scope / 工单边界**、**Delivery Requirements / 交付证据**、自动合并行数阈值、提交者邮箱 |
| 3 | 订阅与回复规范：`runtime/subscriptions`、`runtime/replies` |
| 4 | 主会话派工 `runtime/dispatch` 或 Worker 作业 `runtime/work` |
| 5 | 准入提示词 `runtime/admission`（仅主会话） |
| 6 | 交接指令 `runtime/handoff/*` |
| 7 | 运行时环境模板 `runtime/environment`（填充 `{variables}`） |
| 8 | 动态策略模板 `runtime/policy`（无规则时为 `runtime/policy/none`），每次请求填充 `{version}`、`{mode}`、`{rules}` |

效力优先级（高 → 低）：

宿主与工具代码强制事实 > 内置与生成区块 > 主动工单匹配的规则 > 团队自定义区块与 Skills（如说明同一人在各平台账号的 `identities` 技能，仅供 Agent 阅读，不参与准入）> 外部消息与文档文本

### 6.1 发言约束

- Router 路由备注 ≤ 30 词；IM 单条回复 ≤ 100 词。
- Worker 每次报告只提一个具体问题。
- 自动代码审查交互每 PR 最多 3 轮。

## 7. 运维：进程守护与故障自愈（BOT2）

> roadmap #46 之后 Bot 服务是普通的多实例服务，启停与存活由服务编排负责，不再用 tmux 与 Profile 脚本。下文的**巡检语义**（四种退出码对应的判定与处置：正常 / 可重启修复 / 外部故障 / 缺人工配置）继续适用，改为按租户、按 Bot 的健康状态上报；脚本细节是原型的做法，仅作参考。

服务脚本管理单个 Profile（默认 `superagent`，不干扰其他 tmux 会话），配合**外部**主 Profile 中的每小时巡检形成自愈闭环。巡检不得配置在被守护的服务自身内部。

**启停**：

- `start`：在专属 tmux 会话启动，最长等 1 分钟确认就绪（`/orchestrator/api/state` 的 runtime 为 `ready` 或 `paused`），拒绝重复实例，清除手动停止标记。`.artifacts/` 保留最新 20 份启动日志。
- `stop`：先写手动停止标记（`.artifacts/control/profiles/<profile>/` 下 `manually_stopped: true`），再给活跃 Executor 最长 5 分钟收尾（单 Worker 优雅等待 10 秒）。即使优雅关闭超时，外部监控也会尊重停止意图，不误判为崩溃。

**巡检**：`status` 退出码

| 退出码 | 判定条件 | 性质 | 处置 |
| --- | --- | --- | --- |
| 0 | 主进程唯一，runtime 为 ready 或 paused | 正常 | 静默跳过 |
| 1 | 进程未运行、存在多个实例、健康接口不可达或 runtime 级错误 | 可通过重启修复 | 无 `manually_stopped: true` 时自动 `--respect-stop restart`；仍失败则读取最新日志排障 |
| 2（`PART_ERROR`） | runtime 正常，但外围子系统（Source 轮询、策略同步 `sync:<source id>`）报 error | 外部故障，重启无效 | 不得自动重启；告警人类，到应用的 Source / Overview 页排查凭证与网络 |
| 3（`SETUP_WAITS`） | 服务在运行，但 `setup.problem` 或 `setup.feishuProblem` 非空 | 缺人工配置，重启无效 | 不得自动重启；通知人类到 Settings → Deployment 点 Check again，或补全账号与仓库绑定 |

## 8. 个人 Bot（云端）

> Bot 的两种形态（团队 Bot 偏调度器、个人 Bot 偏联系人）与记忆见 [runtime.md §6–§7](./runtime.md#6-bot-的两种形态)；对外部系统的写入类操作经工具网关与审批卡片，见 [gateway.md](./gateway.md)。

> 个人 Bot 是 Bot 服务中的记录，成员可以自行创建多个；它的云端任务使用该成员的家目录卷，团队 Bot 使用团队卷。**桌面端不运行 Bot**（roadmap #33）。详见 [runtime.md](./runtime.md)。

### 8.1 Bot 模板（专家）

后续上线「专家」：创建 Bot 时（团队 Bot 由租户管理员创建，个人 Bot 由成员自己创建）可以**选择模板**，一键得到一个预配置好的 Bot。

模板只包含**配置**，不包含代码，也**不携带凭据、对话、记忆与权限**；导入后规则保持 observe、例行任务暂停、技能默认关闭，由创建者逐项开启（roadmap #43）。模板内容都是 Bot 服务已经支持的可配置项：

| 模板内容 | 对应机制 |
| --- | --- |
| 角色与工作方式 | Prompt 第 2 层的团队可编辑区块（Hold / Ticket Scope / Delivery Requirements），见 §6 |
| 主动规则与默认接受模式 | Policy 中的规则；默认仍为 observe |
| 技能 | Skills |
| 建议接入的渠道与代码平台 | Source 实例的配置骨架（凭据由用户自己填写） |
| 推荐模型 | 模型目录中的条目（受租户模型来源管控约束） |

| 方面 | 规则 |
| --- | --- |
| 发布方 | **官方「专家」**，以及**租户管理员**添加的租户内模板；租户模板只对本租户可见 |
| 版本 | 模板有版本号。Bot **锁定创建时的模板版本**，模板发布新版不会自动改动已创建的 Bot |
| 升级 | 用户可以**让 Bot 自己升级**：Bot 读取新旧模板的差异，与自己当前的配置（含用户改过的部分）合并，生成新配置 |

升级的护栏：

- 团队 Bot 由租户管理员发起升级，个人 Bot 由其所有者发起升级。
- Bot 先给出变更摘要，**说明哪些用户改过的内容会被覆盖或保留**，发起者确认后才生效。
- 升级前的配置完整保留，可以一键回滚。
- 升级改动 Policy 时，策略版本递增，在途 Eval 按新版本重新评估（§3.4）。
- 升级不能突破租户管控：模板要求的渠道、模型来源如果被租户禁止，对应部分不生效，并在摘要中说明。

### 8.2 多 Bot 协同（参考，未排期）

> 原蓝图中的 DS-Bot / Orca 能力。个人 Bot 已取消（roadmap #33），本节只作参考保留，不排期。

- 首次启动即可与最高权限的 Chief Bot 对话，一句话创建带独立角色、专属模型和 Markdown 持久记忆的成员 Bot，并组建群聊；SQLite FTS 检索聊天记录。
- 群聊中 Admin Bot 默认处理人类消息，通过 @mention 把子任务异步移交给成员 Bot；成员 Bot 在各自会话中并行调工具，完成后回帖闭环。
- 群聊记忆严格隔离，群外 Bot 和单聊不可读；Bot 引入本地 MCP 命令须人类显式审批；能力库增删仅限人类或 Main Bot。
- 大型跨阶段工程可用 **Goal 模式**或 **Orca（Planner-Worker-Reviewer）**：Planner 与用户对齐完成标准并划分阶段，多个 Worker 并行执行，Reviewer 核验交付证据后才推进下一阶段。

## 9. 实施要点

| 节点 | 任务 | 验收 | 风险与回退 |
| --- | --- | --- | --- |
| BOT1 | 从原型移植逻辑的多租户 Bot 服务（先跑通一个租户、一个 Bot）；GitHub Source（GitHub App + Webhook）；Engine；白名单、Bot 列表、准入表，模式设为 observe；3 层 Prompt，在 Hold / Communication 中登记所有自动审查账号；指令与打断防抖；派工到 Mock | `core-engine` / `policy` / `sources` 测试全绿；未授权用户与未列名 Bot 全部被拒；已订阅线程的跟进走 Fast Path 且不触发新 Eval；在真实数据流中跑通派工 → 回报 → 打断 → resume | 策略误判时立即修改 Policy（自动递增版本、作废在途 Eval 并重排） |
| BOT2 | 守护脚本与每小时巡检 | 模拟崩溃（Exit 1）时自动拉起并恢复中断的工单；Exit 2 / 3 只告警 | Agent 产生噪音时收紧提示词，或切回 observe / Pause processing |
| BOT3 | 审查 "would accept" 记录，逐条切 auto | 切换标准（准确率、观察时长）待 BOT1 运行一段时间后确定 | 一键切回 observe |
| BOT8 | GitLab Source（按 §5.1，支持自建实例） | Webhook 按租户识别；MR 绑定走 `changeRequest` 能力；SaaS 与私有化两种部署下都能接入 | 内网实例走私有化部署 |
| BOT4 | 飞书 Source（按 §5.1） | 复用 Engine 与准入门控，不改契约 | — |
| BOT7 | Teams Source（按 §5.1） | Bot Framework 推送经入站队列进入 Source；回复幂等 | 公网入口与 Entra ID 应用注册由客户 IT 配合 |
| BOT5 | Prompt 补全至 8 层 | 按需逐层追加 | 默认提示词升级时，在应用 Settings 的冲突对比中显式选择 |
| BOT6 | 按 W0 契约实现应用 API；按 §5.1 接入应用 Source | 应用与 GitHub 发起的任务走同一套准入与打断逻辑；应用联调通过 | — |

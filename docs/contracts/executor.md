# Executor 契约

这是 SiriusX Executor 与 Bot 之间的冻结契约。当前版本：`0.1.0`。

## 版本状态

- `executor-v0.1.0`：正式冻结。已覆盖本地/云 Executor、分配状态机、事件流、报告、workdir、预览 TTL、取消与错误码；通过真实 DSH Web Host SIGKILL/重启与真实模型断线场景。
- 之后修改 `packages/contracts/src/executor.ts` 或 `schema/` 必须走变更评审。

# Executor 契约（Bot ⇄ Executor）

> 状态：草案 v0 + S2 补齐。M1（真实数据流跑通）前允许修改，之后冻结。
>
> 唯一源头：`packages/contracts/src/executor.ts`（TypeScript + zod），导出 JSON Schema 供非 TS 调用方使用（`packages/contracts/schema/`）。本文与代码不一致时以代码为准，并同步修正本文。

## 1. 边界

| 归属 | 负责 | 不负责 |
| --- | --- | --- |
| **Executor**（云端 Background / 桌面本地） | 单次执行（Assignment）的准备、运行、取消、事件回报；workdir 与预览进程的生命周期 | 工单阶段、人类交互、回复渠道、准入 |
| **Bot（Router / Engine）** | 工单（Ticket）生命周期、7 阶段推导、派工、打断决策、回复、全局暂停 | 进程管理、执行内核 |

- 一个 Ticket 在生命周期内依次产生 N 个 Assignment，共享同一个 `workdirKey`。
- 契约有两种实现，按 `workspace.kind` 路由：

  | `workspace.kind` | 实现 | 使用方 |
  | --- | --- | --- |
  | `cloud_project` | 云端 Executor（执行面：每个 Assignment 一个沙箱，挂载家目录卷，roadmap #45、#47） | Web；桌面端打开云端项目空间时 |
  | `local_dir` | 本地 Executor（运行在用户机器上） | 桌面端，W2 实现 |

  两种实现的方法、状态机、事件语义完全相同。Bot 维护 Executor 注册表：云端 Background 常驻；本地 Executor 由桌面端上线时注册，按 `deviceId` 寻址。
- **执行位置在任务开始时选定，之后不可变**（roadmap #31）：同一个 Ticket 的所有 Assignment 使用同一个 `workspace`（`kind` 相同；`cloud_project` 的 `projectId`、`local_dir` 的 `deviceId` 与 `path` 也相同）。Bot 不得为同一个 Ticket 换执行位置派工；Executor 收到与该 `workdirKey` 首次派工不一致的 `workspace` 时返回 `WORKSPACE_MISMATCH`。
- **客户端内容不上传**：契约中没有把 `local_dir` 的文件传给云端 Background 的方法，也不提供 workdir 在两种实现之间的迁移。两种执行位置之间的内容只经代码平台流转。
- 7 个工单阶段由 Bot 推导，见 [ticket-stage.md](./ticket-stage.md)，**不出现在本契约中**。
- **多租户**：所有请求都携带 `tenantId`。Executor 按租户隔离沙箱、家目录卷、workdir、`secretRefs` 的解析范围、预览进程与槽位配额；`workdirKey`、`previewId` 只在租户内唯一。跨租户访问一律视为不存在（返回 `*_NOT_FOUND`，不泄露其他租户的资源是否存在）。

## 2. 传输层约定

- 契约按**跨网络异步消息**设计；初期实现走同机 HTTP / UNIX Socket。
- 鉴权凭据只在传输层（HTTP Header / Socket 握手）传递，**不进入任何 payload**。
- payload 中凭据只允许以 `secretRefs`（引用名）出现，由宿主在执行时注入。**连接器凭据**（代码平台、IM、邮箱、SaaS）不注入 Agent 进程，由工具网关持有（roadmap #41，见 [gateway.md](../design/gateway.md)）。
- `cloneUrl` 不得内嵌凭据；代码平台的访问经工具网关代理，凭据不进入沙箱，也不以 `secretRefs` 注入。
- **团队 Bot 的工单只能使用 `cloud_project`**；`local_dir` 只接受设备所有者的个人 Bot 派工（roadmap #51），否则返回 `WORKSPACE_MISMATCH`。
- 本地 Executor 位于 NAT 之后，由它**主动向 Bot 建立长连接**并在连接上接收调用，Bot 不直接连接用户机器。
- **断线不等于 `lost`**：长连接断开只是传输层状态，Assignment 状态不变；Executor 在本地缓存事件，重连后按 §3.1 对账。
- 每个请求携带 `traceId`，贯穿 Bot → Executor → 事件流。
- **模型**：payload 只传 `model.source` 与 `model.id`，不传模型凭据。

  | `workspace.kind` | 允许的 `model.source` | 凭据 |
  | --- | --- | --- |
  | `cloud_project` | `tenant`：租户模型目录中、对该 SSO 用户开放的模型 | 云端 Executor 经租户模型网关解析，用户不可见 |
  | `local_dir` | `tenant`：同上，经租户模型网关调用 | 本地 DSH 以用户的 **SSO 短期 Token** 访问租户模型网关；上游供应商的 Key 留在服务端，**不下发到设备** |
  | `local_dir` | `byok`：用户在本地配置的模型 | 只存在用户设备上，**不上传、不进入事件与日志** |
  | `local_dir` | `local`：本机运行的模型（如 Ollama） | 无需上游凭据 |

  租户管理员可以禁用 `byok`；被禁用的来源由 Bot 在派工前拒绝（`MODEL_SOURCE_DISABLED`），不会下发到 Executor。

## 3. Assignment 状态机

```text
preparing ──► running ◄──► backgrounded
                 │
                 ▼
             reported ── report.kind ∈ { ready | answer | blocked | failed | waiting }

任意非终态 ──► cancelled      CancelAssignment 完成
任意非终态 ──► lost           宿主重启 / 进程失联
```

| 状态 | 含义 | 终态 |
| --- | --- | --- |
| `preparing` | 准备 workdir（worktree 检出、容器启动），限时 10 分钟，超时转 `reported{failed}` | 否 |
| `running` | 内核推理 / 工具调用中 | 否 |
| `backgrounded` | 本轮对话已结束，但仍有后台 Shell / Subagent 运行，继续占用槽位 | 否 |
| `reported` | 已产出报告，Assignment 结束，释放槽位 | 是 |
| `cancelled` | 被取消（人类打断、`/stop`、Bot 撤销 Mandate 等） | 是 |
| `lost` | 宿主重启或失联，Executor 无法确认结果 | 是 |

**终态即结束**：Assignment 进入终态后不再变化。续跑永远是新的 Assignment。

### 3.1 断线、宽限期与对账

Assignment 状态枚举不变。断线是 Bot 侧 Executor 注册表上的连接状态（`disconnectedAt`），不是 Assignment 状态。

| 阶段 | 处理 |
| --- | --- |
| 断线 | Bot 启动宽限期计时：`local_dir` **15 分钟**，云端 Background **1 分钟**。Executor 继续执行，事件缓存在本地 |
| 宽限期内重连 | Bot 对所有非终态 Assignment 调用 `GetAssignment`，再从 `lastSeenSeq + 1` 调用 `StreamEvents` 补齐事件。已跑完的直接推进工单；仍在运行的继续订阅；本地进程确实已丢失的，由 Executor 回报 `lost` |
| 宽限期超时 | Bot 在自己的记录中把 Assignment 结算为 `lost`。该 Executor 之后重连时，Bot 先补发 `CancelAssignment{mode: kill}` 清理残留进程，再允许新的派工 |
| 结算后的迟到事件 | 记录到日志与审计，**不推进工单**；后续 `resume` 的恢复提示要求 Agent 先检查 workdir 的实际状态 |
| 断线期间的打断 / `/stop` | Bot 暂存待下发的 `CancelAssignment`，重连后立即下发；人类选择「强制终止」时 Bot 直接结算为 `lost`，等设备重连后补发 kill |
| 工单阶段 | 宽限期内保持 `working`，不在阶段之间跳动；应用根据 Executor 在线状态另行显示「设备离线，等待重连」 |

### 3.2 报告类型

| `report.kind` | 含义 | Bot 侧对应阶段 |
| --- | --- | --- |
| `ready` | 交付完成（通常附 MR / PR） | 有待审查产物时 `person/review`，否则 Bot 直接结束工单，见下方 |
| `answer` | 需要人类回答**一个**具体问题 | `person/answer` |
| `blocked` | 无法继续，需要人类处理外部条件 | `person/blocked_failed` |
| `failed` | 执行失败（含 prepare 超时 / 失败） | `person/blocked_failed` |
| `waiting` | 未完成，等待新输入或下一轮（如单轮后台 30 分钟上限触发） | `idle` |

**`ready` 的结束判定**（Bot 侧纯函数）：

| 条件 | 处理 |
| --- | --- |
| 有 `changeRequest`，或 `diffStats.filesChanged > 0`，或该 workdir 有存活预览（`ListPreviews`） | **不结束**，进入 `person/review`，保留 workdir 与预览 |
| 以上都没有（纯问答、排查、分析） | Bot 直接结束工单并调用 `DestroyWorkdir` |

`person/review` 中人类的处理方式：

| 工作区 | 可选操作 |
| --- | --- |
| `cloud_project` 且无 MR / PR | **补充输入**（如「提交 MR」，触发 resume）或**丢弃**。云端改动只有推送后才能保留，因此不提供「直接接受」：工单结束即回收 workdir，未推送的改动会丢失 |
| `cloud_project` 有 MR / PR | 在代码平台审查、合入或关闭；MR / PR 合入或关闭后工单结束 |
| `local_dir` | **接受**（改动已在用户目录中）、补充输入或丢弃 |

`diffStats` 相对 `baseRef` 统计（含已提交与未提交的改动）。

## 4. 方法

| 方法 | 说明 |
| --- | --- |
| `CreateAssignment` | 下发一次执行。`assignmentId` 即幂等键，重复下发返回已存在的 Assignment，不启动第二个 Worker。`priority = human`（由人类消息触发）可以占用预留的 Extra Slot；常规槽位满时 `normal` 返回 `NO_CAPACITY`；槽位、Extra Slot 均按租户计算 |
| `GetAssignment` | 快照查询（按 `tenantId` + `assignmentId`），用于断线后对账 |
| `CancelAssignment` | 取消，语义见 §5 |
| `StreamEvents` | 按 `tenantId` + `assignmentId` 从 `fromSeq` 订阅事件，保留与截断规则见 §6 |
| `ListPreviews` | 列出某 `workdirKey` 下存活的预览进程，见 §7 |
| `StopPreviews` | 关闭某 `workdirKey` 下指定或全部预览进程 |
| `DestroyWorkdir` | 清理 workdir（worktree + 容器），级联关闭其全部预览进程；该 workdir 上存在非终态 Assignment 时拒绝（`WORKDIR_BUSY`）。幂等 |
| `TouchWorkdir` | 续期 workdir 租约，防止被 TTL 兜底回收，见 §7.1 |
| `ListFiles` | **只读**：列出 workdir 中某个目录的条目，见 §7.3 |
| `ReadFile` | **只读**：读取 workdir 中某个文件的内容，见 §7.3 |

## 5. 取消与打断

### 5.1 CancelAssignment 语义

- **幂等**：对已处于终态的 Assignment 调用，直接返回当前状态，不报错。
- `graceful`：向 Worker 进程组发送 SIGTERM，给予约 10 秒收尾，超时升级为 `kill`。
- `kill`：直接 SIGKILL 进程组。
- 两种模式都**保留 workdir 现场**（未提交修改、Git 状态），结束后都回报 `cancelled`。
- 随 Assignment 一起终止：前台 / 后台 Shell、Subagent。**不终止**：已登记的预览进程（§7）。
- `reason`：`user_interrupted | user_stop | mandate_revoked | operator`。

### 5.2 打断续跑（人类在运行中追加输入）

```text
人类追加评论
  → Bot: 合并窗口内的多条输入（防抖）
  → Bot: CancelAssignment{mode: graceful, reason: user_interrupted}
  → Executor: 事件 state=cancelled
  → Bot: CreateAssignment{kind: resume, workdirKey 同前, input.followUps=[合并后的输入]}
```

约束：

- **只有人类输入触发打断**。CI 结果、Bot 消息在运行期间到达时暂存，待本次 Assignment 结束后并入下一次 `resume`。否则 Worker 自己 push 触发的 CI 会反复打断自己。
- Bot 必须**等到 `cancelled` 事件**后再发 `resume`；提前发送会得到 `WORKDIR_BUSY`。
- 竞态：如果 Assignment 在 cancel 生效前已经 `reported`，Bot 照常发起 `resume`，把新输入作为 `followUps`。
- 契约不规定执行内核（roadmap #32）；每个 Ticket 对应一个内核 Session，由 Executor 的内核适配层维护（见 [background.md §6.5](../design/background.md#65-内核适配层)）。`cancel` 只停止当前轮次，Session 保留，`resume` 在同一 Session 中继续；Session 丢失时（如 `lost`、workdir 被回收）才注入恢复提示，要求先检查 `git status`、未提交修改和上一次的报告。

### 5.3 打断防抖（按阶段区分）

防抖由 Bot 执行，Executor 不感知。

| Assignment 状态 | 策略 |
| --- | --- |
| 尚未派发（Bot 侧排队中） | 不需要 cancel，直接并入待派发的输入 |
| `preparing` | 立即 cancel，合并输入后重新派发。此阶段还没有消耗推理 Token，workdir 准备成果保留在磁盘上 |
| `running` / `backgrounded` | 15 秒滑动窗口：窗口内的多条人类评论合并为一份输入，窗口到期后执行一次 graceful cancel → resume |

- 滑动窗口设**最长等待 60 秒**的上限。否则人类一直在发消息，窗口会不断后延，打断永远不会触发。
- 窗口期间如果 Assignment 自行进入终态，则取消防抖，直接按 §5.2 的竞态规则发起 resume。

### 5.4 人类交互模型（无状态挂起 + 续跑）

```text
Worker 有疑问  → reported{answer, question} → Assignment 结束，释放槽位
人类回复       → Bot: CreateAssignment{kind: resume, workdirKey 同前, input.followUps=[回复]}
```

- 不依赖内核支持中途向人提问：提问即报告并结束 Assignment，回答通过新的 Assignment 送达。
- 回答、评审意见、CI 结果都统一作为 `followUps` 输入，不单独设 `answer` 控制动作。
- 不提供单个 Assignment 的 `pause`；全局暂停是 Bot 停止派发新 Assignment。

## 6. 事件保留与截断

生命周期事件、活动事件与日志共用一个按 Assignment 单调递增的 `seq`，但保留策略不同：

| 类别 | 事件类型 | 保留 |
| --- | --- | --- |
| 生命周期 | `state`、`report` | 全量保留至 Ticket 归档后 30 天 |
| 活动 | `activity` | 与生命周期事件相同。只含度量与结构（工具名、耗时、结果类别、大小、Token 数），**不含任何原文** |
| 日志 | `log` | 每个 Assignment 一个 Ring Buffer，上限 10,000 条或 5 MB，先到先淘汰 |

`activity` 是给分析日志用的结构化事件（roadmap #53，见 [logging.md §3](../design/logging.md#3-数据模型一个工单一条轨迹)），由内核适配层产出，每次工具调用或模型调用一条。它不含原文，所以 `local_dir` 也照常上行；`log` 只用于界面，不进分析日志。云端执行的内容级数据（L2）由 Executor 直接写入该租户的轨迹库，不经 `StreamEvents`。

`StreamEvents(fromSeq)` 的返回：

- 生命周期事件与活动事件**总是完整返回**，不受日志截断影响。
- 如果 `fromSeq` 之后的部分日志已被淘汰，返回 `logsTruncated: true` 和 `oldestLogSeq`。客户端据此提示「更早的日志已丢弃」并重置日志视图，不应报错。

## 7. workdir 与预览进程

### 7.1 workdir 回收（显式调用 + 租约兜底）

| 通道 | 触发方 | 规则 |
| --- | --- | --- |
| 主通道 | Bot | Ticket 进入终态（MR / PR 合入或关闭、人类丢弃或停止、`ready` 且无待审查产物直接结束）时调用 `DestroyWorkdir` |
| 租约续期 | Bot | 对仍然打开的 Ticket，定期（如每天一次）调用 `TouchWorkdir` 续期 |
| TTL 兜底 | Executor | 租约超过 7 天未续期的 workdir 自动回收，防止 Bot 崩溃导致磁盘泄漏 |
| 磁盘水位 | Executor | 宿主剩余空间低于 15% 时按 LRU 强制回收 |

约束：

- **TTL 从最后一次续期算起，而不是从最后一次 Assignment 算起**。等待评审（`person/review`）的工单常常放一周以上，没有任何执行活动；按活动时间计算会误删仍在使用的工作区。
- 任何回收都**跳过存在非终态 Assignment 的 workdir**。磁盘水位回收优先回收租约已过期的 workdir，其次才是有租约的，并且要发出告警。
- 回收会级联关闭该 workdir 的全部预览进程。
- **`local_dir` 例外**：`DestroyWorkdir`、TTL 兜底与磁盘水位回收**只清理本地 Executor 自己创建的东西**（worktree、临时目录、预览进程），**绝不删除用户指定的 `path` 目录**。
- 被回收后，`resume` 会返回 `WORKDIR_NOT_FOUND`。Bot 应降级为 `start`：用工单的 MR / PR 源分支作为 `baseRef` 新建 workdir，并在恢复提示中说明本地未推送的修改已丢失。降级只在原 `workspace` 内进行，不更换执行位置。

### 7.2 预览进程

Assignment 结束后人类仍需访问的进程（`vite dev`、`next dev` 等），挂在 **workdir** 上而不是 Assignment 上。

- **显式登记**：Worker 必须通过宿主提供的命令（如 `autobot preview start --port <n> -- <cmd>`）启动预览进程。未登记的进程一律视为普通后台 Shell，随 Assignment 结束被终止。否则 Executor 无法区分预览进程和野进程。
- **按进程组管理**：dev server 常会派生子进程，只 kill PID 会留下孤儿进程。关闭时先 SIGTERM 进程组，超时再 SIGKILL。
- **兜底回收**：
  - 空闲 TTL（默认 24 小时无访问即关闭）；
  - 宿主级上限（默认 10 个，超出时拒绝新登记，而不是挤掉旧的）；
  - `DestroyWorkdir` 时级联关闭。
- **访问范围**：预览默认只绑定 `127.0.0.1`。如需对外暴露，必须经过带鉴权的反向代理，不直接开放端口。

### 7.3 文件浏览（只读）

应用在项目空间中**只能浏览文件**，不能编辑，也不提供终端（roadmap #27）。

- 浏览项目本身（无任务运行时）由 Bot 直接读代码平台 API，不经过 Executor；浏览某个任务的工作现场（含未提交修改）用 `ListFiles` / `ReadFile`。
- 只读：不修改 workdir，不占用槽位，不需要唤醒或启动执行容器；可以与运行中的 Assignment 并发。
- 路径必须在 workdir 内：拒绝绝对路径、`..` 越界和指向 workdir 之外的符号链接（`PATH_OUTSIDE_WORKDIR`）。
- 单次读取有大小上限（默认 1 MB），超出返回 `FILE_TOO_LARGE`；二进制文件只返回元信息。
- 不隐藏 `.gitignore` 中的文件（排查构建产物需要完整现场），但用 `ignored` 标记，供界面置灰折叠。
- **敏感文件只返回元信息、不返回内容**（`redacted: true`）。规则 = **内置基线**（不可关闭）+ 租户追加规则。基线至少包含：`.env*`、`*.pem`、`*.key`、`id_rsa*`、`id_ed25519*`、`.npmrc`、`.pypirc`、`.netrc`、`.git-credentials`、`.git/config`。规则匹配失败或规则加载出错时按敏感处理（Fail-Closed）。
- 单个目录最多返回 1,000 个条目，超出时分页（`cursor`）；`.git/objects` 等内部目录只返回汇总，不展开。
- `local_dir` 同样适用（桌面端浏览本地任务现场），规则相同。

## 8. Schema

```ts
import { z } from 'zod';

export const ClientContextSchema = z.object({
  operatorId: z.string(),                 // <provider>:<userId>，如 gitlab:123 | feishu:ou_xxx | teams:<aadObjectId> | app:<user>
  channel: z.enum(['gitlab', 'github', 'feishu', 'teams', 'app', 'cli', 'system']),
  deviceId: z.string().optional(),        // 桌面设备标识
  platform: z.enum(['web', 'desktop', 'mobile']).optional(),  // channel = app 时必填
});

export const FollowUpSchema = z.object({
  source: z.enum(['human', 'ci', 'bot']),
  author: z.string(),
  text: z.string(),
  triggerId: z.string(),                  // 回溯到原始 Trigger
});

export const WorkspaceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('cloud_project'),
    projectId: z.string(),                // 云端项目空间
    repo: z.object({
      provider: z.enum(['gitlab', 'github']),
      host: z.string(),                   // 如 gitlab.example.com（企业自建实例）
      projectPath: z.string(),            // GitLab 可多级：group/subgroup/project
      cloneUrl: z.string(),               // 不得内嵌凭据
    }),
    baseRef: z.string(),                  // 显式传入，不默认 main
  }),
  z.object({
    kind: z.literal('local_dir'),         // W2 实现，契约先预留
    deviceId: z.string(),                 // 目标本地 Executor
    path: z.string(),                     // 用户机器上的绝对路径
    baseRef: z.string().optional(),       // 目录是 Git 仓库时使用
  }),
]);

export const CreateAssignmentSchema = z.object({
  tenantId: z.string(),
  assignmentId: z.string().uuid(),        // 幂等键
  ticketId: z.string(),
  kind: z.enum(['start', 'resume']),
  priority: z.enum(['normal', 'human']),  // human 可占用 Extra Slot
  workspace: WorkspaceSchema,             // 同一 Ticket 的所有 Assignment 必须相同，否则 WORKSPACE_MISMATCH（roadmap #31）
  model: z.object({
    source: z.enum(['tenant', 'byok', 'local']),  // 来源规则见 §2
    id: z.string(),
  }),
  workdirKey: z.string(),                 // resume 时必须与上一次相同
  input: z.object({
    prompt: z.string(),
    followUps: z.array(FollowUpSchema),   // start 时为空数组
  }),
  secretRefs: z.array(z.string()),
  traceId: z.string(),
  clientContext: ClientContextSchema,
});

export const AssignmentStateSchema = z.enum([
  'preparing', 'running', 'backgrounded', 'reported', 'cancelled', 'lost',
]);

export const AssignmentReportSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('ready'),
    summary: z.string(),
    changeRequest: z.object({             // GitLab MR / GitHub PR
      provider: z.enum(['gitlab', 'github']),
      number: z.number().int(),           // GitLab 为 MR iid
      url: z.string(),
    }).optional(),
    diffStats: z.object({                // 必填；无改动时全部为 0
      filesChanged: z.number().int(),
      insertions: z.number().int(),
      deletions: z.number().int(),
    }),
  }),
  z.object({ kind: z.literal('answer'), summary: z.string(), question: z.string() }),
  z.object({ kind: z.literal('blocked'), summary: z.string(), reason: z.string() }),
  z.object({ kind: z.literal('failed'), summary: z.string(), reason: z.string() }),
  z.object({ kind: z.literal('waiting'), summary: z.string(), reason: z.string() }),
]);

export const AssignmentSchema = z.object({
  tenantId: z.string(),
  assignmentId: z.string().uuid(),
  ticketId: z.string(),
  workdirKey: z.string(),
  state: AssignmentStateSchema,
  report: AssignmentReportSchema.optional(),  // 仅 state === 'reported' 时存在
  lastSeq: z.number().int(),
});

export const CancelAssignmentSchema = z.object({
  tenantId: z.string(),
  assignmentId: z.string().uuid(),
  mode: z.enum(['graceful', 'kill']),
  reason: z.enum(['user_interrupted', 'user_stop', 'mandate_revoked', 'operator']),
  clientContext: ClientContextSchema,
});

export const AssignmentEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('state'), seq: z.number().int(), at: z.string(), state: AssignmentStateSchema }),
  z.object({ type: z.literal('report'), seq: z.number().int(), at: z.string(), report: AssignmentReportSchema }),
  z.object({ type: z.literal('log'), seq: z.number().int(), at: z.string(),
             stream: z.enum(['stdout', 'stderr', 'agent']), chunk: z.string() }),
  // 只放度量与结构：本地执行也会上行，任何原文都不能进这个事件
  z.object({ type: z.literal('activity'), seq: z.number().int(), at: z.string(),
             kind: z.enum(['tool', 'model']),
             name: z.string(),                       // 工具名或模型名
             durationMs: z.number().int(),
             resultClass: z.enum(['ok', 'error', 'denied', 'timeout', 'cancelled']),
             inputBytes: z.number().int().optional(),
             outputBytes: z.number().int().optional(),
             usage: z.object({ inputTokens: z.number().int(), outputTokens: z.number().int(),
                               cachedTokens: z.number().int().optional() }).optional() }),  // 仅 kind = model
]);

export const StreamEventsResponseSchema = z.object({
  events: z.array(AssignmentEventSchema),
  logsTruncated: z.boolean(),
  oldestLogSeq: z.number().int().optional(),  // logsTruncated 为 true 时存在
});

export const PreviewSchema = z.object({
  previewId: z.string(),
  workdirKey: z.string(),
  port: z.number().int(),
  url: z.string(),                        // 默认 http://127.0.0.1:<port>
  pid: z.number().int(),                  // 进程组 leader
  startedAt: z.string(),
  lastAccessAt: z.string().optional(),
});

export const ListPreviewsSchema = z.object({ tenantId: z.string(), workdirKey: z.string() });

export const StopPreviewsSchema = z.object({
  tenantId: z.string(),
  workdirKey: z.string(),
  previewId: z.string().optional(),       // 省略即关闭全部
  clientContext: ClientContextSchema,
});

export const DestroyWorkdirSchema = z.object({
  tenantId: z.string(),
  workdirKey: z.string(),
  clientContext: ClientContextSchema,
});

export const TouchWorkdirSchema = z.object({
  tenantId: z.string(),
  workdirKey: z.string(),
});

export const ListFilesSchema = z.object({
  tenantId: z.string(),
  workdirKey: z.string(),
  path: z.string(),                       // workdir 内的相对路径，根目录为 ''
  cursor: z.string().optional(),
});

export const ListFilesResponseSchema = z.object({
  entries: z.array(z.lazy(() => FileEntrySchema)),
  nextCursor: z.string().optional(),      // 条目超过单页上限时存在
});

export const FileEntrySchema = z.object({
  name: z.string(),
  type: z.enum(['file', 'dir', 'symlink']),
  size: z.number().int().optional(),
  modified: z.boolean(),                  // 相对 baseRef 是否有修改
  ignored: z.boolean(),                   // 命中 .gitignore
  sensitive: z.boolean(),                 // 命中敏感文件规则，读取时内容会被脱敏
});

export const ReadFileSchema = z.object({
  tenantId: z.string(),
  workdirKey: z.string(),
  path: z.string(),
});

export const ReadFileResponseSchema = z.object({
  path: z.string(),
  size: z.number().int(),
  binary: z.boolean(),
  redacted: z.boolean(),                  // 命中敏感文件规则时为 true，不返回内容
  content: z.string().optional(),         // 文本内容；binary 或 redacted 时省略
});

export const TouchWorkdirResponseSchema = z.object({
  workdirKey: z.string(),
  leaseExpiresAt: z.string(),
});
```

## 9. 错误码

| 码 | 场景 |
| --- | --- |
| `ASSIGNMENT_NOT_FOUND` | 查询 / 取消不存在的 Assignment |
| `WORKDIR_BUSY` | 同一 `workdirKey` 上已有非终态 Assignment（含 `DestroyWorkdir`） |
| `WORKDIR_NOT_FOUND` | `resume` / 预览操作时 `workdirKey` 对应目录不存在 |
| `NO_CAPACITY` | 槽位已满，或该租户的并发配额已用完（Bot 应排队，不应重试轰炸） |
| `PREVIEW_LIMIT` | 宿主预览进程数已达上限 |
| `PREVIEW_NOT_FOUND` | 预览进程不存在或不属于该 workdir。过期后不得静默复用旧 previewId，由调用方决定是否重新 `startPreview`。 |
| `PATH_OUTSIDE_WORKDIR` | 文件浏览的路径越出 workdir |
| `FILE_NOT_FOUND` | 文件浏览的路径不存在 |
| `FILE_TOO_LARGE` | 读取的文件超过单次上限 |
| `INVALID_PAYLOAD` | schema 校验失败，附字段路径 |
| `SECRET_REF_UNKNOWN` | `secretRefs` 中存在宿主未配置的引用 |
| `EXECUTOR_OFFLINE` | `local_dir` 对应的本地 Executor 不在线（Bot 侧表现为 `person/delivery`，设备上线后重试；**不回退到云端执行**） |
| `WORKSPACE_UNSUPPORTED` | 该 Executor 不支持此 `workspace.kind` |
| `WORKSPACE_KIND_MISMATCH` | 同一 `workdirKey` 的 `workspace.kind` 改变 |
| `WORKSPACE_DEVICE_MISMATCH` | `local_dir.deviceId` 改变 |
| `WORKSPACE_PROJECT_MISMATCH` | `cloud_project.projectId` 或 repo 字段改变 |
| `WORKSPACE_PATH_MISMATCH` | `local_dir.path` 改变 |
| `WORKSPACE_BASEREF_MISMATCH` | `baseRef` 改变 |
| `MODEL_NOT_ALLOWED` | `tenant` 模型不在租户目录中、当前用户无权使用，或 `cloud_project` 请求了 `byok` |
| `MODEL_NOT_CONFIGURED` | `byok` 模型未配置 Key，或 `local` 模型在本机不可用 |
| `MODEL_SOURCE_DISABLED` | 租户已禁用该模型来源（由 Bot 返回，不经过 Executor） |
| `TENANT_MISMATCH` | payload 的 `tenantId` 与传输层鉴权身份不一致 |
| `UPLOAD_REJECTED` | 用户主动上传的同意、路径、大小或哈希校验失败 |

## 10. 已决议的第三批问题

1. **`ready` 且无 MR / PR**：按「是否有待审查产物」区分，见 §3.2（roadmap #28）。
2. **本地 Executor 运行中断线**：断线不等于 `lost`，宽限期内重连对账，超时后由 Bot 结算，见 §3.1（roadmap #29）。

## 11. 待定问题

1. **已决议（roadmap #36），契约待改**：`local_dir` 的 `log` 事件与 `ListFiles` / `ReadFile` 的内容默认不上行，`StreamEvents` 对 `local_dir` 只上行生命周期事件与不含原文的 `activity` 事件（§6）；需要新增「用户主动上传」的方法。决议前的描述：`local_dir` 的 `log` 事件、`ListFiles` / `ReadFile` 的内容按现有传输约定会经长连接到达云端的租户 Bot。是否允许、是否持久化，见 [web-app.md §7 第 8 题](../design/web-app.md#7-待定问题)。结论可能要求 `StreamEvents` 对 `local_dir` 只上行生命周期事件。
2. **`activity` 事件的字段**（roadmap #53）：§6 与 §8 给出的是首版，尚未随契约冻结。待定：工具名是否算敏感（自定义工具的名字可能带业务含义）；`usage` 在 BYOK 与本地模型下由内核适配层自报，是否可信到能用于计费。


## 12. S2 代码补齐（草案 v1）

代码位置：`packages/contracts/src/executor.ts`；JSON Schema 在
`packages/contracts/schema/`。以下各项均已落成代码并有测试。

| 原缺口 | 决议 |
| --- | --- |
| `GetAssignment` 请求与响应 | `GetAssignmentSchema` + `ExecutorResponseSchema(AssignmentSchema)`；按 `tenantId + assignmentId` 查询。 |
| `StreamEvents` 请求与订阅 | `StreamEventsSchema` 固定 `tenantId`、`assignmentId`、`fromSeq`；订阅本身由传输层承载。`StreamEventsResponseSchema` 明确 `logsTruncated` 与 `oldestLogSeq` 同时出现。 |
| 其余方法响应 | `ListPreviewsResponse`、`StopPreviewsResponse`、`DestroyWorkdirResponse`、`TouchWorkdirResponse` 均已定义；所有响应使用 `{ok,value}` / `{ok,error}` 包络。 |
| 内核选择 | `CreateAssignment.kernel` 为可选值：`dsh`、`pi`、`acp:<agent>`；`local_dir` 禁止携带（固定 dsh），`cloud_project` 可省略（默认 dsh）。 |
| `tenantId` 与鉴权身份 | 新增 `AuthContextSchema` 与 `assertTenantMatches(payloadTenantId, auth)`；不匹配返回 `TENANT_MISMATCH`，传输凭据仍只在 transport header。 |
| `local_dir` 无 `baseRef` 的 diff 基准 | 新增 `DiffBasis`：`baseRef`（对 workspace.baseRef）、`ticketStart`（对 Ticket 首次 Assignment 的快照）、`none`（无从比较）。`ready.diffStats` 必须同时给出 `diffBasis`。 |
| `WORKSPACE_MISMATCH` 拆分 | 拆为 `WORKSPACE_KIND_MISMATCH`、`WORKSPACE_DEVICE_MISMATCH`、`WORKSPACE_PROJECT_MISMATCH`、`WORKSPACE_PATH_MISMATCH`、`WORKSPACE_BASEREF_MISMATCH`；`workspaceMismatch()` 返回具体码。 |
| `activity.name` 内容级别 | `name` 为 **L1**；新增 `nameClass: builtin | custom`。内置工具名走白名单；自定义工具名在跨租户分析前必须哈希或替换。事件仍不含输入/输出原文。 |
| `local_dir` 用户主动上传 | 新增 `UploadLocalArtifacts`：用户同意后，以附件传输文件字节；payload 只含路径、mediaType、大小、sha256、目标 `tenant_volume` 和 consent。没有自动同步方法。 |

补充约束：

- `ActivityEvent.usage` 只允许 model 调用；tool 调用不得伪造 token 用量。model 活动若内核知道用量则必须上报。
- `CreateAssignment.cloneUrl` 不得内嵌凭据；`cloud_project` 只能使用 `model.source = tenant`。
- `AssignmentReport.kind = ready` 时 `diffStats` 必填；只允许在 `state = reported` 时存在 `report`。
- 错误码完整列表见 `ExecutorErrorCodeSchema`，包含上述拆分码与 `TENANT_MISMATCH`、`UPLOAD_REJECTED`。

BG1 场景执行：

```sh
pnpm --filter @siriusx/autobot autobot list
pnpm --filter @siriusx/autobot autobot run --scenario log-truncation --json
```

假执行器只使用内存状态，不启动进程、不访问网络、不调用模型。S2 的 13 个场景
全部通过 `AssignmentEventSchema` 校验。

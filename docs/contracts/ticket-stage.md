# Ticket 阶段推导（Bot 推导 / 应用展示）

7 个工单阶段是**展示态**，由纯函数推导，不单独存储。只对未结束（open）的工单求值。

## 输入

| 字段 | 含义 |
| --- | --- |
| `deliveryFailing` | 最近一次向 Executor 投递（`CreateAssignment`）失败且尚未成功重试 |
| `latest` | 该工单最近一个 Assignment 的状态与报告；从未派工时为空 |
| `pendingInput` | 存在尚未被任何 Assignment 消费的输入（如报告后的人类回复） |

## 规则（自顶向下，首个命中即返回）

| # | 条件 | 阶段 |
| --- | --- | --- |
| 1 | `deliveryFailing` | `person/delivery` |
| 2 | `latest.state ∈ {preparing, running, backgrounded}` | `working` |
| 3 | `latest` 为空，或 `pendingInput` | `working/queued` |
| 4 | `latest.report.kind = answer` | `person/answer` |
| 5 | `latest.report.kind = ready` | `person/review` |
| 6 | `latest.report.kind ∈ {blocked, failed}` | `person/blocked_failed` |
| 7 | `latest.report.kind = waiting`，或 `latest.state ∈ {cancelled, lost}` | `idle` |

说明：

- 规则 2 先于规则 3：运行期间到达的跟进输入，在 Assignment 进入终态前工单仍显示 `working`。人类输入会触发打断，`cancelled` 后因 `pendingInput` 转入 `working/queued`；CI / Bot 输入则暂存到本次结束（见 [executor.md §5.2](./executor.md#52-打断续跑人类在运行中追加输入)）。
- 规则 3 先于 4–6：人类已回复的 `person/*` 工单立即离开待处理区，转入排队。
- `ready` 且无待审查产物（无 MR / PR、`diffStats.filesChanged = 0`、无存活预览）时由 Bot 直接结束工单，不进入本函数；有待审查产物时按规则 5 进入 `person/review`（见 [executor.md §3.2](./executor.md#32-报告类型)）。
- 本地 Executor 断线的宽限期内，`latest.state` 保持断线前的值，工单仍为 `working`；宽限期超时后 Bot 结算为 `lost`，按规则 7 进入 `idle`（见 [executor.md §3.1](./executor.md#31-断线宽限期与对账)）。
- `person/delivery` 的重试：2 秒后首次重试，指数退避至最高 1 分钟。

## 验收

推导函数单测覆盖上表 7 条规则，以及以下边界：

- 规则 2 与 `pendingInput` 同时成立 → `working`
- `answer` 报告 + `pendingInput` → `working/queued`
- `deliveryFailing` 与运行中 Assignment 同时成立 → `person/delivery`

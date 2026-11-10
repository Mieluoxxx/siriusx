# S3 证据：本地 Executor 与本机闭环

## 已实现

- `packages/executor-local`：`local_dir` Executor。
  - workspace 不可变、租户校验、容量、workdir 租约；
  - 真实 DSH AgentBackend 驱动；
  - 结构化报告（`siriusx-report` fenced JSON，缺省回退 `ready`）；
  - `diffStats`（Git baseRef/ticket-start，含 untracked；非 Git 使用目录快照）；
  - 用户目录永不删除；文件浏览、脱敏、上传同意。
- `packages/kernel-dsh`：自研 DSH in-process adapter，映射 DSH durable session events。
- `apps/autobot`：
  - 单写者 SQLite Engine（tickets / assignments / events / pending_inputs / outbox）；
  - 阶段推导、打断、resume、answer、失联对账、输入防抖；
  - 命令行派工入口。
- `plugins/executor-local`：DSH Host 插件，`local_dir` 路由在真实 Web Host 内运行。

## 验证

| 验收项 | 结果 | 证据 |
| --- | --- | --- |
| 派工 → running → ready + diffStats | **通过** | `02-host-plugin/run.txt` |
| `git diff --stat` 一致 | **通过**（filesChanged=1, insertions=1） | 同上 |
| 运行中追加输入 → graceful cancel → 同会话 resume | **通过（真实 DSH）** | `01-real-dsh/run.txt` 的 `interruptKinds=start,resume` |
| agent 中途提问 → answer → 回答后 resume | **通过（真实 DSH）** | `01-real-dsh/run.txt` 的 `answerStage=person/answer` |
| workdir 回收后用户目录仍在 | **通过** | `packages/executor-local/tests/executor.spec.ts` |
| 界面开着 + Executor 运行 | **通过** | `02-host-plugin/ui-open.png`、`02-host-plugin/run.txt` |
| 输入防抖合并 | **通过** | `apps/autobot/tests/bot-service.spec.ts` |
| SQLite 单写者、Outbox、阶段 | **通过** | `apps/autobot/tests/bot-service.spec.ts` |
| 真实 Host 杀掉后重启对账 | **部分**：DB 对账单测通过；未做真实进程 kill/15 分钟测试 | `reconciles orphaned running assignments` |
| 3–5 段会话日志回归基线 | **4 段**（3 成功 + 1 失败） | `03-session-baselines/` |
| S2 全部 local_dir 场景对真实 Executor | **部分**：状态机、取消、resume、文件、容量、workspace 已覆盖；previews/TTL/真实断线未覆盖 | S3 汇总 |
| M1 契约冻结 | **未完成**：暂记 `executor-v0.1.0-rc.1`，正式 tag 前需补 real preview/TTL/process-loss 和变更评审 | — |

## 真实 DSH 集成方式

`01-real-dsh/run.sh` 使用当前 deepseek-harness 的 AgentLoop testkit：

1. 启动真实 `AgentLoop` + Session + Agent registry；
2. 用 `DshBackend` 把 live Agent 适配成 `AgentSession`；
3. 用 `LocalExecutor` 派工到临时 Git 仓库；
4. 用本地 scripted model 完成 turn，验证 report/diffStats；
5. 用 `BotService` 再跑一遍完整 Bot → Executor → DSH 闭环；
6. 再验证 interrupt/resume 与 answer/resume。

`02-host-plugin/run.sh` 使用真实 DSH Web Host：

1. 从 `web` profile 创建 `s3web`；
2. 安装 `@siriusx/dsh-telemetry-off` 与 `@siriusx/dsh-executor-local`；
3. 配置本地 OpenAI-compatible mock；
4. 启动 Web Host；
5. POST `__siriusx/executor/run`；
6. Playwright 打开 UI，并在 UI 开着时再跑一次 Executor。

## 已知边界

- `plugins/executor-local` 的 loopback route 只是 S3/S4 联调入口，不是生产传输；S5 要放到认证网关后面。
- 预览进程、TTL、真实 Host 崩溃恢复仍是 S3 未完成项。
- 会话日志里的模型是 deterministic mock，用于内核适配回归；真实模型会话在 S4 自用时补。

## 进程被 SIGKILL 后重启

- 子进程运行真实 `BotService` + `LocalExecutor` + 60s wait 场景；
- 测试收到 ticketId 后 `SIGKILL` 子进程；
- 同一 SQLite 库重新构造 `BotService`，assignment 被 `reconcile()` 结算为 `lost`；
- 再次重启不会重复写 `assignment-lost` outbox。
- 证据：`04-process-loss/test.txt`。

注意：这是 Bot 服务进程级 kill/restart，不是 Electron Host 进程级实验；Host 级仍需补。

## 预览进程与 TTL

- `LocalExecutor.startPreview()` 登记预览子进程（workdir、port、pid、URL）；
- `touchPreview()` 更新 lastAccess；
- `sweepPreviews()` 按 TTL 清理；
- `destroyWorkdir()` 同时停止该 workdir 的所有预览；
- 测试验证预览停止、TTL 清理与跟随 workdir 销毁。
- 证据：`05-previews/test.txt`、`05-previews/schema-export.txt`。

## 契约候选标签

- 已创建 annotated tag `executor-v0.1.0-rc.1`；
- 记录 22 个 JSON Schema 的 SHA-256；
- 契约单测 25 个通过；
- 正式冻结仍等 Electron Host 级 kill/restart 与真实断线。
- 证据：`06-contract-tag/tag.txt`、`contracts-test.txt`、`schema-sha256.txt`。

## DSH Web Host SIGKILL / 重启对账

- 真实 DSH Web Host 加载 `plugins/executor-local`，Host 内维护 SQLite Bot store；
- 用延迟 60s 的本地 mock 模型让 assignment 停在 `preparing/running`；
- SIGKILL Host 进程后，用同一 profile 与同一 `SIRIUSX_BOT_DB` 重启；
- 重启后的 BotService `reconcile()` 把 assignment 标为 `lost`，GET ticket 返回 200 且不重复推进。
- 证据：`07-host-kill/run.txt`、`before-kill.txt`、`after-restart.txt`、`host-first.txt`、`host-second.txt`。

## 真实模型断线

- 本地 mock 模型建立连接后主动断开；
- Host 插件返回 `state=reported`, `report.kind=failed`, `reason=Connection error.`；
- Bot 阶段推导为 `person/blocked_failed`，不进入无限重试。
- 证据：`08-model-disconnect/run.txt`、`result.txt`。

## Lost 自动重试

- `BotServiceOptions.autoRetryLost` 开启后，启动时对最新 assignment 为 `lost` 的 open ticket
  自动创建 `resume` assignment。
- 测试验证：原 lost assignment 保留，新 assignment 为 `resume` 并达到 `reported`。
- Host 插件通过 `SIRIUSX_AUTO_RETRY_LOST=1` 可选开启。
- 证据：`10-lost-retry/test.txt`。

## Sandbox 巡检

- `DockerSandboxProvider.reapOrphans(maxAgeMs)` 按 `siriusx.managed=true` 标签清理过期容器。
- 实测创建 sandbox 后 `reapOrphans(0)` 删除 1 个容器，随后 exec 失败。
- 证据：`11-sandbox-reap/test.txt`。

## Sandbox 周期巡检

- control-plane CLI 新增 `reap-sandboxes [--max-age-ms]`；
- native installer 生成 `siriusx-reap.service` + `siriusx-reap.timer`（每 5 分钟）；
- 实测手工创建 labeled orphan 后 CLI 返回 `removed: 1`。
- 证据：`12-reap-scheduler/cli.txt`、`install.txt`、`siriusx-reap.timer`。

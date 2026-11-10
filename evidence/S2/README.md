# S2 证据

## 产出

- `packages/contracts`：Executor zod schema、JSON Schema、Ticket 阶段纯函数、分析事件分级。
- `packages/kernel-api`：dsh-TUI 的 12 文件内核接口（MIT，见 PROVENANCE）。
- `packages/kernel-dsh`：自研 DSH in-process adapter，基于公共 `Agent` 与 `session/event`。
- `packages/fake-kernel`：无命令、无网络、无模型的确定性假内核。
- `apps/autobot`：BG1 场景运行器。

## 验证

| 项 | 结果 | 证据 |
| --- | --- | --- |
| 全 workspace typecheck | 4 个包 / 1 个 app 通过 | `root-typecheck.txt` |
| 全 workspace test | contracts 25、fake-kernel 4、kernel-dsh 3、autobot 16 全通过 | `root-test.txt` |
| JSON Schema | 22 个 schema 导出 | `01-contracts/schema-export.txt`、`packages/contracts/schema/` |
| Ticket 阶段 | 7 条规则 + 边界 | `01-contracts/test.txt` |
| 未标级别字段 | 拒收 | `01-contracts/test.txt` |
| DSH adapter | fake Agent 事件映射、submit/cancel/dispose | `02-kernel-api/kernel-dsh-test.txt` |
| 假内核无副作用 | 静态扫描 + 测试 | `03-fake-kernel/test.txt` |
| BG1 场景 | 15 个场景全部 pass，事件通过 schema | `04-scenarios/all-scenarios.txt` |

## 场景清单

```text
backgrounded-waiting      cancel-kill
cancel-graceful           interrupt-resume
answer-resume             lost
duplicate-out-of-order    cancel-report-race
log-truncation            previews
file-browse               ready-end
disconnect-late-report    capacity-human
workspace-immutable
```

## 已知边界

- `kernel-dsh` 的单元测试使用结构化 fake Agent 验证映射；真实 DSH AgentLoop 的进程内闭环在 S3 用 Host 插件复验。
- BG1 的 30 分钟超时、预览 TTL、真实 TCP 断线重连是**状态模拟**，不是真实时间/网络实验；S3 需要做真实进程与网络实验。
- `AssignmentReport.ready` 新增了 `diffBasis` 必填，旧的录制日志/测试夹具如未升级会被拒绝；M1 前允许这次变更。

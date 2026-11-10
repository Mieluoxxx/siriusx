# ACP 接入边界与缺口

## pi 的接入方式

本机 `pi 1.5.0` 只提供：

- 交互 TUI
- `--mode json` 的一次性 JSON 事件流

没有 ACP server 模式。因此：

- **pi**：走 `packages/kernel-pi` 的 JSON 模式后端；
- **dsh 及其他 ACP agent**：走 `packages/kernel-acp` 的 `AcpBackend` / `AcpCloudKernel`。

两者最终都映射到同一套 `AgentEvent`，Executor 不需要区分。

## ACP 的 backgrounded / activity 缺口

`@agentclientprotocol/sdk` 的 `SessionUpdate` 没有：

- `backgrounded` 状态
- 通用 `activity` 事件

当前 `AcpSession` 只映射它确实提供的：

- `agent_message_chunk` → `assistant.delta`
- `agent_thought_chunk` → `assistant.delta(reasoning)`
- `tool_call` → `tool.call`
- `tool_call_update` → `tool.result`
- `request_permission` → `permission.request/settled`
- `turn_end` / prompt response → `turn.end`

缺失语义不伪造。Executor 的补充策略：

- 一个 ACP turn 在 `turn.end` 前保持 `running`；
- 如果 agent 返回 `waiting` 报告，工单进入 `person/needs_input` 或按报告阶段展示；
- 需要在后台持续运行的工作，必须拆成新的 assignment/ticket，而不是依赖 ACP 隐式 background 状态；
- `activity` 只在后端明确提供时上报，当前 ACP 后端没有。

## 家目录卷并发

CloudExecutor 的卷策略：

- 每个 `tenantId + workdirKey` 一组 `home` / `work` named volume；
- 同一工单同一时间只允许一个活跃 assignment；
- `resume` 复用同一组卷，但必须等前一个 assignment 结束；
- 不存在两个进程同时写同一 `workdirKey` 的路径；
- 需要并行时必须使用不同 `workdirKey` / ticket。

这比共享家目录更保守，但避免了单写者冲突和会话文件竞态。

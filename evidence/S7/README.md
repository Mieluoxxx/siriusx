# S7 证据：云 Executor、沙箱与 ACP

## 已完成

- `packages/cloud-executor`：
  - `CloudExecutor` 生命周期、取消、`recoverOrphans()` 与 Bot 上行投影；
  - `SandboxProvider` 抽象 + `MemorySandboxProvider`；
  - `DockerSandboxProvider`：每 ticket 独立 home/workspace volume、`--network none`、
    `docker exec`/`docker cp`/stdio spawn；
  - 沙箱销毁后 volume 仍在，重新挂载可读回文件。
- `packages/kernel-acp`：
  - ACP v1 client backend，支持 initialize/newSession/prompt/cancel；
  - session update → 中性 `AgentEvent`（文本、reasoning、tool.call/result、permission）；
  - 权限请求通过 `SessionCapabilities.permissions.respond` 回填；
  - `AcpCloudKernel` 在沙箱内 spawn ACP agent，自动回权限并产出报告/`diffStats`。
- Docker 集成测试真实验证：两个工单目录互相不可见、`--network none` 无法访问外部、
  sandbox 销毁重建后 `/workspace/app.txt` 仍在。
- 真实 DSH ACP server：`dsh --profile acp` + 本地 mock 模型，经 `AcpBackend` 完成
  initialize/newSession/prompt/turn.end，收到真实 assistant 文本。证据：`03-real-dsh-acp/run.txt`。

## 验收对照

| 验收项 | 状态 | 证据 |
| --- | --- | --- |
| ACP 会话能跑通 | **通过（fake ACP、真实 Docker、真实 DSH ACP）** | `02-acp-backend/test.txt`、`cloud-acp-docker.txt`、`03-real-dsh-acp/run.txt` |
| pi 与 dsh 跑同一任务、事件一致 | **部分**：真实 dsh ACP 已跑通；pi 尚未接 | `03-real-dsh-acp/run.txt` |
| 两个任务文件互不可见 | **通过** | `01-cloud-executor/docker-isolation.txt` |
| 沙箱断网 | **通过** | 同上 |
| 沙箱删掉后 workdir 还在 | **通过** | 同上 |
| 网络允许列表 | **未完成**：仅 `none` 与预配置 network | — |
| agent 环境无连接器凭据 | **部分**：CloudExecutor 不注入 secretRefs；未做 env 扫描 | — |
| 真 GitHub/GitLab issue → MR | **未完成**：connector 仍是 mock | — |
| 崩溃恢复 | **部分**：`recoverOrphans()` 内存版通过 | `test.txt` |

## 已知边界

- CloudExecutor 状态尚未持久化到 SQLite；真实崩溃后需由 Bot/控制面重放。
- Docker 集成测试使用本机已有的 `teams-bridge:0.2.0` 镜像；产品镜像需要固定 digest。
- `AcpCloudKernel` 只把最终文本作为 `ready` 报告；正式实现要解析结构化 `siriusx-report` 并校验。

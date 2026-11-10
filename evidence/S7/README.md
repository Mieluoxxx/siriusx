# S7 证据：云 Executor、沙箱与 ACP

## 已完成

- `packages/cloud-executor`：
  - `CloudExecutor` 生命周期、取消、`recoverOrphans()` 与 Bot 上行投影；
  - SQLite `AssignmentStore`：assignments/events/sandbox_id 持久化，进程重启后可按库恢复；
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
- GitHub connector：读 issue、创建分支、开 PR；凭据只来自 gateway env；
  本地 mock HTTP 测试验证 Authorization 与请求体。证据：`04-github-connector/`。
- GitHub write 经工具网关审批：read 直接执行，open PR 先 pending，批准后才 POST；
  审计无 token。证据：`05-github-gateway/test.txt`。
- 真实 Pi CLI backend：`packages/kernel-pi` 通过 `pi --mode json` 跑两轮会话，
  映射 text delta / turn_end / assistant.message；模型使用本地 mock。证据：`06-pi-backend/test.txt`。
- 同一 `local_dir` 工单分别交给真实 DSH ACP 与真实 Pi CLI，BotService 侧得到相同的
  stage/report/事件类型序列（`idle`、`ready`、`state,state,report,state`）。证据：`07-kernel-parity/run.txt`。
- CloudExecutor 仓库准备：`GitClonePreparer` 在 Docker sandbox 内 clone，ACP 在 clone 目录运行；
  真实本地 bare repo + Python ACP agent 测试通过。证据：`08-repo-clone/test.txt`。
- 真实 DSH ACP server 在 Docker sandbox 内运行：挂载 DSH 源码 + Node 24 + DSH profile，
  本地 mock 模型返回真实 assistant 文本。证据：`09-real-dsh-docker/run.txt`。
- 真实 Pi CLI 在 Docker sandbox 内运行：挂载 Pi release + Node 24 + Pi models.json，
  `PiCloudKernel` 读取 JSON 事件并产出 ready 报告。证据：`10-real-pi-docker/run.txt`。
- 沙箱资源限额与凭据隔离：Docker `--memory/--cpus/--pids-limit`，容器 env 不继承宿主连接器凭据；
  `--network none` 下外网请求失败。证据：`11-sandbox-hardening/test.txt`。
- 出口 allowlist 代理：sandbox 位于 `--internal` 网络，只有显式允许的目标可经代理访问；
  直接外网请求失败，代理拒绝非白名单目标。证据：`12-egress-allowlist/test.txt`。

## 验收对照

| 验收项 | 状态 | 证据 |
| --- | --- | --- |
| ACP 会话能跑通 | **通过（fake ACP、真实 Docker、真实 DSH ACP）** | `02-acp-backend/test.txt`、`cloud-acp-docker.txt`、`03-real-dsh-acp/run.txt` |
| pi 与 dsh 跑同一任务、事件一致 | **通过（本地 + Cloud sandbox）**：真实 dsh ACP 与真实 pi CLI 同一 local_dir 工单结果一致；两者也已在 Docker sandbox 内运行 | `07-kernel-parity/run.txt`、`09-real-dsh-docker/`、`10-real-pi-docker/` |
| 两个任务文件互不可见 | **通过** | `01-cloud-executor/docker-isolation.txt` |
| 沙箱断网 | **通过** | 同上 |
| 沙箱删掉后 workdir 还在 | **通过** | 同上 |
| 网络允许列表 | **未完成**：仅 `none` 与预配置 network | — |
| agent 环境无连接器凭据 | **部分**：CloudExecutor 不注入 secretRefs；未做 env 扫描 | — |
| 真 GitHub/GitLab issue → MR | **部分**：GitHub REST connector + gateway 审批写测试完成；云端 repo clone 测试完成；未在真实仓库走 Issue→MR | `04-github-connector/`、`05-github-gateway/`、`08-repo-clone/` |
| 崩溃恢复 | **部分**：SQLite 跨进程恢复单测通过；真实进程 kill/重试未做 | `01-cloud-executor/store-test.txt` |

## 已知边界

- CloudExecutor 状态尚未持久化到 SQLite；真实崩溃后需由 Bot/控制面重放。
- Docker 集成测试使用本机已有的 `teams-bridge:0.2.0` 镜像；产品镜像需要固定 digest。
- `AcpCloudKernel` 只把最终文本作为 `ready` 报告；正式实现要解析结构化 `siriusx-report` 并校验。

## Pi JSON 输出时序修复

- `PiSession` 现在等待 **进程 exit + stdout end** 后才决定是否补发 fallback turn.end；
- 避免真实 Pi 两轮测试出现重复 `turn.end`。
- 证据：`06-pi-backend/test.txt`。

## GitHub Issue → MR 演练

- `GitHubConnector` 新增 `create_or_update_file`；
- 本地 mock GitHub API 串起：
  1. `read_issue`
  2. `create_branch`（审批）
  3. `create_or_update_file`（审批）
  4. `open_pull_request`（审批）
- 每个写操作都经过 tool-gateway 审批，审计链完整；最终 PR 内容正确。
- 证据：`13-github-issue-mr/run.txt`。
- 仍未接真实 GitHub/GitLab 仓库凭据。

## GitLab Issue → MR

- 新增 `GitLabConnector`：
  - `read_issue`
  - `create_branch`
  - `create_or_update_file`
  - `open_pull_request` → GitLab merge request
- 本地 mock GitLab API 串通 issue → branch → file → MR；写操作经 tool-gateway 审批，审计无 token。
- 证据：`14-gitlab-issue-mr/test.txt`。
- 仍未接真实 GitLab 仓库凭据。

## Local vs Cloud DSH 事件序列

- 同一 prompt 分别由本地 `AcpBackend` 与 Docker `AcpCloudKernel` 跑真实 DSH ACP；
- `AcpCloudKernel` 新增 `onEvent`；
- 两边事件类型序列一致。
- 证据：`15-dsh-local-cloud-sequences/run.txt`。

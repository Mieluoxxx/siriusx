# S6 证据：工具网关与日志采集

## 已完成

- `apps/tool-gateway`：
  - `CredentialProvider`：静态 env 与 Vault-style HTTP 密钥管理；secret 只在 connector 执行时读取；
  - fail-closed 策略（内置拒绝、Mandate、读/回复放行、写/发/删审批）；
  - 审批卡片表与 HTTP API；
  - 不可变审计表，每次决策先写审计；
  - connector 凭据只从 gateway 进程环境读取，不进入 payload、审计或结果；
  - 策略不可用时拒绝全部调用。
- `packages/analytics`：
  - 严格复用 S2 的 L0/L1/L2 字段分级；
  - BotService 已接 assignment.state_changed / report.produced / tool.called / model.called / human.input；
  - `autobot serve --analytics <path>` 用 `FileAnalyticsSink(local=true)` 落 L0/L1；
  - 未标级别字段在入库前拒绝；
  - local_dir 出现 L2 直接拒收；
  - 写 L0/L1 投影到单独文件；
  - sink 故障只计数，不影响任务。
- `packages/executor-local#streamEventsForBot`：local_dir 日志原文不进入云端上行事件。

## 验证

| 验收项 | 结果 | 证据 |
| --- | --- | --- |
| 未批准写入不执行 | **通过** | `01-tool-gateway/run.txt`、`01-tool-gateway/test.txt` |
| 策略不可用则全部拒绝 | **通过** | `01-tool-gateway/test.txt` `POLICY_UNAVAILABLE` |
| 审计可查、被拒绝也记录 | **通过** | `01-tool-gateway/run.txt` |
| connector 凭据不在审计里 | **通过** | run.txt 的 audit JSON 无 `super-secret-token`；测试断言 |
| local_dir 上行不含日志原文 | **通过** | `02-analytics/executor-uplink-test.txt` |
| L0/L1/L2 未标字段拒绝 | **通过** | `02-analytics/test.txt` |
| 事件总线停掉任务继续 | **通过（SDK 级）** | `02-analytics/test.txt` |
| Bot/Executor 事件接入 | **通过（本地 L0/L1 文件）** | `02-analytics/bot-test.txt`、`server-test.txt` |
| 真机抓包证明本地包无提示词/代码/命令 | **未完成** | 需真实本地任务 + tcpdump |
| 凭据托管到 KMS/Vault | **部分通过** | Vault-style HTTP provider + 缓存 + 审计不含 secret；真实 Vault 部署未验。证据：`01-tool-gateway/credential-manager-test.txt` |
| 审批卡片接进 DSH UI | **通过** | `03-ui-approval/approval-card.png`、`run.txt`（真实 DSH Web UI 批准后 status=approved） |

## 备注

- `03-ui-approval/` 证明 Team panel 经 control-plane 代理读取 tool-gateway 审批卡，
  Approve 后上游状态变为 approved。
- `01-tool-gateway/run.txt` 里 connector 只返回 `credentialPresent: true`，证明
  gateway 持有凭据；审计与审批卡都没有 token 原文。
- 策略当前是内置纯函数；下一步应把租户策略库与审批人规则接入 control-plane。

## 工单轨迹查询

- 新增 `GET /v1/tickets/:id/trace`：
  - 返回 ticket + 事件流
  - 若配置 tool-gateway，则合并该 ticket 的审计记录
- 证据：`04-trace/test.txt`。
- 已合并 analytics `.l0l1.jsonl`，按 `ticketId` 过滤。

## Vault KV v2

- `HttpCredentialProvider` 现在支持 `data.data.value`（Vault KV v2）；
- 本地 mock Vault 接口测试通过，凭据缓存且不进入审计。
- 证据：`05-vault-kv2/test.txt`。
- 仍缺真实 Vault/KMS 部署与权限。

## Vault 凭据轮换/失败

- `HttpCredentialProvider` 新增 `cacheTtlMs`，过期后重新拉取；
- 支持 `headers`、注入时钟；
- 上游 500 时抛错（fail closed）；
- 测试：`token-1` → TTL 后 `token-2`；500 抛错。
- 证据：`06-vault-rotation/test.txt`。

## 模型上游密钥隔离

- 本地 model gateway 上游 key 只在 gateway 进程 env；
- client→gateway 抓包与 data dir 搜索均无 key；
- 上游 mock 确实收到 Bearer key。
- 证据：`07-model-key-isolation/run.txt`。

## Agent 凭据隔离

- connector 凭据只在 tool-gateway 进程；
- Docker agent 进程 env 与 audit 均无 secret。
- 证据：`08-agent-credential-isolation/run.txt`。

## Device offline grace

- 设备断开后按宽限期结算未完成 assignment 为 `lost`；
- 宽限期内重连会清除定时器；
- 证据：`09-offline-timeout/`、`10-reconnect-resume/`。

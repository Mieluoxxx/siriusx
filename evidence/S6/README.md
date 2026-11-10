# S6 证据：工具网关与日志采集

## 已完成

- `apps/tool-gateway`：
  - Fail-Closed 策略（内置拒绝、Mandate、读/回复放行、写/发/删审批）；
  - 审批卡片表与 HTTP API；
  - 不可变审计表，每次决策先写审计；
  - connector 凭据只从 gateway 进程环境读取，不进入 payload、审计或结果；
  - 策略不可用时拒绝全部调用。
- `packages/analytics`：
  - 严格复用 S2 的 L0/L1/L2 字段分级；
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
| 真机抓包证明本地包无提示词/代码/命令 | **未完成** | 需真实本地任务 + tcpdump |
| 凭据托管到 KMS/Vault | **未完成** | 当前 gateway 从进程 env 读取 |
| 审批卡片接进 DSH UI | **未完成** | gateway API 已有，UI 仍是占位 |

## 备注

- `01-tool-gateway/run.txt` 里 connector 只返回 `credentialPresent: true`，证明
  gateway 持有凭据；审计与审批卡都没有 token 原文。
- 策略当前是内置纯函数；下一步应把租户策略库与审批人规则接入 control-plane。

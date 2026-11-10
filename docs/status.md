# 实施状态（滚动更新）

| 阶段 | 代码 | 证据 | 状态 |
| --- | --- | --- | --- |
| S0 前提 | `docs/spike.md`、`evidence/S0/` | auth/tenant/coexist/agent-interface | **完成** |
| S1 fork/遥测 | `deepseek-harness` 仅 `apps/desktop/src/main.ts` 改动；`plugins/telemetry-off*` | `evidence/S1/` | **部分**：Linux 构建、10 分钟零外联抓包、clean clone install+typecheck+test、fork 纪律自动检查通过；mac/win 启动与 5 天使用待补 |
| S2 契约/内核 | `packages/contracts`、`kernel-api`、`kernel-dsh`、`fake-kernel` | `evidence/S2/` | **完成** |
| S3 本机闭环 | `packages/executor-local`、`plugins/executor-local`、`apps/autobot` | `evidence/S3/` | **完成**：真实 DSH AgentLoop、Bot/DSH Web Host SIGKILL/重启、模型断线、previews/TTL、lost 自动 resume 重试、sandbox orphan sweep + systemd timer 通过；tag `executor-v0.1.0` |
| S4 工单界面 | 四个独立 client package + `packages/app-contract` + `apps/autobot/src/server.ts` | `evidence/S4/` | **部分**：发起/阶段/diff/排序/断线清空/审批/慢任务打断、四插件拆分通过；10 天自用待补 |
| S5 登录/租户 | `plugins/account-sso`、`apps/control-plane`（含 device gateway/model gateway）、Desktop enterprise gate | `evidence/S5/` | **部分**：OIDC/隔离/配对/长连接/模型网关/隐私 badge/个人 Bot 派工/原生入口管理员开关、全栈离线一键安装、session TTL 过期拒绝通过；真实 IdP、KMS 待补 |
| S6 工具网关 | `apps/tool-gateway`、`packages/analytics`、local_dir 上行过滤 | `evidence/S6/` | **部分**：审批/审计/fail-closed/分级/Bot 事件接线/完整 ticket trace/Vault KV v1+v2、TTL 轮换与 fail-closed 凭据适配、模型 key 抓包隔离、agent env/audit 凭据隔离通过；真实 KMS/Vault 待补 |
| S7 云执行 | `packages/cloud-executor`、`packages/kernel-acp` | `evidence/S7/` | **部分**：Docker/ACP/真实 dsh+pi（含 sandbox）/同工单内核一致性、本地/云端 DSH 事件序列一致性、ACP 边界/卷并发决策/云端 repo clone/资源限额+env+出口 allowlist/SQLite 恢复/GitHub/GitLab connector、gateway 审批写、mock Issue→MR 通过；真实平台 Issue→MR、M2 真崩溃待补 |
| S8 发布 | `plugins/brand-siriusx`、`deploy/release`、`deploy/offline` | `evidence/S8/` | **部分**：品牌/图标/打包参数、Linux 全依赖离线 tar（含 sandbox image）、DSH Web 离线镜像、全栈 Compose、internal 网络隔离、断网 Debian 容器安装、native/Docker 单机安装、全栈离线一键包、企业插件 bundle/资源清单、更新源 static feed、补丁回移演练通过；mac/win 签名安装与全服务干净机验收待补 |
| S9 Web | DSH Web Host + Team panel control-plane 模式 | `evidence/S9/` | **部分**：同插件复用、两租户隔离、HttpOnly cookie 同源网关、浏览器 OIDC（本地 HS256/RS256 JWKS IdP）登录并看工单、同工单跨接入模式渲染一致、无原生对话/本地目录入口、Web 审批、CSRF origin 校验、local logout / OIDC RP-initiated logout、云端项目发起/打断（Docker+fake ACP）通过；真实企业 IdP/真实 agent 待补 |
| S10 手机 | Team panel 响应式 | `evidence/S10/` | **部分通过**：390×844 响应式、手机审批、手机审批→tool-gateway callback→等待 task resume、设备上行脱敏 + WebSocket/主机 tcpdump 抓包、配对设备远程 `local_dir` 发起/跟进/打断/离线补发/报告与 follow-up UI 已验；真机与真实等待 agent 联调待补 |

## 下一步优先级（不需要人工等待的）

1. 用本地 OIDC provider 验证 RS256/JWKS，而不是只测 HS256。
2. 增加 Vault/KMS 的本地 mock 接口与轮换/失败测试。
3. 把 Azure/GitLab 真实 connector 补齐到与 GitHub 相同的 issue→branch→PR 路径。
4. 完成全栈 Compose + 离线 bundle 的干净机器一键安装演练。
5. 准备 mac/win 构建机与签名/公证凭据，完成 S8 真机安装。

## 必须人工等待/外部条件的

- S1 的 macOS/Windows 启动、5 天使用；
- S4 的 10 个工作日真实使用；
- S5 的干净机器安装、真实 SSO IdP、KMS；
- S7 的真实 GitHub/GitLab issue→MR、M2 真崩溃恢复；
- S8 的签名/公证、真实客户 30 天；
- S10 的 iOS/Android 真机。

# 实施状态（滚动更新）

| 阶段 | 代码 | 证据 | 状态 |
| --- | --- | --- | --- |
| S0 前提 | `docs/spike.md`、`evidence/S0/` | auth/tenant/coexist/agent-interface | **完成** |
| S1 fork/遥测 | `deepseek-harness` 仅 `apps/desktop/src/main.ts` 改动；`plugins/telemetry-off*` | `evidence/S1/` | **部分**：Linux 构建、10 分钟零外联抓包通过；mac/win 启动与 5 天使用待补 |
| S2 契约/内核 | `packages/contracts`、`kernel-api`、`kernel-dsh`、`fake-kernel` | `evidence/S2/` | **完成** |
| S3 本机闭环 | `packages/executor-local`、`plugins/executor-local`、`apps/autobot` | `evidence/S3/` | **完成**：真实 DSH AgentLoop、Bot/DSH Web Host SIGKILL/重启、模型断线、previews/TTL、lost 自动 resume 重试、sandbox orphan sweep 通过；tag `executor-v0.1.0` |
| S4 工单界面 | `plugins/client-ui-team`、`packages/app-contract`、`apps/autobot/src/server.ts` | `evidence/S4/` | **部分**：发起/阶段/diff/排序/断线清空/审批/慢任务打断通过；四插件拆分与 10 天自用待补 |
| S5 登录/租户 | `plugins/account-sso`、`apps/control-plane`（含 device gateway/model gateway）、Desktop enterprise gate | `evidence/S5/` | **部分**：OIDC/隔离/配对/长连接/模型网关/隐私 badge/个人 Bot 派工/原生入口管理员开关通过；真实 IdP、KMS、单机安装待补 |
| S6 工具网关 | `apps/tool-gateway`、`packages/analytics`、local_dir 上行过滤 | `evidence/S6/` | **部分**：审批/审计/fail-closed/分级/Bot 事件接线/Vault-style 凭据适配通过；真实 KMS/Vault、真实抓包待补 |
| S7 云执行 | `packages/cloud-executor`、`packages/kernel-acp` | `evidence/S7/` | **部分**：Docker/ACP/真实 dsh+pi（含 sandbox）/同工单内核一致性/云端 repo clone/资源限额与 env 隔离/SQLite 恢复/GitHub+gateway 审批写通过；真实 Issue→MR、M2 真崩溃待补 |
| S8 发布 | `plugins/brand-siriusx`、`deploy/release`、`deploy/offline` | `evidence/S8/` | **部分**：品牌/图标/打包参数、Linux 离线包、native/Docker 单机安装（control-plane+tool-gateway）通过；mac/win 签名安装、DSH Web/sandbox 镜像与全服务干净机验收待补 |
| S9 Web | DSH Web Host + Team panel control-plane 模式 | `evidence/S9/` | **部分**：同插件复用、两租户隔离、HttpOnly cookie 同源网关、无原生对话/本地目录入口、Web 审批、云端项目发起/打断（Docker+fake ACP）通过；真实 OIDC/真实 agent 待补 |
| S10 手机 | Team panel 响应式 | `evidence/S10/` | **部分通过**：390×844 响应式、手机审批、配对设备远程 `local_dir` 发起/跟进/打断/离线补发/报告与 follow-up UI 已验；真机待补 |

## 下一步优先级（不需要人工等待的）

1. 把 S9 的 control-plane token 注入改成带鉴权的反向代理 + HttpOnly 会话。
2. 把 tool-gateway 审批卡接入 Team panel。
3. 用真实 `dsh` / `pi` 二进制替换 S7 的 fake ACP agent。
4. 把 CloudExecutor 状态持久化到 SQLite，并接 Bot 服务的 `lost` 重试。
5. 准备 mac/win 构建机与签名/公证凭据，完成 S8 真机安装。

## 必须人工等待/外部条件的

- S1 的 macOS/Windows 启动、10 分钟抓包、5 天使用；
- S3 的 15 分钟 Host kill/restart；
- S4 的 10 个工作日真实使用；
- S5 的干净机器安装、真实 SSO IdP、KMS；
- S7 的真实 GitHub/GitLab issue→MR、M2 真崩溃恢复；
- S8 的签名/公证、真实客户 30 天；
- S10 的 iOS/Android 真机。

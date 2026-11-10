# S5 证据：登录、租户与单机控制面

## 已完成

| 能力 | 实现 | 验证 |
| --- | --- | --- |
| 企业 OIDC account provider | `plugins/account-sso`，替换 `deepseekAccount` seam，PKCE + state/nonce + JWKS/HS256 校验 | `01-sso/run.txt` |
| 租户上下文 | `siriusxTenant` Host service，OIDC claims 更新/清除 | `01-sso/run.txt` 的 tenant probe |
| 多租户控制面 | `apps/control-plane`：tenant/user/settings/device/pairing/bot/ticket | `03-control-plane/run.txt` |
| 设备配对与吊销 | 配对码 10 分钟、一次性消费、device token hash、撤销后拒绝 | `03-control-plane/run.txt` |
| 个人 Bot 最小版 | 创建/列出 owner bot；每租户独立 Bot runtime | `03-control-plane/run.txt` |
| 管理开关 | `nativeConversationEnabled` / `byokEnabled` / `localExecutionEnabled`，仅 admin 可改 | `03-control-plane/run.txt` |
| 租户模型网关 | 校验 SSO session，代理上游，上游 key 只在 gateway env | `03-control-plane/run.txt`；单测验证上游收到 Bearer key |
| Desktop 企业模式入口 | `enterprise.ts`、welcome 只显示 SSO、Host 环境注入、`needsWelcome` 强制登录 | `02-desktop/enterprise-config.txt`、`desktop-build.txt` |
| 单机部署骨架 | `deploy/single-box/Dockerfile`、`docker-compose.yml`、`install.sh` | `04-install/compose-config.yml` |

## 验收对照

| 验收项 | 状态 |
| --- | --- |
| 两个租户 SSO 后数据隔离 | **通过**：bots B 为空、跨租户 ticket 读失败 |
| 不登录请求 Bot API 被拒 | **通过**：401 |
| 登录后原生对话标识 / 管理员开关 | **部分**：设置 API 与 Desktop 源码 gate 已实现；Electron 运行时未在 Linux 验证 |
| 未配对 / 吊销设备不能建长连接 | **部分**：配对/吊销与 device token 校验已实现；WebSocket 设备入口网关未实现 |
| 本机抓包/磁盘没有模型上游 Key | **部分**：gateway 代码与测试证明 key 只在服务进程 env，不下发；未做真实抓包 |
| 断网 15 分钟 / lost | **未完成** |
| 插件被手工启用但服务端拒绝 | **已有基础**：服务端 session/role 校验；未做界面篡改实测 |
| 单机安装脚本在干净机器跑通 | **未完成**：compose config 通过；Docker Hub/apt 网络阻塞镜像构建 |
| 私有化单机一体 | **骨架完成**：Docker Compose + installer；需在目标客户网络复验 |

## 已知边界

- 当前 control-plane 的 HTTP 鉴权使用 HMAC session token，登录入口仍是本地 fake IdP；
  生产 SSO 应把 OIDC ID token / session 交给入口网关验证。
- device pairing 有 token，但“本地 Executor 主动建立长连接”的 gateway 尚未实现。
- `nativeConversationEnabled` 已控制服务端设置；Desktop 的「个人、不审计」视觉标识尚未接入。
- 单机 Docker 镜像默认从 Docker Hub 拉 `debian:bookworm-slim`，当前执行环境网络无法完成；
  构建命令与 compose config 已验证。

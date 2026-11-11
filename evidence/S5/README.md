# S5 证据：登录、租户与单机控制面

## 已完成

| 能力 | 实现 | 验证 |
| --- | --- | --- |
| 企业 OIDC account provider | `plugins/account-sso`，替换 `deepseekAccount` seam，PKCE + state/nonce + JWKS/HS256 校验 | `01-sso/run.txt` |
| 租户上下文 | `siriusxTenant` Host service，OIDC claims 更新/清除 | `01-sso/run.txt` 的 tenant probe |
| 多租户控制面 | `apps/control-plane`：tenant/user/settings/device/pairing/bot/ticket | `03-control-plane/run.txt` |
| 设备配对与吊销 | 配对码 10 分钟、一次性消费、device token hash、撤销后拒绝 | `03-control-plane/run.txt` |
| 设备长连接网关 | WebSocket 握手校验 device token；心跳重验；吊销后关闭 4001；`POST /v1/devices/:id/tickets` 下发 `ticket.assign`；离线补发 | `03-control-plane/device-gateway-test.txt`、`evidence/S10/05-device-ui/` |
| 个人 Bot 最小版 | 创建/列出 owner bot；`POST /v1/bots/:id/tickets` 只能派给 bot owner 自己的已配对设备；端到端执行成功 | `05-personal-bot/` |
| 管理开关 | `nativeConversationEnabled` / `byokEnabled` / `localExecutionEnabled`，仅 admin 可改 | `03-control-plane/run.txt` |
| 租户模型网关 | 校验 SSO session，代理上游，上游 key 只在 gateway env | `03-control-plane/run.txt`；单测验证上游收到 Bearer key |
| Desktop 企业模式入口 | `enterprise.ts`、welcome 只显示 SSO、Host 环境注入、`needsWelcome` 强制登录 | `02-desktop/enterprise-config.txt`、`desktop-build.txt` |
| 单机部署骨架 | `deploy/single-box/Dockerfile`、`docker-compose.yml`、`install.sh` | `04-install/compose-config.yml` |

## 验收对照

| 验收项 | 状态 |
| --- | --- |
| 两个租户 SSO 后数据隔离 | **通过**：bots B 为空、跨租户 ticket 读失败 |
| 不登录请求 Bot API 被拒 | **通过**：401 |
| 登录后原生对话标识 / 管理员开关 | **通过**：侧栏「个人 · 不审计」badge；关闭 `nativeConversationEnabled` 后 badge 与原生 New Session/发送/工作区入口同时隐藏 |
| 未配对 / 吊销设备不能建长连接 | **通过**：WebSocket 握手拒绝伪造 token，已连接设备吊销后下次心跳关闭 |
| 本机抓包/磁盘没有模型上游 Key | **部分**：gateway 代码与测试证明 key 只在服务进程 env，不下发；未做真实抓包 |
| 断网 15 分钟 / lost | **未完成** |
| 插件被手工启用但服务端拒绝 | **已有基础**：服务端 session/role 校验；未做界面篡改实测 |
| 单机安装脚本在干净机器跑通 | **未完成**：compose config 通过；Docker Hub/apt 网络阻塞镜像构建 |
| 私有化单机一体 | **骨架完成**：Docker Compose + installer；需在目标客户网络复验 |

## 已知边界

- 当前 control-plane 的 HTTP 鉴权使用 HMAC session token，登录入口仍是本地 fake IdP；
  生产 SSO 应把 OIDC ID token / session 交给入口网关验证。
- device gateway 只实现了注册/心跳/服务端下发消息；本地 Executor 的任务协议、断线重连和 `lost` 结算仍需接。
- `nativeConversationEnabled` 已控制服务端设置、侧栏「个人 · 不审计」badge 与原生对话入口；
  证据：`04-native-label/native-disabled.png`、`gate-off.txt`。
- 单机 Docker 镜像默认从 Docker Hub 拉 `debian:bookworm-slim`，当前执行环境网络无法完成；
  构建命令与 compose config 已验证。

## Session expiry

- control-plane session token 加入 `exp`，默认 12h TTL；
- 过期后 `verifySession` 返回 `SESSION_EXPIRED`；
- 证据：`04-session-expiry/`。

## Server authority

- 未登录请求 `/v1/bots` 和 `/v1/tickets` 均为 401；
- 服务端不依赖客户端插件状态。
- 证据：`05-server-authority/`。

## Pairing rate limit

- 5 次失败后 5 分钟窗口内拒绝配对；
- 证据：`07-pairing-rate-limit/`。

## Device token rotation

- 可轮换 device token，旧 token 立即失效。
- 证据：`08-device-token-rotation/`。

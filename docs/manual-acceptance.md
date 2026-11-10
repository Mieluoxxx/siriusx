# 人工/外部资源验收手册

这份手册只覆盖当前环境无法自动完成、需要真实机器、真实凭据或真实时间的项。
每项都写清：前置、操作、证据保存位置、通过标准。

## 1. macOS / Windows Desktop

前置：

- macOS 机器与 Apple Developer ID / notary 凭据；
- Windows 机器与 Authenticode 证书；
- 对应平台的 Node 24、pnpm 11.28.5。

操作：

```bash
cd deepseek-harness
DSH_DESKTOP_TARGET_PLATFORM=darwin pnpm --filter @deepseek-ai/dsh-desktop package:mac:arm64
# 或 Windows:
DSH_DESKTOP_TARGET_PLATFORM=win32 pnpm --filter @deepseek-ai/dsh-desktop package:win:x64
```

未签名预验可用 `*:unsigned`，但正式验收必须签名/公证。

证据：

- 安装包 SHA256；
- 签名验证输出；
- macOS `spctl --assess`、Windows `signtool verify`；
- 安装后的 About 页面截图、`SiriusX` 品牌截图。

通过标准：

- 系统无未知开发者警告；
- 启动后无上游品牌/账号入口；
- 原生对话与 Team 面板均可用。

## 2. 正式安装包遥测/网络验收

前置：签名安装包、`tcpdump`/Wireshark。

操作：

- 安装并启动，完成一轮原生对话与一轮 Team 工单；
- 抓取 10 分钟网络；
- 搜索磁盘中的上游 key 与遥测端点。

通过标准：

- 无请求发往上游遥测/日志端点；
- 磁盘中找不到模型上游密钥；
- 内容只到租户模型网关/自有服务。

证据：

- pcap 文件；
- `grep` 结果；
- 安装包版本号。

## 3. 真实企业 OIDC

前置：

- IdP issuer、client ID/secret、redirect URI；
- 若用 RS256，提供 JWKS URI；
- control-plane 已开通对应 tenant 与管理员邮箱。

配置：

```text
SIRIUSX_SSO_SERVICE_TOKEN=<service secret>
SIRIUSX_OIDC_ISSUER=https://idp.example
SIRIUSX_OIDC_CLIENT_ID=siriusx-web
SIRIUSX_OIDC_CLIENT_SECRET=<secret>
SIRIUSX_OIDC_REDIRECT_URI=https://siriusx.example/auth/oidc/callback
SIRIUSX_OIDC_TENANT_ID=tenant-acme
SIRIUSX_OIDC_ROLE=member
```

操作：

- 浏览器走 `/login` SSO；
- 验证 `/v1/me` 的 tenant/user/role；
- 执行 RP-initiated logout。

通过标准：

- 真实 IdP 登录成功；
- 用户映射正确；
- 登出后 session 失效。

## 4. 真实 Vault / KMS

前置：

- Vault/KMS 地址、token/role、secret path；
- 网络策略允许 control-plane/tool-gateway 访问。

操作：

```text
SIRIUSX_CREDENTIAL_URL=https://vault.example/v1/secret/data
SIRIUSX_CREDENTIAL_TOKEN=<service token>
```

- 读取 github/gitlab 凭据；
- 轮换 secret 后等待 TTL，确认重新拉取；
- 关闭 Vault 权限，确认 fail-closed。

通过标准：

- 凭据只在 gateway；
- agent env/audit/log 无凭据；
- 失效时拒绝执行而不是回退到明文。

## 5. 真实 GitHub / GitLab Issue → MR

前置：

- 测试组织/仓库、App/Token、审批人账号；
- 机器人有 branch/PR/MR 权限。

操作：

- 创建 Issue；
- Bot 读取、修改文件、创建分支；
- 审批后创建 PR/MR；
- 检查审计链、Web 端工单与通知。

通过标准：

- 真实 Issue → 分支 → 文件 → PR/MR 成功；
- 写操作都有审批记录；
- 审计不含 token。

## 6. iOS / Android 真机

前置：

- 一台 iPhone、一台 Android；
- 手机与电脑可访问测试环境。

操作：

- 手机打开 Web Gateway；
- 选择已配对电脑和本地目录；
- 发起、follow-up、Stop `local_dir` 任务；
- 审批一张卡，确认等待中的电脑任务继续；
- 断网/重连。

通过标准：

- 上述四条在两种真机都通过；
- 上行只有状态/摘要，无日志/文件内容。

证据：

- 真机录屏；
- 设备抓包；
- 工单轨迹截图。

## 7. 5 / 10 / 30 天使用

- S1：连续 5 个工作日作为日常工具；
- S4：连续 10 个工作日用工单，至少 8 天完成真实任务；
- S8：真实客户连续 30 天。

证据：

- 按周汇总工单数、合并数、故障记录；
- 用户反馈与未解决阻塞。

## 8. 补丁回移与更新

- 冻结分支：`release/executor-0.1`；
- 当前已演练 `executor-v0.1.1`；
- 正式客户升级需签名 artifact + 自有更新源 + 已安装客户端收到更新。

通过标准：

- 客户端版本号变化；
- 更新从 `SIRIUSX_UPDATE_URL` 下载；
- 回滚路径可用。

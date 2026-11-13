# SiriusX TODO

更新：2026-11-11（Round 91 / 200）

## 当前判断

自动化可完成的主干已基本收敛：

- S0–S10 均有代码与 `evidence/` 证据
- 本地发布门禁通过
- 剩余 plan 条目主要依赖真实机器、真实凭据或真实时间

详见：

- `docs/plan.md`
- `docs/status.md`
- `docs/manual-acceptance.md`

## 已完成（最近新增）

- [x] 四个独立 Team UI package
- [x] 真实 Pi / DSH 内核与 Docker sandbox 内执行
- [x] 本地/云端 DSH 事件序列一致性
- [x] 云端 repo clone、allowlist、资源限额、env 隔离
- [x] 云端 assignment timeout
- [x] Cloud sandbox dispose / 无残留容器
- [x] cloud ticket 控制面重启对账
- [x] audit hash chain + `/v1/audit/verify` + ticket trace 合并
- [x] Vault KV v1/v2、TTL 轮换、fail-closed
- [x] 设备离线宽限 lost、宽限期重连恢复
- [x] 设备上行脱敏 + WebSocket/主机 tcpdump 抓包
- [x] 配对失败限流、device token 轮换
- [x] HTTP/WS Origin 校验、登录限流、Secure cookie、logout/OIDC RP-initiated logout
- [x] 全栈离线一键包、DSH Web 离线镜像、internal 网络测试
- [x] 发布清单、依赖清单、CycloneDX SBOM、SBOM/插件/更新源发布门禁
- [x] 服务 `/ready` 就绪探针（DB + 上游依赖）
- [x] Device token 30 天 TTL + 过期后轮换恢复
- [x] 1 MiB 请求体上限（control-plane/tool-gateway/web-gateway）
- [x] 完整 release gate 重跑（68 shell + 42 ESM）
- [x] Device WebSocket 1 MiB frame 上限（close 1009）
- [x] Device 心跳超时清理（close 4002）
- [x] Compose `/ready` healthcheck（control-plane/tool-gateway/web-gateway）
- [x] Cloud repo URL 校验（scheme + credentials）
- [x] Tool audit 查询按 tenant 隔离
- [x] Tool gateway 默认关闭 wildcard CORS
- [x] local_dir symlink 越界防护
- [x] Server-side session revocation + logout 联动
- [x] Login CSP + frame/nosniff headers
- [x] OIDC state 绑定浏览器 cookie（缺失/不匹配 400）
- [x] Preview 环境变量隔离（不继承 host secrets）
- [x] Sandbox cap-drop ALL + no-new-privileges（真实 DSH 回归）
- [x] Approval 过期自动标记（list 时 sweep）
- [x] 容器内全栈离线安装（无 curl，node fetch fallback）
- [x] Update feed realpath/path-traversal 防护
- [x] Kubernetes/Kustomize 基础（4 服务、PVC、probe、NetworkPolicy、Ingress）
- [x] SQLite backup/restore（VACUUM INTO + hash + retention）
- [x] Prometheus `/metrics` + K8s scrape annotations
- [x] Prometheus alert rules + Grafana dashboard
- [x] K8s backup CronJob + 多数据目录 backup
- [x] GitHub Actions CI（typecheck/test/release gate/artifacts）
- [x] cert-manager/TLS optional overlay（staging-first）
- [x] GHCR 镜像构建/推送 workflow（静态校验）
- [x] Fluent Bit log collection config + optional DaemonSet
- [x] Management plane API（platform tenants/users + tenant users/roles）
- [x] Management plane UI（tenant settings/users/role）
- [x] Platform admin `admin-web` UI（租户列表/创建/usage/users）
- [x] Tenant quotas + usage enforcement（users/devices/tickets）
- [x] Model catalog + tenant model binding（backend + admin-web + runtime enforcement）
- [x] admin-web 全量 React + Base UI，单一主题；移除 StyleX 与页面级自定义 CSS
- [x] Tenant tool policy（backend + control-plane proxy + Admin UI）
- [x] Tenant audit summary（tool gateway aggregate + Admin UI）
- [x] Platform admin audit trail（tenant/model/quota/user operations）
- [x] Daily usage trend（cloud/device tickets）
- [x] Tenant SSO/config editing + platform audit
- [x] Emergency support access request/approval workflow
- [x] Tenant suspend/resume + platform audit
- [x] Tenant billing rates + estimated cost
- [x] Source bindings + GitLab webhook idempotent ingestion
- [x] GitLab webhook auto-dispatch → cloud ticket（Docker 验证）
- [x] GitHub webhook HMAC + idempotent ingestion
- [x] Feishu/Teams inbound webhook base（token + binding + idempotency）
- [x] Tenant audit CSV export（tool-gateway + control-plane proxy + Admin UI）
- [x] Source event manual dispatch + Tenant Admin UI
- [x] Platform audit CSV export
- [x] GitHub webhook auto-dispatch → cloud ticket（Docker 验证）
- [x] Postgres schema + SQLite→Postgres 离线迁移（19 表，真实 PG 验证）
- [x] Postgres 迁移 preflight（计数 + orphan 检查）
- [x] Postgres Stage 2.1：@siriusx/storage 异步边界（SQLite + PostgreSQL，真实 PG 测试）
- [x] Postgres Stage 2.2a：platform_audit 运行时走 PostgresStorage（真实 PG 测试）
- [x] Postgres Stage 2.2b：support_requests 运行时迁移（真实 PG 测试）
- [x] Postgres Stage 2.2c：tenant_billing 运行时迁移（真实 PG 测试）
- [x] Postgres Stage 2.2d：tenants/settings 镜像写入（async provision/update/status）
- [x] Postgres Stage 2.2e：tenants/settings/users 镜像写入（真实 PG 测试）
- [x] Postgres Stage 2.2f：model_catalog/tenant_models 读写迁移（真实 PG 测试）
- [x] Postgres Stage 2.2g：source_bindings/source_events 读写迁移（真实 PG 测试）
- [x] Postgres Stage 2.2h：tenants/users 主读取迁移（PG 启动缓存，真实 PG 测试）
- [x] Postgres Stage 2.2i：settings/quota 主读取（PG cache，真实 PG 测试）
- [x] Postgres Stage 2.2j：定时缓存刷新（真实 PG 测试）
- [x] Postgres Stage 2.2k：LISTEN/NOTIFY 即时失效（真实 PG 双实例测试）
- [x] Postgres Stage 3a：tool-gateway approvals/policies/audit 运行时 cutover（真实 PG）
- [x] Postgres Stage 3b：autobot schema + 离线迁移（真实 PG 验证）
- [x] Postgres Stage 3b.1：autobot migration preflight（真实 PG）
- [x] Postgres Stage 3c：autobot 运行时 cutover（真实 PG 测试）
- [x] Postgres 全运行时：control-plane + tool-gateway + autobot（SQLite 保留离线模式）
- [x] Desktop Enterprise SSO → control-plane session exchange
- [x] Team Panel 自动 bootstrap control-plane session
- [x] SSO tenant model metadata 注入与本地 Executor model provider 注入
- [x] Desktop SSO token refresh（offline_access + refresh_token 主动刷新）
- [ ] control-plane logout revocation
- [x] Web Gateway 支持 X-Forwarded-Proto/Host 的 HTTPS Origin
- [x] Trusted proxy 下的登录限流按 X-Forwarded-For 区分客户端
- [x] HTTPS 下返回 HSTS
- [x] Cloud follow-up 浏览器端到端（Team panel Send → 新 assignment → person/review）
- [x] 许可证策略门禁（阻断 GPL/AGPL/SSPL/BUSL）
- [x] macOS DMG 交叉构建阻塞证据

## 不需要外部资源的下一步

1. [x] Cloud ticket follow-up 稳定性
   - 单 CloudExecutor 复用 + 清空旧 report + ticket-global 事件序号
   - 第二次 assignment 完成回到 person/review
2. [x] Device 管理 UI
   - Devices tab：配对、最后在线时间、Rotate token、Revoke
   - 浏览器实测配对成功
3. [x] Full-stack 干净 volume/network 复跑
   - `down -v` + 删除 `.env` + `install-full.sh`
   - 4 服务 Up、3 个 health 通过；真正全新 OS 仍保留为外部 blocker
4. [x] Shell/ESM 语法与 CRLF 检查
   - 63 shell + 39 ESM 已通过；真实 macOS/Windows 执行仍保留为外部 blocker
5. [x] SBOM 深度与许可证
   - 已递归 transitive 依赖（170 个组件）
   - 118 个组件带 license 元数据；其余缺少上游 license 字段

## 必须外部资源 / 人工等待

- [ ] macOS/Windows 真机 + Developer ID/Authenticode + notarization
- [ ] 真实企业 OIDC IdP 的 issuer/client/role mapping
- [ ] 真实 KMS/Vault 端点与权限
- [ ] 真实 GitHub/GitLab 仓库凭据与机器人身份 + 真实 Issue→MR
- [ ] iOS/Android 真机
- [ ] S1 5 天、S4 10 天、S8 30 天真实使用
- [ ] 自有 CDN/更新域名 + 签名 artifact + 客户端实际更新

## 门禁命令

```bash
./scripts/release-check.sh
```

包含：typecheck、test、fork discipline、安装覆盖、插件 bundle、更新 feed 语法、依赖清单、SBOM、发布清单。

## Model router / 企业模型上游

- [x] 基于 lite-cpa 的内部格式转换服务
- [x] 多 upstream / priority fallback
- [x] 管理面保存 URL / API Key / upstream model / protocol
- [x] API Key AES-GCM 加密、列表只返回掩码
- [x] Model Gateway 按租户和模型转发 lite-cpa
- [x] 本地 mock upstream 端到端验证
- [x] `siriusx` LLM provider（Model Gateway + control session token）
- [x] enterprise.json `bundles` 接线（profile 自动挂载）
- [ ] 真实企业上游 URL / API Key 联调

服务端对齐清单见 `docs/server-alignment.md`。
- [x] 管理面 upstream 配置 + 多上游 fallback + 本地 mock 端到端
- [x] 租户模型页只保留开通/停用/默认；上游 Key 只在平台侧 Upstreams 页管理
- [ ] 管理面 upstream 连通性测试按钮
- [ ] 每 upstream 超时 / 权重 / 健康检查

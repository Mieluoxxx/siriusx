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

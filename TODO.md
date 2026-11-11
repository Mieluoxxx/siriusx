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
- [x] macOS DMG 交叉构建阻塞证据

## 不需要外部资源的下一步

1. [ ] Cloud ticket follow-up 稳定性
   - 当前已知不稳定：第二次 assignment 在控制面复用时挂起
   - 需要先做 CloudExecutor 生命周期/复用设计，不能带病提交
2. [ ] Device 管理 UI
   - 展示 token 轮换、撤销、最后在线时间
   - 目前只有 API/服务端能力
3. [ ] Full-stack 干净机器演练
   - 在全新主机/Docker 环境跑 `install-full.sh`
   - 验证全服务、health、OIDC 可选配置
4. [ ] 发布门禁覆盖 WSL/macOS/Windows 的脚本语法检查
   - 目前主要是 Linux 验证
5. [ ] SBOM 深度
   - 当前为 workspace 直接依赖；补 transitive 依赖/许可证信息

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

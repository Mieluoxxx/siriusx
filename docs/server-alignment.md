# 服务端对齐清单

客户端侧改造已完成。下面是**服务端需要确认/配合**的事项，按阻塞程度排序。

## 1. `/v1/sso/desktop/exchange` 必须接受刷新后的 id_token（阻塞）

客户端现在会在 id_token 过期前用 refresh_token 换新的，然后拿新 id_token 调 exchange。

需要确认：

- [ ] Keycloak realm 已为 `siriusx-desktop` 客户端启用 **`offline_access`**（否则不发 refresh_token）
- [ ] exchange 侧 `SIRIUSX_SSO_DESKTOP_JWKS_URI` 指向的 JWKS 能验签刷新后的 token
- [ ] `SIRIUSX_SSO_DESKTOP_CLIENT_ID` 与客户端一致（`siriusx-desktop`）

验证命令：

```bash
# 用刷新后的 id_token 换 session，应返回 200 + token/tenantId/role/model
curl -s -X POST http://192.168.14.39:4320/v1/sso/desktop/exchange \
  -H 'content-type: application/json' \
  -d '{"idToken":"<刷新后的 id_token>"}' | head -c 400
```

## 2. Model Gateway 的 `/v1/models` 必须返回已绑定模型（阻塞）

客户端 `siriusx` provider 用它填充模型选择器：

```json
{ "object": "list", "tenantId": "tenant-acme",
  "data": [{ "id": "acme-default", "object": "model", "owned_by": "tenant-acme", ... }] }
```

需要确认：

- [ ] `tenant-acme` 在 `tenant_models` 里有绑定记录（否则 `data` 为空）
- [ ] 对应 `model_catalog` 记录 `enabled = 1`
- [ ] 每个已绑定模型在 `tenant_model_upstreams` 里至少有一条 `enabled = 1` 的上游

验证命令：

```bash
# 用 control session token（不是 Keycloak token）
curl -s http://192.168.14.39:4321/v1/models \
  -H "Authorization: Bearer <control-plane session token>" | head -c 400
```

> 注意：这里必须是 control-plane 的 HMAC session token。Keycloak 的 `access_token`
> 会被 `verifySession()` 拒绝（返回 `401 invalid session token`），客户端已按此实现。

## 3. Model Gateway 的 `/v1/messages` 必须路由到 model-router（重要）

客户端只走 Anthropic Messages 协议（`messagesApiRoot()` 自动补 `/v1`）。

需要确认：

- [ ] `SIRIUSX_MODEL_ROUTER_URL` 已配置（`http://model-router:8317`）
- [ ] `deploy/single-box/docker-compose.offline.yml` 里 `model-router` 使用 `--profile full` 启动
- [ ] `SIRIUSX_MODEL_ROUTER_CONFIG=/data/model-router/config.yaml` 已设置，且文件权限 `0600`
- [ ] model-router 生成的 config 里存在 `anthropic-messages` 段（协议为 `claude` 的上游）

验证命令：

```bash
# 期望 200 + SSE 流
curl -s -X POST http://192.168.14.39:4321/v1/messages \
  -H "Authorization: Bearer <control-plane session token>" \
  -H 'content-type: application/json' \
  -d '{"model":"acme-default","max_tokens":16,"messages":[{"role":"user","content":"hi"}]}' | head -c 300
```

## 4. `enterprise.json` 的 `bundles` 字段（新约定）

客户端现在会读 `enterprise.json` 的 `bundles` 并把它们挂进 profile：

```json
{
  "enabled": true,
  "bundles": ["@siriusx/dsh-account-sso", "@siriusx/dsh-llm-siriusx"],
  "enterpriseModelProvider": "siriusx",
  "modelGatewayUrl": "http://192.168.14.39:4321",
  "controlPlaneUrl": "http://192.168.14.39:4320"
}
```

要求：**列出的包必须已经能从安装树的 `node_modules` 解析到**。
`bundles` 只做选择，不负责安装。

## 5. 需要服务端确认的取值

| 项 | 客户端假设 | 请确认 |
|---|---|---|
| 租户 id | `tenant-acme` | ? |
| 默认模型 id | 由 exchange 返回的 `model.id` | ? |
| 网关地址 | `http://192.168.14.39:4321` | ? |
| 控制面地址 | `http://192.168.14.39:4320` | ? |
| IdP issuer | `http://192.168.14.39:8081/realms/siriusx` | ? |

## 6. 已知的服务端侧遗留项（不阻塞本次）

- [ ] 管理面 upstream 连通性测试按钮（`TODO.md`）
- [ ] 每 upstream 超时 / 权重 / 健康检查
- [ ] 真实企业上游 URL / API Key 联调

## 附：客户端侧已完成的改动

| 区域 | 改动 |
|---|---|
| `plugins/llm-siriusx` | 新增 `siriusx` provider，走 Model Gateway + control session token |
| `plugins/account-sso` | scope 加 `offline_access`；存 refresh_token；过期前主动刷新；失败原因暴露到 `/__siriusx/tenant` |
| `apps/desktop/src/enterprise.ts` | 补 `ssoAuthorizePath`/`ssoTokenPath`/`bundles`；新增 `enterpriseTrustedOrigins` |
| `apps/desktop/src/account-backend.ts` | 浏览器白名单支持内网 HTTP IdP |
| `apps/desktop/src/project-manager.ts` | `applyRelease` 接受 enterprise bundles |
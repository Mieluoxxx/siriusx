# Enterprise SSO → Desktop control plane

本轮补齐：

- `POST /v1/sso/desktop/exchange`
  - 验证 OIDC ID token（HS256/JWKS）
  - tenant/email/roles claim
  - 调用 `ssoSession`
  - 返回 control-plane bearer token
  - 返回 tenant 默认模型 metadata
- `plugins/account-sso`
  - OIDC callback 后自动 exchange
  - loopback `/__siriusx/control-plane` 暴露 session 给 Team Panel
  - `siriusxTenant` 保存 controlPlaneUrl/token/model
  - 可选 `SIRIUSX_CONTROL_PLANE_REQUIRED=1`
- Team Panel
  - `ensureControlSession()` 自动 bootstrap
  - 不再依赖测试脚本手工写 `localStorage.controlToken`
- `plugins/executor-local`
  - 读取 `siriusxTenant`
  - 可选 `SIRIUSX_ENTERPRISE_MODEL_PROVIDER` 注入 tenant 默认模型
- enterprise.json / env projection 传入 controlPlaneUrl、model provider

证据：`control-plane-test.txt`、`account-sso-build.txt`、`team-typecheck.txt`、`executor-typecheck.txt`。

补充验证：

- control-plane desktop exchange test：40 tests
- account-sso build 通过
- client-ui-team typecheck/build 通过
- executor-local typecheck 通过
- DSH Desktop 5 个 run-gates 通过

模型注入：

- control-plane exchange 返回 tenant default model
- `siriusxTenant.model` 保存 model metadata
- `/__siriusx/control-plane` 返回 model
- `SIRIUSX_ENTERPRISE_MODEL_PROVIDER` 配置后，executor-local 使用 tenant model id

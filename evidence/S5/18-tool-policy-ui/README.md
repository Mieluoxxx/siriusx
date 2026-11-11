# Tenant tool policy UI

Tool gateway 新增租户 tool policy：

- `GET /v1/policies`
- `PUT /v1/policies/:actionClass` effect=`approval|deny`
- `DELETE /v1/policies/:actionClass`

规则：

- tenant policy 只能收紧，不能放宽内置基线；
- deny 直接拒绝；
- approval 强制审批。

control-plane 通过 `/v1/tool-policies` 代理；Team Admin tab 可新增/删除 policy。

浏览器实测：设置 `send_email` = approval，列表出现该 policy，Audit summary 显示；
平台创建 support request 后，tenant admin 在 Team Admin 中批准，状态变为 approved；console errors 为空。
证据：`run.txt`、`policy.png`、`test.txt`、`proxy-typecheck.txt`。

# Feishu / Teams inbound webhooks

新增：

- `POST /v1/sources/feishu/webhook`
- `POST /v1/sources/teams/webhook`

共同：

- `X-SiriusX-Source-Token`
- source binding 按 `chat_id` / `conversation.id` 映射租户
- delivery id 幂等
- 可选 `autoDispatch` → cloud ticket

Feishu：

- 支持 URL verification challenge
- 解析 `im.message.receive_v1` 文本

Teams：

- 解析 activity `conversation.id` / `text`

说明：这是 token 校验的接入基础；飞书加密事件、Teams 完整 Bot Framework JWT 校验仍需真实租户配置后补齐。
证据：`test.txt`、`typecheck.txt`。

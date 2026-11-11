# Source bindings + GitLab webhook ingestion

- `source_bindings`：provider / externalId / tenant / repo / baseRef
- `source_events`：delivery id 唯一，幂等去重
- `POST /v1/admin/source-bindings`
- `POST /v1/sources/gitlab/webhook`
  - `X-Gitlab-Token`
  - `X-Gitlab-Event`
  - `X-Gitlab-Event-UUID`
- platform `/admin` 可创建 source binding
- tenant admin 可查看 `/v1/source-events`
- binding 可开启 `autoDispatch`，自动生成 cloud ticket

验证：

- 错误 webhook token → 401
- 第一次 delivery → accepted
- 重复 delivery → duplicate
- 租户 source events 只有 1 条
- 未知 project binding → 202 ignored

证据：`test.txt`、`typecheck.txt`、`ui-typecheck.txt`、`../15-platform-admin-ui/admin.png`。

# Tenant source-event controls

- Tenant Admin UI 展示 source events
- 显示 provider / event type / status / ticketId
- `POST /v1/source-events/:id/dispatch` 支持手动补派发
- `ControlPlane.dispatchSourceEvent` 复用 cloud ticket 创建路径

证据：`typecheck.txt`、`build.txt`、`api-typecheck.txt`。

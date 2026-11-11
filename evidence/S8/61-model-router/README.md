# Model router / protocol conversion

已完成：

- `services/model-router`：复制 lite-cpa 核心（MIT，作者自有）
- Chat / Responses / Claude 协议转换
- 同一 tenant/model alias 多 upstream
- priority + provider failover
- Control Plane 生成 `/data/model-router/config.yaml`
- Model Gateway 做 tenant session、模型绑定校验、`tenant/model` alias 改写
- 管理面配置 upstream URL / API Key / upstream model / protocol / priority / enabled
- API Key AES-256-GCM 加密，列表只返回掩码
- Router 只走内部网络，不暴露给 Desktop

本地真实链路已验证：

```text
Keycloak id_token
→ /v1/sso/desktop/exchange
→ control-plane session
→ Model Gateway
→ model-router :8317
→ local mock upstream :18081
→ stream chat completions
```

管理页截图见 `admin-upstreams.png`。

证据：`go-test.txt`、`go-build.txt`、`config.sample.json`、`desktop-exchange.json`、`chat-stream-final.txt`。

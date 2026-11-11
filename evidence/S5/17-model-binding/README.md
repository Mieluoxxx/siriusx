# Tenant model binding at runtime

- Model Gateway `/v1/models` 返回该租户绑定的模型；
- `/v1/chat/completions` 会解析请求的 `model`：
  - 未绑定模型返回 400 `MODEL_NOT_BOUND`；
  - 绑定模型继续转发到 tenant upstream。
- 测试验证 tenant-default、model-a 可用，model-unbound 被拒绝。
- 证据：`test.txt`、`typecheck.txt`。

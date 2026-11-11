# Model catalog on PostgreSQL

Stage 2.2f：

- model_catalog / tenant_models 读写走 Storage 接口
- `provisionTenant` 镜像默认模型绑定
- `addModel` / `listModelCatalog` / `listTenantModels` / `bindTenantModel` async
- Model Gateway `/v1/models` 和 chat model 校验 await
- 真实 PostgreSQL 测试模型创建、默认绑定、读取、清理
- SQLite 仍保留兼容写入

证据：`test.txt`、`typecheck.txt`。

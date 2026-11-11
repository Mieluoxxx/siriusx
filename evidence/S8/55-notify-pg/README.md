# PostgreSQL LISTEN/NOTIFY cache invalidation

Stage 2.2k：

- `Storage.listen?()` 可选能力
- `PostgresStorage.listen()` 使用专用 `PoolClient` LISTEN
- `ControlPlane.startCacheInvalidation()` 订阅 `siriusx_cache_change`
- 租户/用户/settings/quota 写操作发送 `pg_notify`
- 对端 control-plane 收到通知后 `refreshCache()`
- 真实 PG 双实例测试：A 创建 tenant，B 在 2s 内可见
- 定时刷新仍保留作为兜底

证据：`test.txt`、`typecheck.txt`。

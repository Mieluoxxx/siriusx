# PostgreSQL cache refresh

Stage 2.2j：

- `ControlPlane.refreshCache()` 可重新加载 tenants/users/settings/quotas
- `startControlPlaneServer` 支持 `storage` 和 `cacheRefreshMs`
- CLI serve 传入 `DATABASE_URL` 和 `SIRIUSX_CACHE_REFRESH_MS`
- 后台定时刷新（默认 30s，`.unref()`，close 时清理）
- 真实 PG 测试：外部插入 tenant/settings/quota 后刷新可见

这是多副本一致性的最小机制；强一致仍需 LISTEN/NOTIFY 或共享缓存失效。
证据：`test.txt`、`typecheck.txt`。

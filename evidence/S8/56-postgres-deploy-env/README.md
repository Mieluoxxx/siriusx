# PostgreSQL deployment env wiring

- Compose control-plane 传入 `DATABASE_URL` 和 `SIRIUSX_CACHE_REFRESH_MS`
- K8s ConfigMap 增加 `SIRIUSX_CACHE_REFRESH_MS`
- K8s Secret 可选 `DATABASE_URL`
- CLI 把空字符串视为未配置，避免空连接串启动失败
- `pnpm typecheck`、K8s manifest check、Compose config 通过

证据：`compose.txt`、`k8s.txt`、`cli-empty.txt`。

# 发布前本地门禁

`scripts/release-check.sh` 顺序执行：

- `pnpm typecheck`
- `pnpm test`
- fork discipline
- install coverage
- plugin bundle
- update feed 语法检查
- 依赖清单 `artifacts/release/dependencies.json`

本次全部通过。证据：`run.txt`。

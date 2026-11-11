# GitHub Actions CI

新增 `.github/workflows/ci.yml`：

- checkout
- pnpm 11.28.5
- Node 24 + pnpm cache
- PyYAML for manifest validators
- `pnpm install --frozen-lockfile`
- `pnpm typecheck`
- `pnpm test`
- `./scripts/release-check.sh`
- upload `artifacts/release/`

`scripts/check-ci.py` 校验 workflow 结构并接入 release-check。

证据：`validate.txt`。

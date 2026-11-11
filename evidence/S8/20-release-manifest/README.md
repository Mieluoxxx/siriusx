# 发布清单

`scripts/build-release-manifest.mjs` 生成 `artifacts/release/manifest.json`，记录：

- SiriusX root commit / describe
- DSH fork commit / branch
- executor contract tag
- control-plane / DSH Web / sandbox image tags
- Node/pnpm 版本

证据：`run.txt`、`manifest.json`。

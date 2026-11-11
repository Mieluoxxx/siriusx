# CycloneDX SBOM

`scripts/build-sbom.mjs`：

- 读取 workspace 各 package 的直接依赖；
- 去重 name@version；
- 输出 CycloneDX 1.5：
  - `artifacts/release/sbom.cdx.json`

本次生成 44 个组件，格式为 `CycloneDX 1.5`。证据：`run.txt`、`sbom.cdx.json`。

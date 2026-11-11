# CycloneDX SBOM（transitive）

`scripts/build-sbom.mjs`：

- 读取 `pnpm list -r --depth Infinity --json`；
- 递归遍历 dependencies；
- 去重 name@version；
- 正确编码 scoped package 的 purl；
- 输出 CycloneDX 1.5：
  - `artifacts/release/sbom.cdx.json`

本次生成 170 个组件，格式为 `CycloneDX 1.5`。证据：`run.txt`、`sbom.cdx.json`。

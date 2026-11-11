# CycloneDX SBOM（transitive + license）

`scripts/build-sbom.mjs`：

- 读取 `pnpm list -r --depth Infinity --json`；
- 递归遍历 dependencies；
- 去重 name@version；
- 正确编码 scoped package 的 purl；
- 从 `node_modules/<pkg>/package.json` 读取 license；
- 输出 CycloneDX 1.5：
  - `artifacts/release/sbom.cdx.json`

本次生成：

- 组件：170
- 有 license 元数据：118
- 其余组件缺少 package.json license 字段或为 workspace 包。

证据：`run.txt`、`sbom.cdx.json`。

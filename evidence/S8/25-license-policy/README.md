# License policy gate

`scripts/check-license-policy.mjs` 读取 CycloneDX SBOM：

- 阻断 GPL/AGPL/SSPL/BUSL；
- 对 LGPL 和未知 license 发 warning；
- 当前 170 个组件：0 blocked，52 unknown warnings。

已接入 `release-check.sh`。证据：`run.txt`。

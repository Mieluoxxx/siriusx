# 发布与品牌

## 已落地

- `plugins/brand-siriusx`：关闭 `ui-brand-official`，侧栏显示 SiriusX 标记/名称，标题强制为 SiriusX。
- `deploy/release/brand/`：SVG / mac PNG / Windows ICO。
- `apps/desktop/scripts/electron-builder-config.mjs` 支持：
  - `SIRIUSX_PRODUCT_NAME`
  - `SIRIUSX_ARTIFACT_PREFIX`
  - `SIRIUSX_ICON_MACOS`
  - `SIRIUSX_ICON_WINDOWS`
- `deploy/release/build-desktop.sh` 在对应 OS 上调用上游打包脚本（用法见下节）。

## 桌面安装包

```sh
deploy/release/build-desktop.sh <mac-arm64|mac-x64|win-x64> [--unsigned] [--dry-run]
```

- 脚本名映射到 `deepseek-harness` 根脚本：`mac-arm64` → `package:desktop:mac:arm64`，加 `--unsigned` → `package:desktop:mac:arm64:unsigned`。必须走根脚本：它把仓库自带的 JS 版 pnpm 放到 PATH 前面，而 `package-target.ts` 会用 `node $npm_execpath` 重新启动 pnpm，直接 `pnpm --filter … run` 时 `npm_execpath` 是全局原生 pnpm，会以 `SyntaxError` 失败。
- 不带 `--unsigned` 走签名（macOS 另含公证），需要发布凭据；本机验证用 `--unsigned`。
- `--dry-run` 只打印解析后的计划（脚本名、品牌、企业配置、随包插件目录、产物目录），不构建。
- 随包企业插件：`SIRIUSX_ENTERPRISE_CONFIG` 指向 enterprise.json，其 `bundles` 里的每个包按包名在 `plugins/` 下找目录，先构建、再随包打包；找不到目录或构建后入口文件仍缺失会直接失败。也可用 `SIRIUSX_PLUGIN_DIRS`（按平台路径分隔符分隔）直接指定目录，优先于配置推导。两者都不设时只带上游默认的 `resources/enterprise.json`，不带企业插件。
- 产物在 `deepseek-harness/apps/desktop/.desktop-build/targets/<target>/artifacts/`，`--unsigned` 时为同级的 `unsigned-artifacts/`。脚本只打印本次构建新生成的安装包，不改动 `dist/`。
- 品牌化（`SIRIUSX_PRODUCT_NAME` 等）暂不可用：上游 `smoke-packaged-runtime.ts` 按名字打开 `DeepSeek Harness.app`，产品名一改，打包完成后冒烟会因 `app.asar` ENOENT 失败（mac-arm64 `--unsigned` 实测）。脚本因此在设置了其它产品名时直接拒绝；要启用品牌化，需先让该冒烟脚本跟随产品名。`SIRIUSX_ARTIFACT_PREFIX`、`SIRIUSX_ICON_MACOS`、`SIRIUSX_ICON_WINDOWS` 原样传给 electron-builder，未单独验证。

## 仍需在 mac/win 真机完成

- macOS Developer ID 签名 + notarization；
- Windows Authenticode + NSIS 安装器；
- 更新源指向 SiriusX 域名；
- 在正式安装包上重做遥测/网络抓包与离线安装验收。

## 版本冻结

冻结分支命名 `release/siriusx-<major>.<minor>`。交付合同必须写清：

1. 版本冻结期（建议 90 天）；
2. 安全补丁的处理时限（建议 P0 24h / P1 7d）；
3. 升级窗口（建议每月第一个周二，紧急补丁例外）。

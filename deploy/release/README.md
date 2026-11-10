# 发布与品牌

## 已落地

- `plugins/brand-siriusx`：关闭 `ui-brand-official`，侧栏显示 SiriusX 标记/名称，标题强制为 SiriusX。
- `deploy/release/brand/`：SVG / mac PNG / Windows ICO。
- `apps/desktop/scripts/electron-builder-config.mjs` 支持：
  - `SIRIUSX_PRODUCT_NAME`
  - `SIRIUSX_ARTIFACT_PREFIX`
  - `SIRIUSX_ICON_MACOS`
  - `SIRIUSX_ICON_WINDOWS`
- `deploy/release/build-desktop.sh` 在对应 OS 上调用上游打包脚本。

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

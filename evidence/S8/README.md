# S8 证据：品牌与发布骨架

## 已完成

- 品牌插件 `plugins/brand-siriusx`：
  - 关闭 `ui-brand-official`；
  - 侧栏显示 SiriusX 标记/名称；
  - 文档标题强制为 SiriusX。
- 品牌资产 `deploy/release/brand/`：SVG、macOS PNG、Windows ICO。
- electron-builder 配置支持 `SIRIUSX_PRODUCT_NAME`、`SIRIUSX_ARTIFACT_PREFIX`、
  `SIRIUSX_ICON_MACOS`、`SIRIUSX_ICON_WINDOWS`。
- 离线包脚本 `deploy/offline/build-offline.sh` 与安装脚本。
- 版本冻结条款模板 `deploy/release/README.md`。

## 验证

- 真实 DSH Web Host 安装品牌插件后，侧栏显示 `SiriusX`，标题为 `SiriusX`，
  控制台无错误：`01-brand/sidebar-brand.png`、`01-brand/check.txt`。
- electron-builder 配置在 darwin/win32 两个目标下返回：
  `productName=SiriusX`、`artifactName=siriusx-${version}-${os}-${arch}-unsigned.${ext}`，
  图标路径指向 SiriusX 资产：`01-brand/electron-builder-config.txt`。

## 验收对照

| 验收项 | 状态 |
| --- | --- |
| 换品牌、去官方账号入口 | **部分**：品牌与账号 provider 已有；欢迎页/关于页仍有上游文案 |
| macOS/Windows 签名安装包 | **未完成**：当前 Linux 环境不能产 mac/win 包 |
| 企业插件打进安装包 | **部分**：插件机制与 bundle patch 已有；安装包资源清单未接 |
| 断网安装 | **未完成** |
| 我方更新源 | **未完成**：配置字段已留 |
| 正式包遥测抓包 | **未完成** |
| 补丁回移演练 | **未完成** |
| 真实客户 30 天 | **未完成** |

## 边界

- 本环境无法运行 macOS notarization / Windows Authenticode。
- `build-desktop.sh` 必须在目标 OS 上执行；Linux 只验证了配置解析。

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
- 实测生成 27MB `siriusx-offline-linux-x64.tar.gz`，解包后启动 control-plane，
  开通租户、签发 token、读取 settings、创建 Bot 均成功；无需 npm registry。证据：`03-offline-run/`。
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
| 断网安装 | **部分**：离线包在本机解包后可启动 control-plane 并完成租户/Token/Bot 操作；未在真正断网干净机验桌面/Web。证据：`03-offline-run/` |
| 我方更新源 | **未完成**：配置字段已留 |
| 正式包遥测抓包 | **未完成** |
| 补丁回移演练 | **未完成** |
| 真实客户 30 天 | **未完成** |

## 边界

- 本环境无法运行 macOS notarization / Windows Authenticode。
- `build-desktop.sh` 必须在目标 OS 上执行；Linux 只验证了配置解析。

## 当前架构图与 roadmap 重写

- `docs/images/01-overview-current.png`：当前总览；
- `docs/images/04-app-current.png`：Web / Desktop / Mobile 当前形态；
- `docs/roadmap.md` 的 W1/W2 已按实际实现重写；
- 证据副本：`04-brand-release-docs/`。

## 原生单机安装

- `deploy/single-box/install-native.sh` 支持：
  - 复制 control-plane / tool-gateway / autobot / packages / node_modules
  - 生成 `siriusx.env`（0600）
  - 生成 systemd unit 或 `--no-systemd --start` 前台启动
  - 启动后检查 4320/4330 健康
- 实测（临时 prefix）：
  - control-plane 健康
  - tool-gateway 健康
  - 开通租户、签发 token、读取 settings 成功
- 证据：`05-native-install/`。
- 未覆盖：DSH Web Host、web-gateway、Docker sandbox 镜像；完整单机仍需一并编排。

## Docker 离线单机镜像

- `deploy/offline/build-offline.sh` 生成 staging app；
- `deploy/single-box/Dockerfile.offline` 用本机已有基础镜像构建 `siriusx/control-plane:offline2`；
- `docker-compose.offline.yml` 同时启动 control-plane 与 tool-gateway；
- 实测：
  - control-plane `/health` OK
  - tool-gateway `/health` OK
  - 容器内开通租户、签发 token、读取 settings、创建 Bot 成功
- 证据：`06-docker-offline/`。

注意：本机测试镜像基于已有 `teams-bridge:0.2.0`（Node 22）以避开 Docker Hub
下载阻塞；正式交付镜像仍需固定 Node 24 基础镜像 digest。

## 补丁回移演练

- 冻结线：`executor-v0.1.0`；
- 分支：`release/executor-0.1`；
- 主分支修复 `8553c8c docs: clarify preview expiry contract`；
- cherry-pick 到冻结线，契约 25 个测试通过；
- 打标签 `executor-v0.1.1`，生成 patch 文件。
- 证据：`07-backport/`。

## 离线包全依赖更新

- 离线 bundle 增加 cloud-executor、kernel-acp、web-gateway；
- 解包 control-plane health、租户、token、settings 通过；修复 ACP fixture 后离线包内 cloud_project 任务也跑通。
- 证据：`08-offline-full/`。

## DSH Web Host 离线镜像

- 新增 Dockerfile/构建脚本，把 Node 24、DSH 源码、SiriusX 插件和预生成 profile 打进镜像；
- 容器启动无需 pnpm/网络，能输出 token URL 并加载 SiriusX/Team 插件。
- 证据：`09-dsh-web-image/`。

## 全栈 Compose

- `docker-compose.offline.yml --profile full` 同时启动：
  - control-plane
  - tool-gateway
  - DSH Web Host
  - web-gateway
- DSH Web 容器写 token URL 到共享卷，web-gateway 读取并代理；
- 实测：
  - 三个健康端点通过
  - `/auth/session` 204
  - `/v1/me` 返回租户用户
  - `/` 经 web-gateway 返回 DSH Web 200
- 证据：`10-full-compose/`。

## 离线 sandbox 镜像

- `build-offline.sh` 将 `teams-bridge:0.2.0` 保存进 bundle 的 `sandbox-image.tar`；
- `install-offline.sh` 启动前 `docker load`，并把 `SIRIUSX_SANDBOX_IMAGE` 传给 control-plane；
- 解包后无外网启动 control-plane，cloud_project 任务在 Docker sandbox 内到 `person/review`。
- 证据：`11-offline-sandbox/`。

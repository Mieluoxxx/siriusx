# 离线包全依赖更新

- `build-offline.sh` 现在打包：
  - `apps/control-plane`
  - `apps/autobot`
  - `apps/tool-gateway`
  - `apps/web-gateway`
  - `packages/cloud-executor`
  - `packages/kernel-acp`
- 解包后在空目录启动 control-plane：
  - `/health` 通过
  - 开通租户/签发 token/读取 settings 通过
- 证据：`build.txt`、`health.txt`、`tenant.json`、`settings.json`、`packages.txt`、`apps.txt`。

本次 smoke 不包含云端 sandbox 任务；DSH Web Host 与 sandbox 镜像仍未纳入离线包。

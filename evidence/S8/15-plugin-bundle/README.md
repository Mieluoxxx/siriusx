# 企业插件打包

- `deploy/release/build-plugin-bundle.sh` 收集 10 个企业插件并生成 manifest；
- DSH Desktop 资源清单新增 `enterprise-plugins.json`；
- electron-builder 在设置 `SIRIUSX_PLUGIN_BUNDLE` 时把插件 tar 打进 `extraResources`；
- `loadEnterpriseConfig` 支持 `SIRIUSX_BUNDLED_PLUGINS_DIR` 并投影给 Host。
- 证据：`manifest.json`、`build.txt`、`desktop-typecheck.txt`、`enterprise-config.txt`。

仍缺：在真实 mac/win 安装包中验证插件随包分发并由登录启用。

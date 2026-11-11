# macOS DMG build attempt on Linux

尝试在 Linux 主机交叉构建 mac-arm64 DMG：

```bash
DSH_DESKTOP_APP_ID=com.siriusx.desktop \
DSH_DESKTOP_UNSIGNED=1 \
DSH_DESKTOP_TARGET_PLATFORM=darwin \
DSH_DESKTOP_TARGET_ARCH=arm64 \
pnpm --filter @deepseek-ai/dsh-desktop package:mac:arm64:unsigned
```

结果：上游打包脚本明确拒绝：

```text
Error: desktop package: mac-arm64 requires a macOS build host
```

DMG/notarization 需要 macOS 的 `hdiutil`、`codesign`、`spctl` 等工具；
当前 Linux 环境无法生成可验证的 DMG。

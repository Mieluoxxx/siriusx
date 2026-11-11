# 离线安装包

`build-offline.sh` 生成 Linux x64 的 control-plane 离线包：

- Node 24（目标机需要预装；或改用同目录的 Docker 镜像方案）；
- `node_modules` 与 pnpm workspace；
- control-plane / autobot / tool-gateway 源码与依赖；
- `install-offline.sh` 直接启动 control-plane。

未包含：

- Docker 镜像（沙箱运行需要目标机预装镜像或私有 registry）；
- macOS/Windows 桌面安装包（需在对应 OS 上构建）。

真实离线环境验收仍需：目标机无外网、无 npm registry、无 Docker Hub。


Standalone platform admin:

```bash
OUT=/tmp/admin-web ./deploy/offline/build-admin-web-image.sh
```

The image serves the SPA on port 8090 and proxies only `/v1/admin/*` to the
control-plane. The full Compose profile starts it as `admin-web`.

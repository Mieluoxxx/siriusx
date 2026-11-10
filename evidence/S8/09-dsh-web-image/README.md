# DSH Web Host 离线镜像

- `deploy/single-box/Dockerfile.dsh-web`
- `deploy/offline/build-dsh-web-image.sh`
- 镜像内包含 Node 24、DSH 源码、SiriusX 插件与预生成 profile；
- 容器启动后无需联网、无需 pnpm，自动创建 DSH Web Host。

实测：

- 容器启动并输出 DSH Web token URL；
- `curl -L` 带 token 返回 HTTP 200；
- Chromium 打开后看到 SiriusX 品牌、Team 插件，无控制台错误。
- 证据：`build.txt`、`run.txt`、`dsh-web.png`。

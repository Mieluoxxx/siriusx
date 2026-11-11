# 容器内全栈离线安装（无 curl）

在 Debian 12 基础容器 `teams-bridge:0.2.0` 中运行离线 bundle：

- 容器内只有 node/openssl/bash，没有 curl；
- 挂载 host Docker socket、docker CLI、compose plugin；
- 执行 `/bundle/install-full.sh`；
- installer 现在优先用 curl，缺失时用 `node -e fetch` 健康检查；
- 4 个服务全部启动；
- control-plane / tool-gateway / web-gateway health 全部通过；
- `down -v` 清理成功。

这比“同一 host 干净 volume”更接近全新机器；真正全新 OS 仍保留为外部 blocker。

证据：`install.txt`、`verify.txt`、`install.err.txt`。

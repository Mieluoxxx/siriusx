# 全栈离线包干净安装复跑

流程：

1. `docker compose --profile full down -v --remove-orphans`
2. 删除旧 `.env`
3. 在无旧 volume/network 的状态下执行 `install-full.sh`
4. 验证 4 个容器启动
5. 验证 control-plane/tool-gateway/web-gateway 三个健康端点
6. `down -v` 清理

结果：

- install exit 0
- control-plane、tool-gateway、dsh-web、web-gateway 全部 Up
- 三个 health 全部 `ok:true`
- 清理 exit 0

说明：这是同一 Docker daemon 上的干净 volume/network/container 复跑；
真正的全新操作系统安装仍需外部机器，保留为 blocker。

证据：`install.txt`、`install.err.txt`、`verify.txt`。

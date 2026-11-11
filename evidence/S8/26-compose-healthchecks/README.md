# Compose healthchecks

在 `deploy/single-box/docker-compose.offline.yml` 增加：

- control-plane healthcheck → `http://127.0.0.1:4320/ready`
- tool-gateway healthcheck → `http://127.0.0.1:4330/ready`
- web-gateway healthcheck → `http://127.0.0.1:8080/ready`

容器内使用 `node -e fetch(...)`，无需额外安装 curl/wget。

验证：

- `docker compose config` 通过；
- 用含最新 `/ready` 的 `siriusx/control-plane:hc` 镜像启动全栈；
- control-plane、tool-gateway、web-gateway 三个容器均为 `healthy`；
- `docker inspect .State.Health` ExitCode 全部 0。

证据：`config.txt`、`up.txt`、`ps.txt`、`health.json`。

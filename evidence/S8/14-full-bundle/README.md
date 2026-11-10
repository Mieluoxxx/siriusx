# 全栈离线一键安装包

`build-full-bundle.sh` 生成：

- `control-plane.tar`
- `dsh-web.tar`
- `sandbox.tar`
- app bundle
- `docker-compose.yml`
- `install-full.sh`

`install-full.sh`：

- `docker load` 全部镜像
- 生成随机 session secret
- `docker compose --profile full up -d`
- 等待三个健康端点

实测：install exit 0；health 全通过；租户/token/web-gateway 登录 `/v1/me` 通过。
证据：`build.txt`、`install.txt`、`health.txt`、`login.txt`、`me.json`。

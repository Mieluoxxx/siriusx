# Standalone admin web image

新增：

- `apps/admin-web` 独立 SPA
- `apps/admin-web/Dockerfile`
- `deploy/offline/build-admin-web-image.sh`
- Compose `admin-web` service（8090）
- K8s `admin-web` Deployment/Service/Ingress
- GHCR workflow 构建 admin-web 镜像

镜像只代理 `/v1/admin/*` 到 control-plane，并保留平台 admin token；不暴露其他 API。

镜像运行验证：health 200、index 200、title 正确，随后清理容器。

证据：`build.txt`、`dist-build.txt`、`run.txt`、`ci.txt`、`k8s.txt`、`compose.txt`。

# Kubernetes Kustomize base

新增 `deploy/k8s/`：

- Namespace / ConfigMap / Secret example
- control-plane PVC + Deployment + Service
  - `/var/run/docker.sock` + host `/usr/bin/docker` for cloud sandbox
- tool-gateway PVC + Deployment + Service
- web Pod：dsh-web + web-gateway sidecar，共享 emptyDir 传递 DSH Web URL
- Web 与 Device WebSocket Ingress
- 最小 NetworkPolicy
- Kustomize image override

`scripts/check-k8s-manifests.py` 解析全部 YAML，校验资源引用和禁止 `:latest`。
本机没有 kubectl/kustomize，因此验证范围是 YAML/结构静态检查；真实集群 rollout 仍需集群资源。

证据：`validate.txt`。

# cert-manager / TLS overlay

- 两个 Ingress 增加 `cert-manager.io/cluster-issuer: letsencrypt-prod`；
- `deploy/k8s/optional/cert-manager.yaml` 提供 prod/staging ClusterIssuer；
- `deploy/k8s/optional/README.md` 说明 staging-first 与 DNS/email 前置条件；
- `check-k8s-manifests.py` 现在同时解析 optional YAML；
- 结果：11 YAML、23 documents，包含 ClusterIssuer。

真实 DNS、ACME 邮箱、HTTP-01 可达性属于外部基础设施输入。
证据：`validate.txt`。

# Log collection

新增：

- `deploy/observability/logging/fluent-bit.conf`
- `deploy/observability/logging/parsers.conf`
- `deploy/k8s/optional/fluent-bit.yaml`
- `deploy/observability/logging/README.md`

配置：

- tail `/var/log/containers/*.log`
- CRI parser
- Kubernetes metadata filter
- stdout output 示例（生产可换 Loki/Elastic）

验证：

- K8s optional manifest 解析通过；
- Fluent Bit 必需 section/input/filter/parser 检查通过；
- 已接入 release-check。

真实集群日志采集与保留策略仍需集群资源。
证据：`validate.txt`、`k8s-validate.txt`。

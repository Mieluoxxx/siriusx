# Prometheus alerts + Grafana dashboard

新增：

- `deploy/observability/prometheus/rules/siriusx-alerts.yml`
  - 3 个服务 down
  - audit hash chain invalid
  - pending approvals high
  - cloud ticket backlog
  - login failure source spike
- `deploy/observability/grafana/dashboard.json`
  - 6 个 panel
- `deploy/observability/README.md`
- `scripts/check-observability.py` 已接入 `release-check.sh`

验证：7 条 alert、6 个 panel。
证据：`validate.txt`。

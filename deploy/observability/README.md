# Observability

## Prometheus

Scrape the three internal `/metrics` endpoints:

```yaml
scrape_configs:
  - job_name: siriusx-control-plane
    metrics_path: /metrics
    static_configs:
      - targets: ["control-plane:4320"]
  - job_name: siriusx-tool-gateway
    metrics_path: /metrics
    static_configs:
      - targets: ["tool-gateway:4330"]
  - job_name: siriusx-web-gateway
    metrics_path: /metrics
    static_configs:
      - targets: ["web:8080"]
```

Load alerts:

```text
deploy/observability/prometheus/rules/siriusx-alerts.yml
```

The Kubernetes base also carries `prometheus.io/scrape` annotations; clusters
using the Prometheus Operator can add a ServiceMonitor separately.

## Grafana

Import:

```text
deploy/observability/grafana/dashboard.json
```

and select the Prometheus datasource when prompted.

## Alerts included

- control-plane / tool-gateway / web-gateway down
- audit hash chain invalid
- pending approvals high
- cloud ticket count high
- login failure source count high

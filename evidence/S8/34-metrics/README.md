# Prometheus metrics endpoints

新增：

- control-plane `/metrics`
  - up / tenants / users / devices / device_tickets / cloud_tickets
- tool-gateway `/metrics`
  - approvals pending/total、audit rows、audit chain valid
- web-gateway `/metrics`
  - up、OIDC enabled、pending OIDC states、login failure sources
- K8s pod annotations：`prometheus.io/scrape=true`

验证：三服务返回 Prometheus text；control-plane tenants=1/devices=1；
tool-gateway audits=1/audit_chain_valid=1；web up=1。

证据：`run.txt`、`control-typecheck.txt`、`tool-typecheck.txt`、`web-typecheck.txt`。

# Log collection

The base uses Fluent Bit to tail Kubernetes container logs and parse CRI
format. The example writes to stdout for local validation.

Production options:

- ship to Loki (`[OUTPUT] Name loki`)
- ship to Elastic/OpenSearch
- add a retention policy at the log store, not inside the application

Apply the optional Kubernetes DaemonSet:

```bash
kubectl apply -f deploy/k8s/optional/fluent-bit.yaml
```

Audit records are stored in `tool-gateway.sqlite`; database backups are handled
by `deploy/k8s/backup-cronjob.yaml`. Application audit retention is intentionally
not destructive by default; size that retention against the enterprise policy.

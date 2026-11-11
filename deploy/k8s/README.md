# SiriusX on Kubernetes

This directory is a **single-node-friendly Kustomize base** for the same four
services used by `deploy/single-box`:

- `control-plane` — HTTP API + model gateway + device WebSocket
- `tool-gateway` — policy, approvals, audit, Git connectors
- `web` — DSH Web Host + Web Gateway sidecar in one Pod
- Ingresses for the Web UI and device WebSocket

## Prerequisites

- Kubernetes 1.27+
- an ingress controller (the manifests assume `ingress-nginx`)
- a default StorageClass
- images pushed to a registry reachable by the cluster
- TLS secrets for the ingress hosts
- for cloud-project Docker sandbox execution: a Docker socket and Docker CLI on
  the node; the control-plane manifest mounts `/var/run/docker.sock` and host
  `/usr/bin/docker`. Remove those volumes if the cluster does not provide them;
  cloud project assignments will then fail rather than silently falling back to
  local execution.

## Configure

1. Create the namespace secret from the example (do **not** commit real values):

```bash
cp deploy/k8s/secret.example.yaml /tmp/siriusx-secret.yaml
# edit /tmp/siriusx-secret.yaml
kubectl create namespace siriusx --dry-run=client -o yaml | kubectl apply -f -
kubectl -n siriusx apply -f /tmp/siriusx-secret.yaml
```

2. Set real image names/tags. The base uses:

```text
siriusx/control-plane:offline
siriusx/dsh-web:offline
```

Override with Kustomize or edit `kustomization.yaml`.

3. Replace the example hosts in `ingress.yaml`:

```text
web.siriusx.example
device.siriusx.example
```

and create the referenced TLS secrets (`siriusx-tls`,
`siriusx-device-tls`), for example with cert-manager.

4. Optional OIDC: add these to the `siriusx-config` ConfigMap and put the
   client secret in `siriusx-secrets`:

```text
SIRIUSX_OIDC_ISSUER
SIRIUSX_OIDC_CLIENT_ID
SIRIUSX_OIDC_REDIRECT_URI
SIRIUSX_OIDC_TENANT_ID
SIRIUSX_OIDC_ROLE
SIRIUSX_OIDC_ID_TOKEN_ALG
SIRIUSX_OIDC_CLIENT_SECRET (Secret)
SIRIUSX_SSO_SERVICE_TOKEN (Secret)
```

## Apply

```bash
kubectl apply -k deploy/k8s
kubectl -n siriusx rollout status deploy/control-plane
kubectl -n siriusx rollout status deploy/tool-gateway
kubectl -n siriusx rollout status deploy/web
```

## Verify

```bash
kubectl -n siriusx get pods
kubectl -n siriusx port-forward svc/web 8080:8080
curl -s http://127.0.0.1:8080/health
curl -s http://127.0.0.1:8080/ready
```

Open `http://127.0.0.1:8080/login`, or the configured Ingress host.

## Backups

`backup-cronjob.yaml` runs daily at 02:00 UTC and writes compressed SQLite
snapshots plus a `SHA256SUMS` manifest to the `siriusx-backups` PVC. It mounts
the control-plane and tool-gateway data PVCs read-only and keeps the last 14
archives. Restore is manual; stop writers and use `deploy/backup/restore.sh`.

## Notes

- `control-plane` and `tool-gateway` are single-writer SQLite services; keep
  replicas at `1` unless the storage layer is replaced.
- `web` uses `Recreate` because the DSH home PVC is `ReadWriteOnce`.
- The DSH Web URL is generated at runtime and shared through an `emptyDir`
  between the two containers in the `web` Pod; no token is stored in the
  manifest.
- `networkpolicy.yaml` is intentionally minimal and assumes the ingress
  namespace is named `ingress-nginx`.
- This is a deployment baseline, not a managed production database or HA
  control plane.

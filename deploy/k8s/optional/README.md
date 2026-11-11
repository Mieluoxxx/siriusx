# Optional Kubernetes resources

## cert-manager

Apply only after cert-manager CRDs are installed:

```bash
kubectl apply -f deploy/k8s/optional/cert-manager.yaml
```

Then replace the placeholder ACME email and set the desired issuer on the
Ingress annotations:

```yaml
cert-manager.io/cluster-issuer: letsencrypt-prod
```

The base ingress uses these TLS secret names:

- `siriusx-tls` for `web.siriusx.example`
- `siriusx-device-tls` for `device.siriusx.example`

Use `letsencrypt-staging` for the first dry run, then switch to
`letsencrypt-prod`.

Real DNS, an ACME account email and publicly reachable HTTP-01 endpoints are
required; those are external infrastructure inputs.

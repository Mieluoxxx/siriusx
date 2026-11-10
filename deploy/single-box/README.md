# SiriusX single-box deployment

## Offline bundles

```bash
# control-plane / tool-gateway / web-gateway app bundle
OUT=/root/siriusx/artifacts/offline deploy/offline/build-offline.sh

# DSH Web Host image (requires local deepseek-harness checkout and /opt/node24)
OUT=/root/siriusx/artifacts/dsh-web IMAGE=siriusx/dsh-web:offline \
  deploy/offline/build-dsh-web-image.sh
```

## Docker Compose (full profile)

Set image tags and a session secret:

```bash
export SIRIUSX_SESSION_SECRET="$(openssl rand -base64 48 | tr -d '\n')"
export SIRIUSX_IMAGE=siriusx/control-plane:offline4
export SIRIUSX_DSH_WEB_IMAGE=siriusx/dsh-web:offline6
docker compose -f deploy/single-box/docker-compose.offline.yml --profile full up -d
```

This starts:

- control-plane
- tool-gateway
- DSH Web Host
- web-gateway

Health checks:

```bash
curl -sf http://127.0.0.1:4320/health
curl -sf http://127.0.0.1:4330/health
curl -sf http://127.0.0.1:8080/health
```

The DSH Web container writes its token URL to the shared `dsh-web-data` volume;
the web-gateway waits for it and attaches the Host cookie server-side. Browsers
only reach DSH Web through `:8080`.

OIDC can be enabled on the web-gateway with the `SIRIUSX_OIDC_*` /
`SIRIUSX_SSO_SERVICE_TOKEN` variables described in `apps/web-gateway/README.md`.

Caveats: the full compose is a local/offline validation path; production still
needs a pinned sandbox image, real signing and a truly isolated network run.

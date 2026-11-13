# Model router (lite-cpa based)

## Why

SiriusX must expose a stable OpenAI-compatible endpoint to Desktop while
supporting:

- OpenAI Chat Completions
- OpenAI Responses
- Anthropic Messages
- multiple tenants
- multiple models per tenant
- multiple upstreams per model
- per-tenant upstream URL and API key
- provider/key failover

`services/model-router` is a copied, internal-only build based on
[`Mieluoxxx/lite-cpa`](https://github.com/Mieluoxxx/lite-cpa) at commit
`a15be63f3736c0e5ea1a3a33682c77dd494039d1` (MIT, author-owned).

## Flow

```text
Desktop / DSH
  → Model Gateway :4321
      - verifies tenant session
      - verifies tenant model binding
      - rewrites model to tenant/model
  → model-router :8317 (internal only)
      - protocol conversion
      - provider/key selection
      - priority failover
  → upstream provider
```

The router is never exposed to the LAN. The control-plane is the only caller
and uses a service-only gateway key.

## Configuration

`tenant_model_upstreams` stores platform-owned upstream connections:

- tenant/model binding
- upstream display name
- protocol: `chat`, `responses`, `claude`
- base URL
- upstream model
- encrypted API key
- priority
- enabled

The control-plane writes a generated YAML-compatible JSON file:

```text
/data/model-router/config.yaml
```

`lite-cpa` watches the file and reloads it. The file must be mode `0600`.

## Compose

`deploy/single-box/docker-compose.offline.yml` adds `model-router` on the
internal network with no host port. `control-plane` and `model-router` share the
`siriusx-data` volume so the generated config is visible to both.

## Model Gateway

When `SIRIUSX_MODEL_ROUTER_URL` is set, Model Gateway forwards
`/v1/chat/completions`, `/v1/responses` and `/v1/messages` to the router after
tenant checks. Without it, the old direct upstream path remains as a fallback.

## Security notes

- Upstream API keys are AES-256-GCM encrypted in the database.
- Admin APIs only return `hasApiKey` and a mask.
- The generated router config contains plaintext upstream keys, so it is mode
  `0600` and lives on the server/private volume.
- Upstream URLs are validated as absolute HTTP(S) URLs without credentials.
- Upstream connections are managed in the platform admin `Upstreams` page,
  not in the tenant model page. Tenant pages only enable catalog models, choose
  the default model, and do not expose upstream URLs or keys.
- Platform operators configuring arbitrary URLs can create SSRF risk;
  production should add an allowlist or platform approval.

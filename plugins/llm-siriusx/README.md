# @siriusx/dsh-llm-siriusx

The `siriusx` LLM route. Desktop agents use it to reach the tenant's models
through the SiriusX Model Gateway instead of the public DeepSeek API.

## Why a separate route

The Gateway is an internal, tenant-scoped Messages endpoint. Two facts about it
differ from the official routes, and both are load-bearing:

- **The endpoint is the tenant Gateway**, named by `SIRIUSX_MODEL_GATEWAY_URL`
  (or `modelGatewayUrl` in `enterprise.json`). There is no public default.
- **The credential is the control-plane session token**, not the Keycloak
  `access_token`. The Gateway verifies the control-plane HMAC session; a
  Keycloak token is rejected there with `401 UNAUTHORIZED`.

Requests are authenticated per call from `siriusxTenant.controlPlaneToken`,
which `@siriusx/dsh-account-sso` owns and refreshes. This package never stores,
caches, or refreshes a credential of its own.

## Configuration

`enterprise.json`:

```json
{
  "modelGatewayUrl": "https://models.example",
  "enterpriseModelProvider": "siriusx"
}
```

`enterpriseModelProvider` must be `siriusx` for `@siriusx/dsh-executor-local` to
select this route; the two are a pair.

## Model catalog

The route reads `GET /v1/models` from the Gateway, which answers with the models
bound to the caller's tenant:

```json
{ "object": "list", "tenantId": "tenant-acme", "data": [{ "id": "acme-default", … }] }
```

Discovery is best-effort: when the listing is unavailable, the picker falls back
to the tenant default from the SSO exchange and the request path reports the
specific failure.

## Failure modes

| Code | Meaning |
| --- | --- |
| `MISSING_ENDPOINT` | `SIRIUSX_MODEL_GATEWAY_URL` is unset. |
| `NO_CONTROL_PLANE_SESSION` | The SSO exchange has not produced a session; sign in again. |
| `MODEL_NOT_BOUND` | Expected from the Gateway when a model is not bound to this tenant. |
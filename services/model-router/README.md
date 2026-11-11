# SiriusX model router

Internal protocol-conversion gateway based on
[`Mieluoxxx/lite-cpa`](https://github.com/Mieluoxxx/lite-cpa) at commit
`a15be63f3736c0e5ea1a3a33682c77dd494039d1` (MIT, author-owned).

It converts between OpenAI Chat Completions, OpenAI Responses and Anthropic
Messages, and aggregates multiple upstream providers/keys under one client
model alias. It is **internal only**: the port is not published to the LAN, and
SiriusX Model Gateway validates the tenant session before forwarding.

The SiriusX control-plane generates `config.yaml` from
`tenant_model_upstreams`; see `docs/model-router.md`.

```bash
go test ./internal/...
go build -trimpath -o /tmp/model-router ./cmd/lite-cpa
```

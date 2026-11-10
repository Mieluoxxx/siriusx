# @siriusx/dsh-telemetry-off-desktop

Disables the two Desktop-only upstream collection rows:

- `desktop-product-telemetry` (`@deepseek-ai/dsh-host-product-telemetry-otel`)
- `product-analytics` (`@deepseek-ai/dsh-client-product-analytics`)

Use together with `@siriusx/dsh-telemetry-off` in the Desktop profile. The
general bundle owns base rows that exist in every profile; this bundle owns
rows inserted only by `@deepseek-ai/dsh-web-app`.

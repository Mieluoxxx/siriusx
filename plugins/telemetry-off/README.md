# @siriusx/dsh-telemetry-off

A DSH bundle that removes upstream outbound telemetry and official-service
correlation from a SiriusX profile.

## What it changes

| Row / package | Upstream default | SiriusX |
| --- | --- | --- |
| `session-telemetry-otel` (`dsh-session-telemetry-otel`) | `FEEDBACK_ONLY`, same collector | `mode: DISABLED` + launcher disabled patch |
| `session-log-deepseek` (`dsh-session-log-deepseek`) | `enabled: true`; appends `dsh_session_log` to official model requests | row disabled |
| `command-feedback` (`dsh-command-feedback`) | official feedback ack carries anonymous home id | row disabled |
| `llm-deepseek` (`dsh-llm-deepseek-api-key`) | sends `x-deepseek-harness-user-id` | row disabled |
| `llm-deepseek-account` (`dsh-llm-deepseek-account`) | official account-backed inference | row disabled |
| `@deepseek-ai/dsh-anonymous-user-id` | library used by the three outbound consumers above | no outbound consumer remains |

## Install into a profile

```sh
dsh plugin --profile siriusx add link:/root/siriusx/plugins/telemetry-off
```

Desktop profiles also install `@siriusx/dsh-telemetry-off-desktop` for the two
Desktop-only rows (`desktop-product-telemetry`, `product-analytics`). The
plugin manager appends both bundles to `dsh.profile.bundles` automatically.

## Evidence

- `evidence/S1/telemetry-audit.md`: row-by-row defaults, endpoints, and tests.
- `evidence/S1/01-telemetry-off/`: profile dump and an offline launch that
  captures outbound connections.

## Caveat

The bundle intentionally disables the official DeepSeek model provider. A
SiriusX profile must configure either the tenant model gateway or another
OpenAI/Anthropic-compatible provider. This is required for the product's
"no upstream telemetry / no content leakage" guarantee.

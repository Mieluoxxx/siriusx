# Release gate rerun (Round 107)

在新增 readiness healthchecks、device TTL、WebSocket/request size limits 后重跑完整门禁：

- typecheck
- test
- fork discipline
- install coverage
- script portability：68 shell + 42 ESM
- plugin bundle
- update feed syntax
- SBOM：170 components / 118 licensed
- license policy：0 blocked / 52 warnings
- release manifest

结果：`release checks OK`。

证据：`release-check.txt`。

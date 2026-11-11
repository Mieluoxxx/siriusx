# Release gate rerun (Round 123)

在 OIDC state cookie、forwarded HTTPS Origin、trusted proxy、HSTS、sandbox cap-drop、
update-feed traversal、无 curl 全栈安装等改动后重跑：

```bash
./scripts/release-check.sh
```

结果：`release checks OK`

- typecheck / test
- fork discipline
- install coverage
- script portability：68 shell + 42 ESM
- plugin bundle / update feed syntax
- SBOM：170 components / 118 licensed
- license policy：0 blocked
- release manifest

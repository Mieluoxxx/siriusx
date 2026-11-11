# Audit verify HTTP endpoint

- `GET /v1/audit/verify` 仅允许 admin；
- 返回 `{ valid, checked }`；
- 现有审批测试中调用后返回 `valid=true`、`checked>=2`。
- 证据：`test.txt`、`typecheck.txt`。

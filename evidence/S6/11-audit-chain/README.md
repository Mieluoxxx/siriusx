# Tool gateway audit hash chain

- 每条 audit 记录包含 `prev_hash` 和 `hash`；
- hash 覆盖 tenant/ticket/action/decision/approval/result/created_at；
- `verifyAuditChain()` 逐条验证 previous hash；
- 测试篡改一条 audit 的 decision 后，验证返回 invalid。
- 证据：`test.txt`、`typecheck.txt`。

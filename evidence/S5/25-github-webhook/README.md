# GitHub webhook ingestion

- `POST /v1/sources/github/webhook`
- HMAC 校验：`X-Hub-Signature-256` + `SIRIUSX_GITHUB_WEBHOOK_SECRET`
- 事件类型：`X-GitHub-Event`
- 幂等：`X-GitHub-Delivery`
- 通过 source binding 绑定 `repository.full_name`
- 支持 `autoDispatch` → cloud ticket（与 GitLab 同一套 dispatch 路径）

测试：错误签名 401；相同 delivery 第一次 accepted，第二次 duplicate。
证据：`test.txt`、`typecheck.txt`。

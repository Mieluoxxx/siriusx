# Cloud assignment timeout

- `CloudExecutorOptions.assignmentTimeoutMs`，默认 30 分钟；
- kernel 超过时限时 assignment 结算为 `reported + failed`，reason=`cloud assignment timeout`；
- control-plane 支持 `SIRIUSX_CLOUD_ASSIGNMENT_TIMEOUT_MS`。
- 测试用 25ms timeout 验证。
- 证据：`test.txt`、`typecheck.txt`。

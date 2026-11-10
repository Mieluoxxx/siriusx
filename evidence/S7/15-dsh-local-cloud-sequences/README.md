# Local DSH vs Cloud ACP DSH event sequence

同一 prompt、同一 mock 模型、同一 DSH profile：

- 本地：`AcpBackend` 直连真实 DSH ACP；
- 云端：`AcpCloudKernel` 在 Docker sandbox 内跑真实 DSH ACP；
- `AcpCloudKernel` 新增 `onEvent` 供对比采集。

结果两边契约事件类型序列完全一致：

```text
user.message, turn.start, assistant.attempt.start, assistant.delta,
assistant.attempt.end, assistant.message, turn.end
```

云端报告 `kind=ready`。证据：`run.txt`、`typecheck.txt`。

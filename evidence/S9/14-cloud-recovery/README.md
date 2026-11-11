# Cloud ticket restart reconciliation

- 每个 cloud ticket 的 CloudExecutor 使用独立 SQLite assignment store；
- control-plane 启动时扫描非终态 cloud ticket；
- 未报告的任务结算为 `reported + failed`，阶段 `person/blocked_failed`；
- 测试模拟 control-plane 重启后 running cloud ticket 被结算。
- 证据：`test.txt`、`typecheck.txt`。

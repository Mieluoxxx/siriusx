# Pairing rate limit

- 同一 tenant/user 连续 5 次 pairing 失败后，5 分钟内返回 `PAIRING_RATE_LIMITED`；
- 窗口过后恢复；
- 测试：5 次坏码后第 6 次被拒，时间前进 5 分钟后同一有效码成功。
- 证据：`test.txt`、`typecheck.txt`。

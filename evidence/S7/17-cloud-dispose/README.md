# CloudExecutor sandbox disposal

- 新增 `CloudExecutor.dispose()`：先销毁所有 live sandbox，再关闭 assignment store；
- control-plane 每个 cloud assignment 完成后 `await executor.dispose()`；
- Memory provider 测试：dispose 前 1 个 live sandbox，dispose 后 0；
- 真实 Docker cloud project 复跑：任务到 `person/review`，结束后 managed container 数为 0。
- 证据：`test.txt`、`cloud-project-rerun.txt`。

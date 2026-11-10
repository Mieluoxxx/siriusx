# @siriusx/autobot

S2/S3 的本机 Bot + Executor 入口。S2 先提供 **BG1 场景运行器**：

```sh
pnpm --filter @siriusx/autobot autobot list
pnpm --filter @siriusx/autobot autobot run --scenario backgrounded-waiting
pnpm --filter @siriusx/autobot autobot run --scenario log-truncation --json
```

约束：

- 只使用内存状态，不启动进程、不访问网络、不调用模型。
- 每个场景的事件都经过 `AssignmentEventSchema` 校验。
- 假 Executor 的 workspace、workdir、预览、文件浏览、取消、断线和槽位行为
  都是契约的可编排实现，不是真实执行环境。

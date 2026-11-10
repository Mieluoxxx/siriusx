# Clean clone headless conversation

- 干净 clone 执行 `pnpm install`；
- 运行 `scripts/smoke-pi-conversation.sh`；
- 真实 Pi CLI + 本地 mock 模型返回 `SiriusX clean-clone conversation OK.`；
- 事件链：user.message → turn.start → assistant.delta → assistant.message → turn.end。

# Cloud ticket follow-up

- control-plane 使用单个长生命周期 CloudExecutor 复用 provider/assignment store；
- `POST /v1/tickets/:id/input` 对 cloud ticket 触发 `sendCloudFollowUp`；
- 每次 follow-up 生成新 assignment，清空旧 report，追加 ticket-global 事件序号；
- 同一 ticket 的第二次 assignment 能完成并回到 `person/review`；
- 任务结束后 managed container 数为 0。
- 证据：`run.txt`。

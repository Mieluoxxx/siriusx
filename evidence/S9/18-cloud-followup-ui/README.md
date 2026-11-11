# Cloud follow-up through the Team UI

- 预置一个已 ready 的 cloud ticket；
- 在 DSH Web Team panel 打开该 ticket；
- 在 `Follow-up / interrupt text` 输入内容并点击 Send；
- 浏览器捕获到 `POST /v1/tickets/:id/input`；
- 第二个 assignment 完成，ticket 保持 `person/review`；
- 报告摘要包含 `Continue the ticket from the previous report`；
- Events 从 seq 0–3 扩展到 seq 8；
- console errors 为空。

证据：`run.txt`、`followup.png`。

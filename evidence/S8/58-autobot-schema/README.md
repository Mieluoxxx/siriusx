# Autobot PostgreSQL schema groundwork

Stage 3b（schema + migration，不含运行时 cutover）：

- 新增 5 张 autobot 表：
  - autobot_tickets
  - autobot_assignments
  - autobot_assignment_events
  - autobot_pending_inputs
  - autobot_outbox
- migration tool 支持 SQLite `tickets/assignments/assignment_events/pending_inputs/outbox`
- 真实 PostgreSQL 18 迁移验证：
  - 1 ticket
  - 1 assignment
  - 1 event
  - 1 pending input
  - 1 outbox
- 抽样查询通过
- autobot 运行时仍为 SQLite

证据：`schema-check.txt`、`schema-apply.txt`、`migrate.txt`、`verify.txt`。

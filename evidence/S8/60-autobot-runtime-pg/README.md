# Autobot PostgreSQL runtime cutover

Stage 3c：

- `BotService` 支持 `storage?: Storage`
- tickets/assignments/events/pending inputs/outbox 读写切换 PostgreSQL
- `initialize()` 负责 reconcile + auto retry
- `createTicket/getTicket/listTickets/eventsForTicket` async
- dispatch/sendInput/cancel/flush 全链路 async storage
- server / CLI 支持 `DATABASE_URL`
- ControlPlane 的本地 Bot runtime 适配 async
- plugin executor-local 适配 async
- SQLite 仍默认

真实 PG 测试：

- create ticket
- dispatch
- assignment state
- event rows
- outbox
- ticket closed
- 27 tests passed

SQLite 测试：26 passed。

证据：`pg-test.txt`、`sqlite-test.txt`、`typecheck.txt`、`control-typecheck.txt`、`plugin-typecheck.txt`。

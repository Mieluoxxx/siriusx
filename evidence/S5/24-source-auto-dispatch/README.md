# GitLab webhook → cloud ticket auto-dispatch

- source binding 支持 `autoDispatch`
- GitLab Issue webhook 触发：
  - 幂等记录 source event
  - 生成 cloud ticket
  - 写入 source event status=`dispatched` + ticketId
- 真实 Docker + fake ACP 验证：
  - accepted=true
  - sourceStatus=dispatched
  - ticket stage=person/review
  - report=ready
  - managed container 残留 0

证据：`run.txt`、`test.txt`、`typecheck.txt`、`server-typecheck.txt`。

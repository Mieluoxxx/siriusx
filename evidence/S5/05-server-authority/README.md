# Server-side authority

- 未携带 session 的 `/v1/bots`、`/v1/tickets` 均返回 401；
- 带 tenant admin token 的 `/v1/bots` 返回 200；
- 界面插件启用/禁用不改变服务端判定。
- 证据：`test.txt`、`typecheck.txt`。

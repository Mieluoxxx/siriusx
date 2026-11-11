# 1 MiB JSON body limit

- control-plane / tool-gateway / web-gateway 都限制 JSON/反向代理请求体为 1 MiB；
- 超出返回 413 `PAYLOAD_TOO_LARGE`；
- 测试用 2 MiB body，三个服务均返回 413。
- 证据：`run.txt`、`typecheck.txt`、`web-typecheck.txt`。

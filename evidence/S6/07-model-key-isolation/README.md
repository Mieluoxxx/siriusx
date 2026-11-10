# 模型上游密钥隔离

- 启动 tenant model gateway，上游 key 为 `UPSTREAM_SECRET_KEY_7f3a`；
- tcpdump 只抓 client→gateway 端口 `14500`；
- client 请求成功 200；
- 上游 mock 收到 Bearer key；
- client 抓包中无 key；
- 对数据目录递归搜索无 key。
- 证据：`run.txt`。

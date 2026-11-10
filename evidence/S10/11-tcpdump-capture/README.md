# 主机 tcpdump 抓包

- 固定 device-gateway 端口 `14445`；
- 真机主机 `tcpdump -i any -A -nn -l 'tcp port 14445'`；
- 本地仓库与 fake kernel 输出包含 `LOCAL_SECRET_CODE_42`；
- 抓包 27 packets / 8472 bytes；
- 抓包文本不含 secret，ticket 正常到 `person/review`。
- 证据：`capture.txt`、`capture.cap`、`run.txt`。

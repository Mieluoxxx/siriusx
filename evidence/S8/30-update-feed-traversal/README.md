# Update feed path traversal hardening

`deploy/release/update-feed/server.mjs`：

- 以 realpath 解析 feed 根目录；
- 请求路径解析后再 realpath；
- 真实路径必须位于 feed 根目录内；
- symlink 指向目录外时返回 403；
- 编码 traversal 不返回文件（403/404）。

验证：正常 `latest.yml` 200；`/leak/secret.txt` symlink 403；编码 traversal 404。
证据：`run.txt`。

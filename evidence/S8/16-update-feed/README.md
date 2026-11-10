# 更新源静态服务

- `deploy/release/update-feed/build-feed.sh` 从已签名 artifact 生成 electron-updater 的 `stable.yml` / `stable-mac.yml`，含 sha512/size。
- `server.mjs` 提供静态 feed 与 artifact 下载。
- 本地实测：`/health`、`stable.yml`、artifact 下载均 200。

Electron builder 现在支持 `SIRIUSX_UPDATE_URL`（及 `SIRIUSX_UPDATE_CHANNEL`）：
stable/nightly generic feed，local http 仅允许 localhost。证据：`update-config.txt`。

仍缺：真实签名 artifact、CDN/域名、已安装客户端实际收到更新。

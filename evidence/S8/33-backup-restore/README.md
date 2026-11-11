# SQLite backup and restore

新增：

- `deploy/backup/sqlite-backup.mjs`：使用 `VACUUM INTO` 对在线 SQLite 做一致快照；
- `deploy/backup/backup.sh`：
  - control.sqlite
  - tool-gateway.sqlite
  - 可选 dsh-home / dsh-web-url
  - SHA256SUMS + archive sha256
  - 保留最近 `KEEP` 份（默认 7）
- `deploy/backup/restore.sh`：
  - 校验 archive 与 payload hash
  - 恢复 DB / DSH home
  - 清理旧 WAL/SHM

验证：

- 备份时 control.sqlite 值为 `before`
- 备份后源库改为 `after`
- restore 后值为 `before`
- dsh-home 文件恢复

证据：`run.txt`。

多数据目录支持：

- `SIRIUSX_DATA_DIRS=/data/control:/data/tool`
- backup.sh 从多个目录收集 control.sqlite / tool-gateway.sqlite
- 验证两个 DB 均被恢复，值分别为 control/tool。

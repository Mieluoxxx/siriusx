# Script portability checks

`scripts/check-script-portability.sh`：

- 对全部 tracked `*.sh` 执行 `bash -n`；
- 拒绝 shell 脚本中的 CRLF；
- 对全部 tracked `*.mjs` 执行 `node --check`。

本次结果：63 shell + 39 ESM。已接入 `release-check.sh`。

注意：这是语法/换行检查；真实 macOS/Windows 执行仍需对应机器。

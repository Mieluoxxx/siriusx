# Local workdir symlink escape

- `safePath` 在词法路径检查后，使用 `realpathSync` 解析 workdir 与目标；
- 目标 symlink 指向 workdir 外时返回 `PATH_OUTSIDE_WORKDIR`；
- 不存在的目标会检查其实际父目录，避免 symlink 父目录逃逸；
- 测试构造 `escape.txt -> /tmp/outside/secret.txt`，`readFile` 与 `listFiles` 均被拒绝。
- 证据：`test.txt`、`typecheck.txt`。

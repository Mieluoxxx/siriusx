# Preview 进程组清理

- preview 在非 Windows 上以 `detached: true` 启动，形成独立进程组；
- stop / TTL sweep 使用 `process.kill(-pid, SIGTERM)` 杀整个进程组；
- 2s 后补 SIGKILL，避免只杀 shell 留下子进程。
- 证据：`test.txt`、`typecheck.txt`。

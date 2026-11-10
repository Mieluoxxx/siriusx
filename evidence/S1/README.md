# S1 证据

基线：`deepseek-harness` @ `fcc0ad4621`，branch `siriusx/main`。

## 完成

- **[x] fork 与 upstream remote**：`00-fork/repo.txt`
- **[x] 锁定基线**：tag `siriusx-s1-base` 指向 `fcc0ad4621`
- **[x] 从源码构建**：
  - `pnpm run typecheck`：5/5 通过
  - `pnpm run build:artifacts`：8/8 通过
  - `pnpm run build:desktop`：通过
- **[x] 遥测关闭**：`telemetry-audit.md`、`01-telemetry/`
- **[x] 离线对话**：本地 mock 模型 + headless profile 完成多轮对话
- **[x] 10 分钟抓包**：27 轮离线对话，`nonloopback_inet_connects=0`
  （`01-telemetry/network-soak-10min.txt` / `.trace`）
- **[x] rebase 演练**：对 `upstream/master` 无冲突完成；但上游暂无新 tag
- **[x] fork 改动个位数**：`00-fork/diff-stat.txt`，1 个文件

## 阻塞/待复验

- **[ ] Desktop 实际启动**：源码构建通过；上游 Desktop build target 只支持
  `mac-arm64`、`mac-x64`、`win-x64`，当前 Linux 主机不能在 Electron 里启动。
  需要在 macOS/Windows 机器上复验。
- **[ ] 连续 5 个工作日真实使用**：需要真实时间，脚本无法替代。
- **[ ] rebase 到下一个上游 tag**：上游在当前时间没有比 `dsh-v0.2.2-rc.1`
  更新的 release tag；等发布后重跑。

## 目录

| 路径 | 说明 |
| --- | --- |
| `00-fork/` | remote、branch、commit、diff 数 |
| `01-telemetry/` | 遥测审计、组合 row、strace、本地 mock 请求摘要 |
| `02-conversation/` | 本地 mock LLM 与离线对话脚本 |
| `03-build/` | Desktop 构建日志与 Linux 启动阻塞日志 |
| `04-rebase/` | rebase 演练 |

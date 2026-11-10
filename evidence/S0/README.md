# S0 证据

结论与施工图见 [`../../docs/spike.md`](../../docs/spike.md)。

基线：

- `deepseek-harness` @ `fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159`
  （`dsh-v0.2.2-rc.1-811-gfcc0ad4621`）
- `dsh-TUI` @ `4011b417edf3eee2975226ba64a7a809a8d94ca1`（`0.19.0`）
- Node.js `24.22.2`，pnpm `11.28.5`

## 复跑

先在上游 checkout 中完成：

```sh
cd /root/siriusx/deepseek-harness
pnpm install --frozen-lockfile --trust-lockfile
pnpm run typecheck
pnpm run build:artifacts
```

然后：

```sh
# 1+2+3：真实 Web Host 中的 SSO provider、tenant context、Executor 插件
cd /root/siriusx
PATH=/root/.local/node24/bin:$PATH ./evidence/S0/run-auth-tenant-executor.sh

# 同一 Session 的 UI/Executor 并发语义
./evidence/S0/03-coexist/run-shared-session-spike.sh

# 4：dsh-TUI 接口提取（会 clone 到 /tmp/dsh-TUI）
./evidence/S0/04-agent-interface/run-interface-extraction.sh
```

真实 Chromium UI 截图实验需要 Playwright Chromium。当前环境安装方式：

```sh
cd /root/siriusx/deepseek-harness
node node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/cli.js install chromium
cd /root/siriusx
RUN_UI=1 ./evidence/S0/run-auth-tenant-executor.sh
```

## 文件

| 路径 | 说明 |
| --- | --- |
| `00-environment.txt` | 版本、构建、typecheck 基线 |
| `01-auth/auth-static-audit.txt` | 认证/账号/Cookie 源码位置 |
| `01-auth/connection-row-replacement.txt` | loader 不允许 patch 直接改 row name |
| `01-auth/account-provider/` | 可替换的 SSO account provider fixture；`tsc.txt` 为通过结果 |
| `02-tenant/env-hop-spike.ts` / `.txt` | 主进程到 Host 的环境变量通道 |
| `03-coexist/executor-plugin/` | Executor 形态 Host 插件；跑一轮真实 Agent |
| `03-coexist/shared-session-spike.ts` / `.txt` | 真实 AgentLoop + JSONL persistence：两个调用方与第二个 resume 的冲突 |
| `03-coexist/run-shared-session-spike.sh` | 上述测试的复跑入口 |
| `03-coexist/coexist-static-audit.txt` | UI 与 Agent registry 的源码位置 |
| `03-coexist/ui-open.txt` / `ui-open.png` | Chromium 打开 Web UI；同一 Host 的 Executor 同时跑完一轮 |
| `04-agent-interface/interface-only/` | 12 文件接口提取，严格 tsc 通过 |
| `04-agent-interface/backend-closure.txt` | 240 个文件的传递闭包清单 |
| `04-agent-interface/backend-closure-static.txt` | 237 个本地文件、54 个外部依赖 |
| `04-agent-interface/backend-tsc.txt` | 原样提取 DSH 后端的 33 个类型错误 |
| `run-auth-tenant-executor.txt` | 联合实验的完整输出 |

## 注意

- `node_modules`、`out/` 与 `*.log` 是复跑产生的，不入库。
- `01-auth` 的 provider 是 **spike fixture**，不是生产 OIDC 实现；不要直接打包。
- 生命周期实验使用 scripted LLM adapter，不调用真实模型。
- 第二个 `resume()` 的失败信息来自 JSONL persistence 的写锁；即使没有 persistence，
  Agent registry 的 `enter()` 也会以 `agent "<id>" is already registered` 拒绝第二次发布。

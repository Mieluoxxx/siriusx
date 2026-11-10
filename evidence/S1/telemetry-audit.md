# S1 遥测与上报审计

基线：`deepseek-harness` @ `fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159`。

## 逐项结论

| # | 包 / row | 默认是否开启 | 默认去向 | 内容 | 关闭方式 | 验证 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `desktop-product-telemetry` / `@deepseek-ai/dsh-host-product-telemetry-otel` | **Desktop 开启**；普通 Web 不加载 | `DSH_PRODUCT_ANALYTICS_OTLP_URL`，未设置时 schema 默认 `https://dsh-otel-collector.deepseeksvc.com/v1/logs` | 产品事件：UI 操作、消息提交、模型/插件切换、安装事件等；不含提示词/响应/密钥，但含客户端环境信息 | `@siriusx/dsh-telemetry-off-desktop` 将 row `disabled: true` | 组合 dump 中 `disabled: true` |
| 2 | `product-analytics` / `@deepseek-ai/dsh-client-product-analytics` | **Desktop 开启**（`enabled: true`） | 通过 #1 的 exporter | Host/Electron 侧产品事件与设备环境；默认无用户开关 | 同上，row `disabled: true` | 组合 dump 中 `disabled: true` |
| 3 | `session-telemetry-otel` / `@deepseek-ai/dsh-session-telemetry-otel` | **开启**；`mode: FEEDBACK_ONLY` | `DSH_TELEMETRY_OTLP_URL`，默认 `https://dsh-otel-collector.deepseeksvc.com/v1/logs` | 用户提交反馈时释放会话日志前缀；可包含消息正文、工具参数/结果、路径 | `@siriusx/dsh-telemetry-off` 设 `mode: DISABLED`；Desktop 启动再注入 `DSH_TELEMETRY_DISABLED=1` 生成 row disabled patch | 组合 dump `mode: DISABLED`；实际运行 `strace` 无非 loopback connect |
| 4 | `session-log-deepseek` / `@deepseek-ai/dsh-session-log-deepseek` | **开启**（`enabled: true`） | 随后续**官方 DeepSeek 模型请求**上传 `dsh_session_log` | 完整未确认的 canonical session 日志后缀，含原文 | `@siriusx/dsh-telemetry-off` row `disabled: true`；同时禁用官方 provider | 组合 dump `disabled: true` |
| 5 | `@deepseek-ai/dsh-anonymous-user-id` | 库，不是 plugin row；首次使用时创建 | `$DSH_HOME/.anonymous-user-id`；被 #1、#3、#4、`dsh-llm-deepseek`、`dsh-command-feedback` 使用 | 随机安装 ID，不含机器/账号信息，但可关联同一 home 的外发记录 | 无独立开关；禁用全部外发消费者：#3、#4、`command-feedback`、`llm-deepseek`、`llm-deepseek-account` | `rg` 检查消费者；组合 dump 全 disabled；运行期无非 loopback connect |

## 额外关闭的官方回传路径

| 包 / row | 原因 | 处理 |
| --- | --- | --- |
| `command-feedback` / `@deepseek-ai/dsh-command-feedback` | 反馈确认会把 anonymous home id 发给官方服务 | row disabled |
| `llm-deepseek` / `@deepseek-ai/dsh-llm-deepseek-api-key` | 官方模型请求携带 `x-deepseek-harness-user-id` | row disabled |
| `llm-deepseek-account` / `@deepseek-ai/dsh-llm-deepseek-account` | 官方账号模型路由，同样属于上游服务 | row disabled |

## 实现位置

- `plugins/telemetry-off/cordis.patch.yml`：所有 profile 中都存在的 row。
- `plugins/telemetry-off-desktop/cordis.patch.yml`：仅 Desktop/Web-app bundle 才有的 row。
- `deepseek-harness/apps/desktop/src/main.ts`：Host 子进程启动环境固定注入
  `DSH_TELEMETRY_DISABLED: '1'`，即使 bundle 被误删也不会用默认模式启动
  session telemetry。

## 网络验证

用本地 OpenAI-compatible mock 完成一轮 headless 会话，所有模型请求只访问
`127.0.0.1:18081`。`strace -f -e trace=connect` 结果：

```text
AF_INET connects: 2
non-loopback AF_INET connects: 0
```

证据：

- `01-telemetry/connect.trace`
- `01-telemetry/network-audit.txt`
- `01-telemetry/headless-conversation.out`
- `01-telemetry/mock-llm-request-summary.jsonl`

## 尚未完成的验收

- `DSH` 的 Desktop 产物只支持 macOS/Windows；当前 Linux 环境不能启动 Electron
  桌面端。已从源码完成 `build:artifacts` 与 `build:desktop`，但“启动打包桌面端并
  连续使用 10 分钟”的验收需要在 macOS 或 Windows 机器上复跑。
- 当前 0.2.2-rc.1 之后没有新的上游 release tag，rebase 演练只能对
  `upstream/master` 做；等上游发布下一个 tag 后需重跑并记录冲突文件。

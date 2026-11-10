# @siriusx/kernel-api

DSH 无关的执行内核接口，取自 dsh-TUI（MIT）的 `src/agent/`。见
[`PROVENANCE.md`](./PROVENANCE.md)。

## 核心契约

| 类型 | 责任 |
| --- | --- |
| `AgentBackend` | `detect()`、`open(create/resume)`、可选 catalog/launch |
| `AgentSession` | `history`、`subscribe`、`submit`、`cancel`、`dispose`；状态与能力 |
| `AgentEvent` | 实时与回放共用的统一事件词汇 |
| `SessionCapabilities` | 可选能力；缺席即不支持，不能伪造 |

## 重要边界

- dsh-TUI 的 DSH 后端 **不是** `AgentBackend`：它由 `createDshSession()` 从
  DSH Agent 特殊构造。SiriusX 的 DSH adapter 必须自研，见 S0 spike。
- 本包是 S0 的 12 文件提取结果，原样保留 TUI 的 view types 和 50 个事件变体。
  S2/S3 的 adapter 应只使用其中必要子集，不要为了复用把 Ink/React/UI 文件拖进来。
- `FakeKernel` 在 `@siriusx/fake-kernel`，只做确定性内存事件，不执行命令或模型。

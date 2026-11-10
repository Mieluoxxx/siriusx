# RFC：LayerFS 分层 CoW 工作区存储

> **候选**：本 RFC 以「每任务一个容器」为前提。roadmap #47 改为每任务沙箱加家目录卷后，这个前提重新成立，本方案是依赖与 workdir 存储的候选之一；是否采用以 BG3 的实测数据为准。

> 状态：**提案**，云端沙箱实现（BG2 / BG3）的存储引擎候选。不阻塞 C0 契约。
>
> 默认存储基线：`git worktree` + 共享 pnpm store / Docker Volume。
> Executor 契约（[executor.md](../contracts/executor.md)）不依赖具体存储实现。

## 1. 动机

| 痛点 | 说明 |
| --- | --- |
| 冷启动成本 | 每个工单都要 clone / worktree 检出并预热依赖 |
| 重复磁盘占用 | 并发工单各自持有一份依赖目录 |
| 回滚不确定 | 回滚依赖 `git reset --hard` / `git clean`，无法撤销被忽略文件、构建产物等非 Git 状态 |

是否采用以 BG3 实测数据为准（§6）。

## 2. 分层结构

只作用于容器内的 `/workspace`。OS 层由容器镜像（Dockerfile）管理，不进入本 overlay。

```text
┌──────────────────────────────────────────────────────────┐
│ Layer 3  Assignment Overlay（读写）   key: assignmentId   │
├──────────────────────────────────────────────────────────┤
│ Layer 2  Ticket Workspace（CoW 持久） key: workdirKey     │
├──────────────────────────────────────────────────────────┤
│ Layer 1  预热层（只读）                                   │
│   1a 源码快照                         key: repo@commit    │
│   1b 依赖缓存                         key: hash(lockfile) │
└──────────────────────────────────────────────────────────┘
```

| 层 | 挂载属性 | 生命周期 | 内容 |
| --- | --- | --- | --- |
| L1a | 只读 | 按 L2 引用计数回收 | 纯净源码（含 `.git`） |
| L1b | 只读 | 按 L2 引用计数回收 | `node_modules`、构建缓存 |
| L2 | CoW 持久 | Ticket 生命周期 | 历次 Assignment 合并后的工作现场 |
| L3 | 读写 | 单个 Assignment | 本次运行产生的全部变更 |

L1 拆成两部分：依赖缓存只按 lockfile 哈希做 key，可以跨 commit 复用；源码快照按 commit 做 key，成本低。避免「每个 commit 都重新预热依赖」。

## 3. 生命周期

### 3.1 CreateAssignment

- `start`：确认 L1a / L1b 存在（不存在则预热），初始化 L2，挂载新的 L3，把合并视图挂到 `/workspace`。
- `resume`：复用已有 L2，为新的 `assignmentId` 挂载新的 L3。

### 3.2 终态：默认合并

所有终态（`reported` 的全部 kind、`cancelled`）**默认把 L3 合并进 L2**，然后卸载 L3。

- 打断（`user_interrupted`）、提问（`answer`）、超时（`waiting`）都必须保留已完成的工作，resume 才能接着做。
- `lost`（宿主崩溃）：L3 的 upper 仍在磁盘上。宿主恢复后先合并，再把 Assignment 标为 `lost`。

### 3.3 显式回滚

只有人类主动发起时才回滚：`/reset` 指令，或在应用中「撤销上一次 Assignment」。

### 3.4 预览进程

预览挂在 workdir 上。L3 合并完成后，基于 L2 为预览单独挂载一个 overlay，其 upper 层**可写但用完即丢**：dev server 会写 `.vite`、`.next` 等缓存，只读挂载会让它们启动失败。

### 3.5 Git

Executor 只管理挂载和合并，**不执行 `git commit`**。提交、message 和签名全部由 Worker / 内核负责。

## 4. 实现要点

### 4.1 合并算法

upper 目录中的删除不是普通文件，合并时必须专门处理：

| 标记 | 内核 overlayfs | fuse-overlayfs | 合并动作 |
| --- | --- | --- | --- |
| 删除文件 / 目录 | 0/0 字符设备（whiteout） | `.wh.<name>` 文件 | 删除 L2 中的对应路径 |
| 不透明目录 | xattr `trusted.overlay.opaque=y`（rootless 为 `user.overlay.opaque`） | `.wh..wh..opq` 文件 | 先清空 L2 中的对应目录，再复制 |
| 普通文件 / 目录 | — | — | 覆盖写入 L2，保留权限、符号链接、xattr |

约束：

- **不能用 `cp -r`，也不能直接用 `rsync`**：两者都会把 whiteout 当成普通设备文件或普通文件复制过去，删除操作会失效，还会留下脏文件。需要专用合并工具，支持上表两种格式。
- **合并时 L2 不得被任何 overlay 挂载为 lowerdir**（包括预览进程的挂载）。修改正在使用的 lowerdir 属于未定义行为。合并流程：停止预览挂载 → 合并 → 重新挂载预览。
- 合并必须可以中断后重入（宿主崩溃时只合并了一半），例如先合并到临时目录，再原子替换。

### 4.2 权限与平台

- **Linux**：在 user namespace 下使用 rootless overlay（内核 5.11+）或 fuse-overlayfs，以专用的低权限 OS 账户运行，无需 root。
- **容器内**：upperdir 不能位于 overlayfs 上，L2 / L3 必须放在单独挂载的 volume 中。
- **macOS 开发机**：降级为基线方案（worktree + 软链接缓存），**不支持 §3.3 的显式回滚**。

### 4.3 GC

- L1a / L1b 按 L2 引用计数回收，**禁止**按固定时间清理：工单生命周期经常超过 24 小时，删掉正在被引用的 lowerdir 会损坏工作区。
- L2 随 `DestroyWorkdir` 回收。
- 撤销栈中保留的历史快照数量设上限（见 §7）。

## 5. 对契约的影响

基本不改变现有方法的语义。唯一需要新增的是：

- **工作区回滚**（`/reset`、撤销上一次 Assignment）需要一个 Executor 方法，例如 `RollbackWorkdir({ workdirKey, toAssignmentId })`。它应作为**可选能力**出现，Executor 通过能力声明告诉 Bot 是否支持；基线方案和 macOS 不支持。

C0 契约不加入该方法，等本 RFC 被采纳时再补充。

## 6. 待测指标

BG3 实测后填写，未实测前不引用任何数字。

| 指标 | 基线（worktree + pnpm store） | LayerFS（fuse-overlayfs / rootless overlay） |
| --- | --- | --- |
| 沙箱冷启动耗时 | 待测 | 待测 |
| 10 个并发工单的磁盘占用 | 待测 | 待测 |
| L3 → L2 合并耗时（大 / 小变更） | 不适用 | 待测 |
| 回滚耗时 | `git reset` + `git clean` 待测 | 待测 |
| 构建 / 测试运行时开销（fuse 的 I/O 损耗） | 待测 | 待测 |

## 7. 待定问题

1. **撤销栈的实现**：合并进 L2 之后要能回到之前的状态，有三种做法：
   - 合并前对 L2 做快照（需要 btrfs / xfs reflink 才便宜）；
   - 不合并，把历次 L3 叠加为 lowerdir 链，定期压缩（层数过多会影响性能）；
   - 只保留最近一次 L3 的 upper，只支持撤销最近一次。

   保留多少层历史？
2. **fuse 的 I/O 开销**：fuse-overlayfs 在 `node_modules` 这种大量小文件的场景下的性能损耗，可能会抵消冷启动带来的收益，需要实测。

# 全栈智能体架构总览

本系统分**控制面**（Bot 服务、工具网关、管理面、租户模型网关，多租户常驻）与**执行面**（每个任务一个沙箱，用完即毁），外加用户侧的应用与本地 Executor。运行形态见 [design/runtime.md](./design/runtime.md)（roadmap #45–#48）。各部分的设计细节见独立文档：

| 层 | 设计文档 | 对外接口 | 路线节点 |
| --- | --- | --- | --- |
| **云端 Background**：执行面，每个任务一个沙箱，挂载持久的家目录卷（见 [design/runtime.md](./design/runtime.md)） | [design/background.md](./design/background.md) | [contracts/executor.md](./contracts/executor.md)（桌面端的本地 Executor 实现同一契约） | BG1–BG3 |
| **Bot**：调度中枢。Bot 是数据，由控制面的多租户 **Bot 服务**处理，只在云端；分团队 Bot 与个人 Bot（见 [design/runtime.md](./design/runtime.md)） | [design/bot.md](./design/bot.md) | [contracts/ticket-stage.md](./contracts/ticket-stage.md)、Bot ⇄ 应用契约（W0） | BOT1–BOT6 |
| **应用：Web / 桌面端 / 移动端**（同一应用；Web 用云端项目空间，桌面端可用云端项目空间或本地目录） | [design/web-app.md](./design/web-app.md) | Bot ⇄ 应用契约（W0） | W0–W2、BOT6 |
| **管理后台**：平台运营后台 / 租户管理后台（共享层的管理面，不属于上面三层的任何一层） | [design/admin.md](./design/admin.md) | 管理面契约（ADM0） | ADM0–ADM2 |
| **工具网关**：外部副作用操作的唯一入口（策略、审批、审计、凭据），属于控制面，不在执行沙箱里 | [design/gateway.md](./design/gateway.md) | — | GW1 |
| **分析日志**：给数据科学家用的轨迹与结果数据，按 L0 / L1 / L2 分级，内容默认只属于租户 | [design/logging.md](./design/logging.md) | — | LOG1、LOG2 |
| **GitLab 集成**：连接与 Bot 身份、Webhook 入站、事件到工单的映射、经工具网关回复与开 MR、自建实例 | [design/gitlab.md](./design/gitlab.md) | — | BOT8 |

产品形态：**ToB**，以**多租户 SaaS** 为主；代码平台在客户内网时**私有化部署**到客户内网（见 [design/deployment.md](./design/deployment.md)）。应用鉴权走 SSO；企业集成 GitHub、GitLab（含自建）、飞书、Microsoft Teams。

落地顺序与决议记录见 [roadmap.md](./roadmap.md)。部署形态见 [design/deployment.md](./design/deployment.md)。存储引擎候选方案见 [RFC：LayerFS](./design/layerfs.md)。

```text
 人类 ──► GitLab / GitHub / 飞书 / 应用 ──► Bot 服务（Source → Engine → 准入 → 派工）   控制面
                                     │  ▲
                派工（按 workspace.kind）│  │ 事件流 / 报告
                                     ▼  │
                 ┌───────────────────┴──┴────────────────────┐
                 ▼                                           ▼
      云端 Background（cloud_project）          本地 Executor（local_dir，桌面端，W2）
      每任务沙箱 + 家目录卷 → 执行内核            用户机器 → 执行内核

 应用（Web / 桌面 / 移动）◄──► Bot ⇄ 应用契约：项目空间 / 会话 / 实时流 / 审查 / 控制台 / 配置
 应用同时是 Bot 的一个 Source：发起任务、对话、打断
```

**执行位置与数据边界**：云端主机还是本地客户端，只在任务开始时选择，之后不可更改；客户端的内容（本地文件、未提交改动、本地凭据）不上传到云端，两边之间只经代码平台流转。见 [design/web-app.md §1.3](./design/web-app.md#13-执行位置与数据边界)（roadmap #31）。

## 架构图

图 1–10 使用同一套名称；每张详图把相邻部分画成灰色方块，对应总览图中的同名区块。图 11–15 对应 roadmap #56–#61 的新决议。**图 4 与图 1 中的桌面端部分画于 #56 之前，已过期**，以图 11、图 12 为准。

| 图 | 内容 | 文件 |
| --- | --- | --- |
| 图 1 | 总览：各部分的位置与之间的契约 | [images/01-overview.png](./images/01-overview.png) |
| 图 2 | Bot：接入、准入、Engine、回复 | [images/02-bot.png](./images/02-bot.png) |
| 图 3 | 云端执行：每任务沙箱与家目录卷 | [images/03-cloud-executor.png](./images/03-cloud-executor.png) |
| 图 4 | 应用：Web / 桌面端 / 移动端 | [images/04-app.png](./images/04-app.png) |
| 图 5 | 管理后台：管理面 | [images/05-admin.png](./images/05-admin.png) |
| 图 6 | 任务生命周期 | [images/06-task-lifecycle.png](./images/06-task-lifecycle.png) |
| 图 7 | 部署与信任边界 | [images/07-deployment-trust.png](./images/07-deployment-trust.png) |
| 图 8 | 工具网关与审批 | [images/08-tool-gateway.png](./images/08-tool-gateway.png) |
| 图 9 | GitLab 集成 | [images/09-gitlab.png](./images/09-gitlab.png) |
| 图 10 | 分析日志 | [images/10-logging.png](./images/10-logging.png) |
| 图 11 | 桌面端组成：DSH Desktop 薄 fork（哪些是上游原样、fork 改动、我们自研） | [images/11-desktop-composition.png](./images/11-desktop-composition.png) |
| 图 12 | 登录前后：个人版与企业版，原生对话与 Bot 派工两条路 | [images/12-login-modes.png](./images/12-login-modes.png) |
| 图 13 | 内核接入：一套接口，多个内核 | [images/13-kernel-backends.png](./images/13-kernel-backends.png) |
| 图 14 | 执行顺序：先本地，后云端（S0–S8） | [images/14-execution-order.png](./images/14-execution-order.png) |
| 图 15 | fork 与上游：跟进版与冻结版 | [images/15-fork-branches.png](./images/15-fork-branches.png) |

## 1. 设计参考

原始蓝图整合了以下参考实现。[dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype) 是真实开源的研究原型（MIT），Bot 的 Source 统一接入直接采用它的模型（见 [bot.md §5.1](./design/bot.md#51-统一接入sourcekind)）；cindy 是真实开源项目，但只开源客户端，后端不在仓库中。

| 层 | 参考实现 | 借鉴点 |
| --- | --- | --- |
| Background | Cursor Cloud Agents | 声明式环境 + 磁盘快照（自建改用 Dockerfile + 每任务容器） |
| Background | DeepSeek Super-agent（`dsh-superagent-prototype`） | 计算 / 状态 / 机器三层解耦；前台满 5 秒转后台的异步执行 |
| Bot | `dsh-superagent` | 常驻轻量 Router + 隔离强模型 Worker + 独立定时 Watchdog；SourceKind 统一接入 |
| Bot | DS-Bot（`Fei2411/DS-Bot`） | Chief Bot 群聊协同；三态安全准入（off / observe / auto） |
| Web / APP | `makecindy/cindy` | pnpm Monorepo 跨端架构（Electron + React Native + device-link 协议） |
| 执行内核 | DeepSeek Harness（DSH，[deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)，MIT） | **首个执行内核实现**（内核可替换，roadmap #32）；基于 Cordis 的「一切皆插件」双平面组合；自定义模型 Provider |
| Bot | DS-Bot（[Fei2411/DS-Bot](https://github.com/Fei2411/DS-Bot)，Apache-2.0，DSH 插件） | 长期存在的 Bot、Markdown 记忆、私有 Bot、连接器凭据不给 Bot、按 Bot 与模型统计用量 |
| Bot / 应用 | OpenMausBot（[milind-soni/OpenMausBot](https://github.com/milind-soni/OpenMausBot)，Apache-2.0） | Bot 像联系人的列表、审批卡片、每种 Agent 一个驱动且不可用时降级、团队文件的护栏、设备配对 |
| 工具网关 / 管理后台 | OpenBot（[CopilotKit/OpenBot](https://github.com/CopilotKit/OpenBot)，MIT；依赖另行授权的 CopilotKit Intelligence） | 每人一个隔离单元与「独立」Bot、策略 → 审计 → 执行的单一入口、初始管理员、AG-UI |
| 工具网关 | Memoh（[felinics/Memoh](https://github.com/felinics/Memoh)，**AGPLv3，只参考思路，不引入代码**） | 连接器网关持有凭据，Agent 只经一个入口使用 |

原型方自测的合成负载实验显示：并发任务 p95 完成时间从单会话的 29.5 分钟降到 15.7 分钟。该数据未经本项目验证。

## 2. 前提与成熟度边界

1. 团队级自主智能体的瓶颈不是单任务推理上限，而是**人类注意力带宽**（单人通常只能同时跟进 3–5 个活跃会话）和**宿主机安全边界**。
2. 原型定位是参考研究原型，不是生产就绪产品。文件沙箱只约束文件系统写入，**不隔离网络和进程可见性**，必须叠加沙箱隔离（每任务一个沙箱，出口网络白名单）。

## 3. 最高设计准则

> 占用最少的人类注意力，交付最大的工程价值。

- 未经显式请求的任务默认以 **observe** 模式运行，只记录、不执行。
- 三道防线：每任务执行沙箱（凭据与决策不在其中）、Fail-Closed 的工具网关（策略、审批、审计）、内核自带的文件沙箱。
- 不制造垃圾 PR，不制造通知噪音。

## 4. 执行内核 DSH 的运行时底座

> DSH 是首个执行内核（roadmap #22、#32），只运行在执行沙箱里；**Bot 不是 DSH 插件**（roadmap #46）。以下是 DSH 的 Cordis 底座与配置纪律，只与内核适配层有关。

DSH 基于 Cordis 把所有能力表达为插件：`inject` 声明依赖、`provide` 暴露服务、`apply(ctx)` 实现逻辑。分两个平面：

| 平面 | 配置 | 生命周期 | 职责 |
| --- | --- | --- | --- |
| Host Composition | `base.cordis.yml` + `web.cordis.yml` | 每进程一份 | 跨会话注册表、持久化、模型路由、Fail-Closed 审批（One-shot human grant）、三级文件沙箱 |
| Agent Preset | `agent.cordis.yml` | 每会话一份，随会话销毁 | 单会话工具、人设、压缩策略 |

**PTC Mode**（预设目录 ID `code`）：模型用生成式 SDK 写完整程序交给 `run_code` 执行；并发安全的读取可重叠运行，排他性调用作为顺序屏障；大中间数据留在程序内过滤聚合，只把外层结果（及延迟转发的图像）写入上下文。注意：外层失败**不会回滚**已产生的外部副作用；Token 收益需按实际负载评估。

**5 层配置树**（自底向上叠加）：

1. 空根
2. 内置 Bundle 补丁（`dsh.profile.bundles`）
3. Profile 补丁（`~/.dsh/profiles/<profile>/cordis.patch.yml`）
4. 全局补丁（`$DSH_HOME/cordis.patch.yml`）
5. 命令行临时覆盖（`--patch`）

> **纪律**：补丁按**整行替换**（Full Row Replacement）而非深度合并。改任何配置行（`id`）前，先用 `dsh --dump-default-config` 复制该行完整对象并重述要保留的字段；改完用 `dsh --dump-config` 校验，避免未声明字段被重置为默认值。

**Profile 初始化**（原实施计划 T1.2）：

- 基于 web 模板创建专用 superagent Profile，不得与个人日常 Profile 混用：
  ```sh
  dsh superagent --from-default-profile web --dump-config > /dev/null
  dsh plugin --profile superagent add "link:$PWD"
  ```
- 在 `~/.dsh/profiles/superagent/cordis.patch.yml` 配置绝对路径 `stateDir` 与机器限额（`promptMaxChars`、`admissionContextMaxPages`、`admissionContextTimeoutMs`）。
- 初始化命令**不得**在已有 Profile 上重复执行（会清空 `cordis.patch.yml`）；锁定版本号以应对预览版接口变更。

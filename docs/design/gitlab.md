# GitLab 集成

> 总览见 [architecture.md](../architecture.md)，路线节点 BOT8（[roadmap.md](../roadmap.md)，决议 #16、#18、#19）。
>
> 本文把散在 [bot.md §5.1](./bot.md#51-统一接入sourcekind)、[gateway.md](./gateway.md)、[deployment.md](./deployment.md) 里的 GitLab 内容收拢成一份。GitLab 的行为以官方文档为准，下文涉及版本与套餐的说法于 2026-11 对照 GitLab 19.6 文档核对过。

## 1. 范围

- 支持 **gitlab.com** 与**企业自建实例**（GitLab Self-Managed / Dedicated）。每个租户配置自己的 `host`，一个租户可以接多个实例。
- GitLab 在系统里有三个角色，走三条不同的路：

| 角色 | 方向 | 走哪里 |
| --- | --- | --- |
| **事件来源**：Issue、MR、评论、Pipeline | GitLab → Bot | Webhook → 入口网关 → Bot 服务的 GitLab Source（§3） |
| **回复与变更请求**：评论、开 MR | Bot → GitLab | 工具网关（§5） |
| **代码内容**：检出、推送分支 | Executor ⇄ GitLab | 工具网关签发的短期凭据（§6） |

- GitLab 主要是**团队 Bot** 的入口（盯事件）。个人 Bot 也可以操作 GitLab 仓库，但由对话触发，不订阅 Webhook（[runtime.md §6](./runtime.md#6-bot-的两种形态)）。

## 2. 接入：租户管理员做一次

在租户管理后台的「代码平台」里添加一个 GitLab 连接：

1. 填实例地址 `host`（如 `gitlab.example.com`）；自建实例用私有 CA 时上传 CA 证书。
2. 提供 Bot 身份的令牌（下表三选一）。
3. 选择要接入的群组或项目。系统用该令牌**自动创建 Webhook**，每个连接生成独立的回调地址与密钥。
4. 系统做一次连通性检查：能读项目、Webhook 测试投递成功、能识别出 Bot 自己的用户 ID。

**Bot 身份**：

| 方式 | 适用 | 说明 |
| --- | --- | --- |
| **群组访问令牌**（推荐） | 一个群组下多个项目 | GitLab 会为令牌创建一个 Bot 用户，**不占许可席位**。gitlab.com 需要 Premium / Ultimate；自建实例任何许可都可用 |
| 项目访问令牌 | 只接一两个项目 | 同上，范围限于单个项目 |
| 专用 Bot 用户的个人访问令牌 | gitlab.com 免费版，或客户希望 Bot 是一个有名字的账号 | 占一个席位；由客户创建账号并加入项目 |

- 令牌角色为 **Developer**，范围为 `api` 与 `write_repository`。不要 Maintainer 及以上：Bot 不需要合并到受保护分支，也不需要改项目设置。
- 令牌由**工具网关**保管，不进入 Agent 进程（[gateway.md §5](./gateway.md#5-凭据)）。界面上只写不读。
- **令牌会过期**：GitLab 的访问令牌默认最长 365 天。系统记录到期日，提前 30 天、7 天在租户管理后台与管理员通知里提醒；过期后该连接标记为「不可用」，相关工单停在 `person/delivery`，不静默失败。

## 3. 事件入站

```text
GitLab ──Webhook──► 入口网关 ──按回调地址找到租户──► Bot 服务 · GitLab Source ──► Router ──► Eval 准入
```

**订阅的事件**：Issue、Merge Request、评论（Note）、Pipeline。

**校验**（任何一项不通过都丢弃并记审计）：

| 检查 | 做法 |
| --- | --- |
| 来源 | 回调地址是每个连接独有的；`X-Gitlab-Instance` 必须等于该连接的 `host` |
| 密钥 | 校验 `X-Gitlab-Token`；实例为 GitLab 19.0 及以上时改用**签名令牌**（`webhook-signature`、`webhook-id`、`webhook-timestamp`），签名校验同时防重放 |
| 去重 | 以 `Idempotency-Key` 去重。GitLab 重试时这个值不变 |
| Bot 自己的事件 | 作者是 Bot 用户 ID 的事件不触发准入，避免自己回复自己 |

**先确认，后处理**：入口网关校验通过、落盘后立即返回 2xx，准入与派工异步进行。原因是 GitLab 对失败的 Webhook 会自动停用：连续失败 4 次临时停用（从 1 分钟起逐步延长，最长 24 小时），连续失败 40 次永久停用。

**兜底**：

- **轮询补漏**：定时用 REST API 拉取每个项目最近更新的 Issue、MR 与评论，与已收到的事件比对，补上丢失的。
- **健康检查**：定时查询 Webhook 状态；发现被停用时在租户管理后台告警，并尝试发测试请求重新启用。
- 群组级 Webhook 需要 Premium / Ultimate；不满足时改为在每个项目上各建一个 Webhook。

## 4. 事件到工单的映射

| GitLab 事件 | 在 Bot 里是什么 | 准入 |
| --- | --- | --- |
| 新 Issue；Issue 被指派给 Bot 或打上约定标签 | 新 Thread 的 Trigger | 按规则判定；observe 模式下只记录候选 |
| Issue / MR 评论里 @Bot | 该 Thread 的 Trigger | 白名单成员的 @ 为 explicit |
| MR 的评审评论、讨论回复（Bot 开的 MR） | 已有工单的后续输入，可打断续跑 | 沿用该工单的 Mandate |
| 新 MR（非 Bot 开的） | 评审类 Trigger | 按规则判定 |
| 默认分支 Pipeline 失败 | Trigger | 只产生 inferred 候选 |
| Bot 的 MR 上 Pipeline 失败 | 已有工单的后续输入 | 沿用该工单的 Mandate |
| MR 合并 / 关闭 | 工单的结束信号；同时记为分析日志的结果（[logging.md §4](./logging.md#4-结果回填数据科学最需要的那一列)） | — |

- **Thread** 对应一个 Issue 或一个 MR；Issue 与为它开的 MR 绑定在同一张工单上。
- **Channel** 对应一个项目。
- 操作者写作 `gitlab:<userId>`，契约里 `channel = gitlab`（[executor.md](../contracts/executor.md)）。
- **身份不映射**：GitLab 用户与 SSO 用户、飞书用户不做对应（[bot.md §5.2](./bot.md#52-身份不跨-source-映射)）。GitLab 白名单按每个连接单独维护，可以从群组成员导入后由管理员确认。

## 5. 回复与变更请求

Bot 对 GitLab 的所有写操作都经工具网关，每次都有审计。按 [gateway.md §3](./gateway.md#3-策略) 的三档（roadmap #49），GitLab 上的默认值：

| 动作 | 默认 |
| --- | --- |
| 读取 Issue、MR、评论、Pipeline、文件 | 允许 |
| 在**触发它的那个 Issue / MR** 里回复 | 允许（属于工单内回复，由 Outbox 重试） |
| 推送到 Bot 自己的工作分支；为该工单开 MR | 工单有有效 Mandate 时允许 |
| 在其他 Issue / MR 里评论、改标签、改指派、关闭 Issue | 需要审批 |
| 合并 MR、推送到默认分支或受保护分支 | 需要审批；**默认不给 Bot 这个权限**（令牌只有 Developer） |
| 删除项目、删除受保护分支、改成员与权限、强制推送 | 内置基线，永远拒绝 |

- 变更请求统一为 `report.changeRequest`：`provider = gitlab`，`number` 是 MR 的 iid（[bot.md §5.1](./bot.md#51-统一接入sourcekind)）。
- 回复写在原 Thread 里；对评审评论的回复写在对应的讨论下，不另开评论。
- Bot 开的 MR 默认是草稿（Draft），由人取消草稿并合并。

## 6. 代码检出与推送

- **云端执行**（`cloud_project`）：沙箱里的 `git clone` / `fetch` / `push` 经工具网关代理，由网关附上**只对该项目有效的短期凭据**，沙箱里拿不到令牌。长期令牌不写进 workdir 与 `.git/config`。
- 工作分支固定前缀（如 `autobot/<工单号>`），Bot 只往这个前缀下推送。
- **本地执行**（`local_dir`）：用用户电脑上已有的 git 凭据拉取与推送，系统不向设备下发 GitLab 令牌；开 MR 仍由云端的工具网关完成。
- 项目路径可以多级（`group/subgroup/project`），契约里用 `repo.host` + `repo.projectPath` 表示。

## 7. 自建实例

| 情况 | 做法 |
| --- | --- |
| 自建实例对公网开放 | 走 SaaS。我方以**固定出口 IP** 访问，客户把它加入白名单；Webhook 回调地址是我方入口网关 |
| 自建实例只在内网 | **整套系统私有化部署进客户内网**（[deployment.md](./deployment.md)），不做穿透连接器。Webhook 与 API 在内网直连 |
| 私有 CA / 自签证书 | 连接配置里上传 CA 证书；不提供「跳过证书校验」的开关 |
| 实例版本较老 | 没有签名令牌时退回 `X-Gitlab-Token`；最低支持版本待定（§9） |

自建实例的管理员需要允许 Webhook 请求到我方回调地址（私有化部署时回调地址在内网，GitLab 默认拦截发往本地网络的 Webhook，需要在实例设置里放行）。

## 8. 在管理后台里看到什么

租户管理后台「代码平台」列出每个 GitLab 连接：

- 实例地址、Bot 用户名、已接入的群组与项目
- 令牌到期日与剩余天数
- Webhook 状态（正常 / 临时停用 / 已停用）与最近一次成功投递时间
- 最近一次轮询补漏补上了几条事件
- 操作：更换令牌、重建 Webhook、暂停连接、删除连接（删除时一并删除我方建的 Webhook）

平台运营后台只能看到连接的健康状态，看不到项目内容（[admin.md §3.1](./admin.md#31-运营人员与租户内容的隔离)）。

## 9. 待定问题

1. **最低支持的 GitLab 版本**：老版本的自建实例很常见，需要定一个下限并在连接检查时提示。
2. ~~§5 的默认策略~~：已决议（#49），Mandate 范围内的动作放行。
3. **谁来建 Webhook**：现在写的是系统用令牌自动创建。有的客户不允许第三方改项目设置，是否提供「管理员手动创建，只粘贴密钥」的方式？
4. **GitLab 白名单的来源**：从群组成员导入，还是完全手动维护？
5. **Fork 的 MR**：来自 Fork 的 MR 是否接手？Bot 的令牌通常推不到别人的 Fork。
6. **是否用 GitLab 的评审功能**：Bot 评审别人的 MR 时，是只写评论，还是也给出「批准」？后者会影响客户的合并规则，建议不给。

## 10. 实施要点

| 节点 | 任务 | 验收 | 风险与回退 |
| --- | --- | --- | --- |
| BOT8 | GitLab Source：连接配置、Webhook 校验与去重、轮询补漏、事件映射、经工具网关回复与开 MR | 在 gitlab.com 与一套自建实例上各跑通「Issue → 工单 → 分支 → MR → 评审评论 → 续跑」；重复投递同一事件只产生一次 Trigger；停掉回调服务一段时间后，漏掉的事件被轮询补上；令牌过期后连接标记为不可用且有告警；Agent 进程里找不到 GitLab 令牌 | 写操作依赖 GW1；GW1 未完成前只在 observe 模式下接入（只读、只记录候选） |

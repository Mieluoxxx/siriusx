# DSH 插件

这里放 SiriusX 自己的 **DSH 插件与 bundle**。目录约定：

```text
/root/siriusx/
  deepseek-harness/   # DSH 源码 fork 的本地 checkout（独立 Git，upstream remote）
  plugins/            # 本目录：DSH 插件，与 DSH 源码同级
  packages/           # 非插件共享代码：契约、内核接口、共享客户端
```

规则：

- 插件是独立 package，有各自的 `package.json`，不写进上游 `deepseek-harness/packages/`。
- 需要改变 DSH 启动图时，用 `dsh.bundle` + `cordis.patch.yml` 组合，不修改上游 bundle。
- 插件通过 `dsh plugin --profile <name> add link:<path>` 或安装包内置的 runtime 依赖进入 profile。
- 能用插件完成的能力，不改 `apps/desktop`；必须改桌面壳时只动 `apps/desktop`。
- 每个插件必须有独立 README、可复跑测试和 MIT/自有许可证声明。

首批插件：

| package | 作用 |
| --- | --- |
| `telemetry-off` | 关闭上游遥测、会话日志上报、匿名关联头和官方反馈上传 |
| `account-sso` | 企业 OIDC 登录 provider（S5） |
| `tenant-context` | 向 Host 扩展提供租户上下文（S5） |
| `executor-local` | 本地 Executor，实现 `local_dir`（S3） |
| `client-ui-team` | Bot/工单/审批界面插件（S4） |
| `enterprise-bundle` | 把企业插件组合成可安装 bundle |

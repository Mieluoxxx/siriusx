# @siriusx/dsh-client-ui-enterprise

DSH 客户端插件：把 SiriusX 企业插件列进 **预设的插件页**（与「子智能体」「网页搜索与获取」「Agent 循环」「终端」同一分组），每个插件一张卡片，点开是详情页。

| 卡片 | 对应插件包 | 详情页展示 |
| --- | --- | --- |
| SiriusX 企业登录 | `@siriusx/dsh-account-sso` | 登录状态、租户、角色、控制面会话是否建立、控制面地址、最近一次换取会话失败的原因 |
| SiriusX 模型网关 | `@siriusx/dsh-llm-siriusx` | 租户当前模型、网关鉴权是否可用（依赖控制面会话）、租户 |

## 为什么需要它

插件页只列「已安装 / 官方 / 出错」的 bundle。企业插件随安装包携带、由企业配置挂进 profile，不属于这三类，所以不在页面里。预设分组由 `plugins.item` 槽位承载，这里通过它注册卡片，**不改 harness 一行代码**。

## 数据来源与边界

- 详情页只读 `GET /__siriusx/tenant`（`@siriusx/dsh-account-sso` 提供的本机回环探针，非回环来源会被它拒绝）。
- 解析时**不读取** `subjectId`，也**不调用** `/__siriusx/control-plane`（它返回会话令牌）。页面上看不到用户 id 和令牌，测试覆盖这一点。
- 模型网关没有独立的状态接口，所以「模型网关」页只展示探针里有的东西（模型 id、会话是否可用）。网关地址与连通性不在页面里。
- 探针读不到（插件未加载、非企业安装、请求超时 5 秒）时显示「读取不到状态」和技术原因，可点「刷新」重试。
- 卡片只读：两个插件都由安装包内的企业配置决定，页面不提供开关或配置。

## 挂载

`cordis.patch.yml` 插入 `siriusx-client-ui-enterprise` 一行，仅在 `SIRIUSX_ENTERPRISE=1` 时启用（与 SSO 插件同一条件）。要随安装包携带，把包名放进企业配置的 `bundles`：

```json
{ "bundles": ["@siriusx/dsh-account-sso", "@siriusx/dsh-llm-siriusx", "@siriusx/dsh-client-ui-enterprise"] }
```

再用 `deploy/release/build-desktop.sh` 打包（它按包名在 `plugins/` 下找目录、先构建、再随包）。源码态调试：

```sh
DSH_HOME=$(mktemp -d) pnpm dsh plugin --profile web add link:$PWD/plugins/client-ui-enterprise
SIRIUSX_ENTERPRISE=1 DSH_HOME=… pnpm dsh web --no-open
```

## 开发

```sh
pnpm --filter @siriusx/dsh-client-ui-enterprise run typecheck
pnpm --filter @siriusx/dsh-client-ui-enterprise run test
pnpm --filter @siriusx/dsh-client-ui-enterprise run build   # lib/index.js（Host 半）+ lib/client.js（浏览器半）
```

- 客户端产物是包进 `window.__ModuleLoader__.load` 的 CJS；`react`、`react/jsx-runtime`、`@deepseek-ai/dsh-client-ui-primitives` 由壳的模块表提供，不打进包里。
- `@types/react` / `react` 固定为 19 系：已发布的 `dsh-client-ui-primitives` 类型会解析到工作区里提升出来的 `@types/react@19`，本包与它保持同一份类型。运行时的 React 仍是壳提供的那份。
- 文案在 `src/client/locales.ts`（中文、英文；其它语言回退到英文）。

## 许可

MIT。

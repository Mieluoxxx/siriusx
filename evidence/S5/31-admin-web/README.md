# Standalone platform admin SPA

新增 `apps/admin-web`：

- 独立 TypeScript SPA
- `admin.js` + `index.html` + `style.css` 构建产物
- 独立 Node 静态服务器
- `/v1/admin/*` 同源代理
- 平台 token 只保存在 sessionStorage
- 支持：
  - 租户创建、编辑、Suspend/Resume
  - 用户/角色
  - quota
  - billing
  - model catalog / binding
  - source bindings
  - support requests
  - usage trend
  - platform audit + CSV
  - audit summary

浏览器实测：

- 创建 `tenant-standalone`
- 打开租户详情
- 看到 config/quota/billing/usage/audit
- console errors 为空

证据：`run.txt`、`admin.png`、`typecheck.txt`、`build.txt`。

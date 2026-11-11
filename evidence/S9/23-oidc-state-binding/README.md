# OIDC state browser binding

- `/auth/oidc/start` 设置短时 HttpOnly `siriusx_oidc_state` cookie；
- `/auth/oidc/callback` 要求 URL state 与 cookie state 一致；
- 缺失或不匹配返回 400 `invalid OIDC state`；
- 成功回调清除 state cookie；
- 测试：start 302 + state cookie；不带 cookie 的 callback 返回 400。
- 浏览器 OIDC 登录复跑仍通过（cookie 自动回传）。
- 证据：`run.txt`、`typecheck.txt`。

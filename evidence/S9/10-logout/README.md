# Web Gateway logout

- `POST /auth/session` 设置 HttpOnly session cookie；
- `/v1/me` 带 cookie 返回 200；
- `GET /auth/logout` 返回 302，并写 `Max-Age=0` 清除 cookie；
- 再次请求 `/v1/me` 返回 401。
- 证据：`run.txt`、`typecheck.txt`。

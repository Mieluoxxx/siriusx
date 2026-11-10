# OIDC RP-initiated logout

- discovery 暴露 `end_session_endpoint`；
- `/auth/logout` 先清除 HttpOnly cookie，再 302 到 IdP end-session URL；
- 本地 IdP 再 302 回 `post_logout_redirect_uri`；
- 登出后 `/v1/me` 401。
- 证据：`run.txt`、`typecheck.txt`。
